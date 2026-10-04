import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function storage({ blocked = false } = {}) {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      if (blocked) throw new Error('SecurityError');
      items.set(key, String(value));
    },
    removeItem: (key) => items.delete(key),
  };
}

describe('GitHub-Pages-Vorschau', () => {
  let out;
  let handle;
  const buy = (product, extra = {}) => handle('api/checkout', { product, agree: true, ...extra });

  before(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'vorschau-'));
    execFileSync(process.execPath, [path.join(root, 'scripts', 'build-pages.mjs'), out]);
    globalThis.localStorage = storage();
    ({ handle } = await import(pathToFileURL(path.join(out, 'demo-backend.js'))));
  });

  after(() => {
    fs.rmSync(out, { recursive: true, force: true });
    delete globalThis.localStorage;
  });

  test('alle Seiten nutzen das Browser-Backend und relative Pfade', () => {
    for (const file of fs.readdirSync(out).filter((name) => name.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(out, file), 'utf8');
      assert.match(html, /<html lang="de" data-backend="static">/, file);
      assert.doesNotMatch(html, /(href|src)="\/(?!\/)/, `${file} enthält absolute Pfade`);
    }
    assert.ok(fs.existsSync(path.join(out, '.nojekyll')));
  });

  test('Kaufen, Rabatt, Titel nur einmal, Löschen, Ende', async () => {
    const start = await handle('api/state');
    assert.equal(start.story.id, 1);
    assert.match(start.demoNotice, /Vorschau/);

    assert.equal((await handle('api/quote', { product: 'end', code: '1589' })).amount, 63000);

    const { url } = await buy('sentence', { text: 'Es war einmal.', code: '1589' });
    assert.match(url, /^erfolg\.html\?order=/);
    const order = await handle(`api/orders/${new URLSearchParams(url.split('?')[1]).get('order')}`);
    assert.deepEqual([order.status, order.amount, order.discountCode], ['fulfilled', 70, '1589']);

    await buy('title', { text: 'Erster Titel' });
    await assert.rejects(buy('title', { text: 'Zweiter Titel' }), /schon vergeben/);

    const sentence = (await handle('api/state')).story.entries[0];
    await buy('delete', { entryId: sentence.id });
    assert.equal((await handle('api/state')).stats.deleted, 1);

    await buy('end', { text: 'Und so endete die Geschichte.' });
    const next = await handle('api/state');
    assert.equal(next.story.id, 2);
    assert.equal(next.story.title, null);
    assert.equal((await handle('api/archive'))[0].title, 'Erster Titel');
  });

  test('ungültige Anfragen werden abgelehnt wie auf dem Server', async () => {
    await assert.rejects(handle('api/quote', { product: 'constructor' }), /Unbekanntes Produkt/);
    await assert.rejects(handle('api/checkout', { product: 'sentence', text: 'Ohne Zustimmung.' }), /Bedingungen/);
    await assert.rejects(buy('sentence', { text: 'Siehe www.spam.de' }), /Links/);
    await assert.rejects(handle('api/orders/__proto__'), /nicht gefunden/);
  });

  test('blockierter Browser-Speicher führt zu einer klaren Meldung statt zu verlorenen Käufen', async () => {
    globalThis.localStorage = storage({ blocked: true });
    assert.match((await handle('api/state')).demoNotice, /Speicher/);
    await assert.rejects(buy('sentence', { text: 'Geht nicht.' }), /Speicher deines Browsers/);
  });
});
