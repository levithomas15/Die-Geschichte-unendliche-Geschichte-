import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { ShopError, createShop } from '../src/shop.js';

async function start(options = {}) {
  const db = openDb(':memory:');
  const server = await new Promise((resolve) => {
    const listening = createApp({ db, ...options }).listen(0, () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const init =
      body === undefined
        ? { headers }
        : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, text };
  };
  const buy = (product, extra = {}) => call('/api/checkout', { product, agree: true, ...extra });
  const state = async () => (await call('/api/state')).body;
  return { db, server, call, buy, state };
}

const orderId = (url) => new URL(url, 'http://x').searchParams.get('order');

describe('Demo-Modus (ohne Stripe)', () => {
  let app;
  before(async () => (app = await start()));
  after(() => app.server.close());

  test('Preise und Rabattcode 1589 (−30 %)', async () => {
    const quote = async (product, code) => (await app.call('/api/quote', { product, code })).body;
    assert.equal((await quote('sentence')).amount, 100);
    assert.equal((await quote('sentence', '1589')).amount, 70);
    assert.equal((await quote('sentence', ' 1589 ')).amount, 70);
    assert.equal((await quote('sentence', '1234')).amount, 100);
    assert.equal((await quote('delete', '1589')).amount, 140);
    assert.equal((await quote('title')).amount, 500);
    assert.equal((await quote('page')).amount, 5000);
    assert.equal((await quote('end')).amount, 90000);
    assert.equal((await quote('end', '1589')).amount, 63000);
    assert.equal((await quote('name')).amount, 1200);
    assert.equal((await quote('name', '1589')).amount, 840);
  });

  test('Rabattcode steht nicht im öffentlichen Zustand', async () => {
    const res = await app.call('/api/state');
    assert.ok(!res.text.includes('1589'));
  });

  test('Satz schreiben, danach gibt es den Rabattcode', async () => {
    const res = await app.buy('sentence', { text: '  Es war einmal   ein Drache. ' });
    assert.equal(res.status, 200);
    const state = await app.state();
    assert.deepEqual(
      state.story.entries.map((entry) => entry.text),
      ['Es war einmal ein Drache.'],
    );
    const order = (await app.call(`/api/orders/${orderId(res.body.url)}`)).body;
    assert.equal(order.status, 'fulfilled');
    assert.equal(order.discountCode, '1589');
  });

  test('Rabatt wird beim Kauf berechnet', async () => {
    const res = await app.buy('sentence', { text: 'Der Drache hatte Hunger.', code: '1589' });
    const order = app.db.prepare('SELECT amount, discounted FROM orders WHERE id = ?').get(orderId(res.body.url));
    assert.deepEqual({ ...order }, { amount: 70, discounted: 1 });
  });

  test('ungültige Käufe werden abgelehnt', async () => {
    const cases = [
      [{ product: 'sentence', text: 'Ohne Zustimmung.' }, 'Bedingungen'],
      [{ product: 'sentence', text: 'Besuch www.spam.de jetzt!', agree: true }, 'Links'],
      [{ product: 'sentence', text: 'Mehr auf https://example.org', agree: true }, 'Links'],
      [{ product: 'sentence', text: 'x'.repeat(281), agree: true }, 'höchstens 280'],
      [{ product: 'sentence', text: ' ', agree: true }, 'mindestens'],
      [{ product: 'name', text: 'x'.repeat(41), agree: true }, 'höchstens 40'],
      [{ product: 'gratis', text: 'Hallo', agree: true }, 'Unbekanntes Produkt'],
    ];
    for (const [body, message] of cases) {
      const res = await app.call('/api/checkout', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(res.body.error, new RegExp(message));
    }
  });

  test('Satz löschen', async () => {
    await app.buy('sentence', { text: 'Dieser Satz muss weg.' });
    await app.buy('page', { text: 'Eine ganze Seite voller Worte.\n\nMit zwei Absätzen.' });
    const { story } = await app.state();
    const sentence = story.entries.find((entry) => entry.text === 'Dieser Satz muss weg.');
    const page = story.entries.find((entry) => entry.kind === 'page');
    assert.equal(page.text, 'Eine ganze Seite voller Worte.\n\nMit zwei Absätzen.');

    assert.equal((await app.buy('delete', { entryId: sentence.id })).status, 200);
    const after = await app.state();
    assert.ok(!after.story.entries.some((entry) => entry.id === sentence.id));
    assert.equal(after.stats.deleted, 1);

    assert.equal((await app.buy('delete', { entryId: sentence.id })).status, 400);
    assert.equal((await app.buy('delete', { entryId: page.id })).status, 400, 'Seiten kann man nicht löschen');
  });

  test('Titel kann nur der Erste bestimmen', async () => {
    assert.equal((await app.buy('title', { text: 'Der hungrige Drache' })).status, 200);
    const second = await app.buy('title', { text: 'Ein anderer Titel' });
    assert.equal(second.status, 400);
    assert.match(second.body.error, /schon vergeben/);
    assert.equal((await app.state()).story.title, 'Der hungrige Drache');
  });

  test('Name erscheint auf der Startseite', async () => {
    await app.buy('name', { text: 'Levi' });
    assert.ok((await app.state()).names.includes('Levi'));
  });

  test('das Ende schließt den Band ab und ein neuer beginnt', async () => {
    const before = await app.state();
    assert.equal((await app.buy('end', { text: 'Und der Drache lebte glücklich bis ans Ende.' })).status, 200);

    const state = await app.state();
    assert.equal(state.story.id, before.story.id + 1);
    assert.equal(state.story.title, null);
    assert.deepEqual(state.story.entries, []);

    const archive = (await app.call('/api/archive')).body;
    assert.equal(archive.length, 1);
    assert.equal(archive[0].title, 'Der hungrige Drache');
    assert.equal(archive[0].entries.at(-1).kind, 'end');

    assert.equal((await app.buy('title', { text: 'Band zwei' })).status, 200, 'neuer Band hat neuen Titel');
  });

  test('Seiten werden ausgeliefert', async () => {
    for (const path of ['/', '/erfolg', '/archiv', '/impressum']) {
      assert.equal((await app.call(path)).status, 200, path);
    }
    assert.equal((await app.call('/admin')).status, 404, 'ohne ADMIN_PASSWORD gibt es keinen Adminbereich');
  });
});

describe('Reservierung', () => {
  test('Titel ist während des Bezahlens reserviert, Doppelkauf wird erkannt', () => {
    const db = openDb(':memory:');
    const shop = createShop(db, { discountCode: '1589' });
    const first = shop.createOrder({ product: 'title', text: 'Erster' });
    assert.throws(() => shop.createOrder({ product: 'title', text: 'Zweiter' }), ShopError);
    assert.equal(shop.getState().reserved.title, true);

    db.prepare(`UPDATE orders SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(first.id);
    const second = shop.createOrder({ product: 'title', text: 'Zweiter' });

    assert.deepEqual(shop.fulfill(second.id), { status: 'fulfilled' });
    assert.equal(shop.fulfill(first.id).status, 'conflict');
    assert.deepEqual(shop.fulfill(first.id), { status: 'conflict' }, 'kein zweiter Versuch');
    assert.equal(shop.getState().story.title, 'Zweiter');
  });
});

function fakeStripe() {
  const sessions = new Map();
  const calls = { created: [], refunds: [], expired: [] };
  return {
    calls,
    sessions,
    checkout: {
      sessions: {
        create: async (params) => {
          const id = `cs_${calls.created.length + 1}`;
          const session = { id, url: `https://checkout.stripe.test/${id}`, status: 'open', payment_status: 'unpaid' };
          sessions.set(id, { ...session, metadata: params.metadata });
          calls.created.push(params);
          return session;
        },
        retrieve: async (id) => sessions.get(id),
        expire: async (id) => {
          calls.expired.push(id);
          sessions.get(id).status = 'expired';
        },
      },
    },
    refunds: {
      create: async (params) => {
        calls.refunds.push(params);
        return { id: 're_1' };
      },
    },
    webhooks: {
      constructEvent: (body, signature) => {
        if (signature !== 'gültig') throw new Error('Signatur falsch');
        return JSON.parse(body.toString());
      },
    },
  };
}

describe('mit Stripe', () => {
  let app;
  let stripe;
  before(async () => {
    stripe = fakeStripe();
    app = await start({ stripe, webhookSecret: 'whsec_test', baseUrl: 'https://geschichte.test' });
  });
  after(() => app.server.close());

  const pay = (sessionId, paymentIntent) =>
    Object.assign(stripe.sessions.get(sessionId), { status: 'complete', payment_status: 'paid', payment_intent: paymentIntent });

  test('Satz wird erst nach der Zahlung eingefügt', async () => {
    const res = await app.buy('sentence', { text: 'Bezahlt ist bezahlt.', code: '1589' });
    assert.equal(res.body.url, 'https://checkout.stripe.test/cs_1');

    const params = stripe.calls.created[0];
    assert.equal(params.line_items[0].price_data.unit_amount, 70);
    assert.equal(params.line_items[0].price_data.currency, 'eur');
    assert.match(params.success_url, /^https:\/\/geschichte\.test\/erfolg\?order=/);

    const id = params.metadata.order_id;
    assert.equal((await app.state()).story.entries.length, 0);
    assert.equal((await app.call(`/api/orders/${id}`)).body.status, 'pending');

    pay('cs_1', 'pi_1');
    const order = (await app.call(`/api/orders/${id}`)).body;
    assert.equal(order.status, 'fulfilled');
    assert.equal(order.discountCode, '1589');
    assert.equal((await app.state()).story.entries[0].text, 'Bezahlt ist bezahlt.');
  });

  test('Webhook führt den Kauf aus', async () => {
    await app.buy('name', { text: 'Webhook-Wilma' });
    const { order_id } = stripe.calls.created.at(-1).metadata;
    const event = {
      type: 'checkout.session.completed',
      data: { object: { metadata: { order_id }, payment_status: 'paid', payment_intent: 'pi_2' } },
    };

    const forged = await app.call('/api/stripe/webhook', event, { 'stripe-signature': 'gefälscht' });
    assert.equal(forged.status, 400);
    assert.ok(!(await app.state()).names.includes('Webhook-Wilma'));

    const res = await app.call('/api/stripe/webhook', event, { 'stripe-signature': 'gültig' });
    assert.equal(res.status, 200);
    assert.ok((await app.state()).names.includes('Webhook-Wilma'));

    await app.call('/api/stripe/webhook', event, { 'stripe-signature': 'gültig' });
    assert.equal((await app.state()).names.filter((name) => name === 'Webhook-Wilma').length, 1, 'nur einmal');
  });

  test('Abbrechen gibt die Reservierung frei', async () => {
    await app.buy('title', { text: 'Abgebrochen' });
    const { order_id } = stripe.calls.created.at(-1).metadata;
    assert.equal((await app.buy('title', { text: 'Warte' })).status, 400);

    await app.call(`/api/orders/${order_id}/cancel`, {});
    assert.equal((await app.call(`/api/orders/${order_id}`)).body.status, 'expired');
    assert.equal(stripe.calls.expired.length, 1);
    assert.equal((await app.state()).reserved.title, false);
  });

  test('wer zu spät bezahlt, bekommt sein Geld automatisch zurück', async () => {
    await app.buy('title', { text: 'Zu spät' });
    const late = stripe.calls.created.at(-1).metadata.order_id;
    const lateSession = stripe.calls.created.length;
    app.db.prepare(`UPDATE orders SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(late);

    await app.buy('title', { text: 'Pünktlich' });
    const winner = stripe.calls.created.at(-1).metadata.order_id;
    pay(`cs_${stripe.calls.created.length}`, 'pi_winner');
    assert.equal((await app.call(`/api/orders/${winner}`)).body.status, 'fulfilled');

    pay(`cs_${lateSession}`, 'pi_late');
    const order = (await app.call(`/api/orders/${late}`)).body;
    assert.equal(order.status, 'refunded');
    assert.match(order.reason, /schneller/);
    assert.equal(order.discountCode, undefined);
    assert.deepEqual(stripe.calls.refunds.map((refund) => refund.payment_intent), ['pi_late']);
    assert.equal((await app.state()).story.title, 'Pünktlich');
  });
});

describe('Moderation', () => {
  let app;
  const auth = (password) => ({ authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` });
  before(async () => (app = await start({ adminPassword: 'geheim' })));
  after(() => app.server.close());

  test('nur mit Passwort', async () => {
    assert.equal((await app.call('/admin/api/overview')).status, 401);
    assert.equal((await app.call('/admin/api/overview', undefined, auth('falsch'))).status, 401);
    assert.equal((await app.call('/admin/api/overview', undefined, auth('geheim'))).status, 200);
    assert.equal((await app.call('/admin/', undefined, auth('geheim'))).status, 200);
  });

  test('Texte und Namen ausblenden', async () => {
    await app.buy('sentence', { text: 'Ein gemeiner Satz.' });
    await app.buy('name', { text: 'Troll' });
    const overview = (await app.call('/admin/api/overview', undefined, auth('geheim'))).body;
    const entry = overview.entries[0];
    const name = overview.names[0];

    const withoutHeader = await app.call(`/admin/api/entries/${entry.id}/hide`, {}, auth('geheim'));
    assert.equal(withoutHeader.status, 403, 'Schutz gegen Cross-Site-Requests');

    await app.call(`/admin/api/entries/${entry.id}/hide`, {}, { ...auth('geheim'), 'x-admin': '1' });
    await app.call(`/admin/api/names/${name.id}/hide`, {}, { ...auth('geheim'), 'x-admin': '1' });
    const state = await app.state();
    assert.equal(state.story.entries.length, 0);
    assert.equal(state.stats.deleted, 0, 'Moderation zählt nicht als gekaufte Löschung');
    assert.deepEqual(state.names, []);
  });
});

describe('hinter einem Proxy', () => {
  let app;
  before(async () => (app = await start({ trustProxy: true })));
  after(() => app.server.close());

  test('verschiedene Besucher teilen sich kein Rate-Limit, auch bei mehreren Proxys', async () => {
    for (let n = 1; n <= 65; n++) {
      const res = await app.call(
        '/api/quote',
        { product: 'sentence' },
        { 'x-forwarded-for': `198.51.100.${n}, 104.16.0.1, 10.0.0.7` },
      );
      assert.equal(res.status, 200, `Besucher ${n}`);
    }
  });
});
