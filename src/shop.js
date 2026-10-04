import crypto from 'node:crypto';
import { RESERVATION_MINUTES } from './config.js';
import { ShopError, cleanText, quote as priceQuote } from './rules.js';

export { ShopError, cleanText };

const iso = (date = new Date()) => date.toISOString();

export function createShop(db, { discountCode }) {
  const currentStory = () =>
    db.prepare('SELECT * FROM stories WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1').get();

  const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(String(id));

  function setStatus(id, status, error = null) {
    const done = status === 'pending' ? null : iso();
    db.prepare('UPDATE orders SET status = ?, error = ?, done_at = ? WHERE id = ?').run(status, error, done, id);
  }

  // Nur für noch offene Bestellungen – eine ausgeführte Bestellung bleibt ausgeführt.
  function cancelOrder(id, status, error = null) {
    db.prepare(`UPDATE orders SET status = ?, error = ?, done_at = ? WHERE id = ? AND status = 'pending'`).run(
      status,
      error,
      iso(),
      id,
    );
  }

  function setSession(id, sessionId) {
    db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(sessionId, id);
  }

  function pendingOrders(storyId, products) {
    const marks = products.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT product, payload FROM orders
         WHERE story_id = ? AND status = 'pending' AND expires_at > ? AND product IN (${marks})`,
      )
      .all(storyId, iso(), ...products)
      .map((row) => ({ product: row.product, ...JSON.parse(row.payload) }));
  }

  const quote = (product, code) => priceQuote(product, code, discountCode);

  const createOrder = db.transaction(({ product, text, entryId, code }) => {
    const { amount, discounted } = quote(product, code);
    const story = currentStory();
    const payload = {};

    if (product === 'delete') {
      const id = Number(entryId);
      const entry =
        Number.isInteger(id) &&
        db
          .prepare(
            `SELECT id FROM entries
             WHERE id = ? AND story_id = ? AND kind = 'sentence' AND deleted_at IS NULL`,
          )
          .get(id, story.id);
      if (!entry) throw new ShopError('Diesen Satz gibt es nicht (mehr).');
      if (pendingOrders(story.id, ['delete']).some((order) => order.entryId === id)) {
        throw new ShopError('Dieser Satz wird gerade schon von jemand anderem gelöscht.');
      }
      payload.entryId = id;
    } else {
      if (product === 'title') {
        if (story.title) throw new ShopError('Der Titel wurde schon vergeben.');
        if (pendingOrders(story.id, ['title']).length) {
          throw new ShopError('Gerade kauft jemand anderes den Titel. Versuch es in einer halben Stunde noch einmal.');
        }
      }
      if (product === 'end' && pendingOrders(story.id, ['end']).length) {
        throw new ShopError('Gerade kauft jemand anderes das Ende. Versuch es in einer halben Stunde noch einmal.');
      }
      payload.text = cleanText(product, text);
    }

    const id = crypto.randomUUID();
    const expiresAt = iso(new Date(Date.now() + RESERVATION_MINUTES * 60_000));
    db.prepare(
      `INSERT INTO orders (id, product, story_id, payload, amount, discounted, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, product, story.id, JSON.stringify(payload), amount, discounted ? 1 : 0, expiresAt);
    return getOrder(id);
  });

  const insertEntry = (storyId, kind, text) =>
    db.prepare('INSERT INTO entries (story_id, kind, text) VALUES (?, ?, ?)').run(storyId, kind, text);

  // Führt den Kauf aus. Gibt einen Konflikt-Grund zurück, wenn das nicht (mehr) geht.
  function apply(order, payload) {
    const story = currentStory();
    switch (order.product) {
      case 'sentence':
      case 'page':
        insertEntry(story.id, order.product, payload.text);
        return null;
      case 'delete': {
        const { changes } = db
          .prepare(
            `UPDATE entries SET deleted_at = ?, deleted_by = 'purchase'
             WHERE id = ? AND story_id = ? AND kind = 'sentence' AND deleted_at IS NULL`,
          )
          .run(iso(), payload.entryId, story.id);
        return changes ? null : 'Der Satz wurde inzwischen schon gelöscht.';
      }
      case 'title': {
        const { changes } = db
          .prepare('UPDATE stories SET title = ? WHERE id = ? AND title IS NULL')
          .run(payload.text, order.story_id);
        return changes ? null : 'Jemand anderes war schneller und hat den Titel schon bestimmt.';
      }
      case 'end': {
        const { changes } = db
          .prepare('UPDATE stories SET finished_at = ? WHERE id = ? AND finished_at IS NULL')
          .run(iso(), order.story_id);
        if (!changes) return 'Jemand anderes war schneller und hat das Ende schon geschrieben.';
        insertEntry(order.story_id, 'end', payload.text);
        db.prepare('INSERT INTO stories DEFAULT VALUES').run();
        return null;
      }
      case 'name':
        db.prepare('INSERT INTO names (name) VALUES (?)').run(payload.text);
        return null;
      default:
        throw new Error(`Unbekanntes Produkt: ${order.product}`);
    }
  }

  // Idempotent: wird von Webhook und Erfolgsseite aufgerufen, ausgeführt wird nur einmal.
  const fulfill = db.transaction((orderId) => {
    const order = getOrder(orderId);
    if (!order) throw new ShopError('Bestellung nicht gefunden.');
    if (order.status !== 'pending') return { status: order.status };

    const conflict = apply(order, JSON.parse(order.payload));
    setStatus(order.id, conflict ? 'conflict' : 'fulfilled', conflict);
    return conflict ? { status: 'conflict', reason: conflict } : { status: 'fulfilled' };
  });

  const visibleEntries = (storyId) =>
    db
      .prepare('SELECT id, kind, text FROM entries WHERE story_id = ? AND deleted_at IS NULL ORDER BY id')
      .all(storyId);

  function getState() {
    const story = currentStory();
    const entries = visibleEntries(story.id);
    const pending = pendingOrders(story.id, ['title', 'end', 'delete']);
    const deleted = db
      .prepare(`SELECT COUNT(*) AS n FROM entries WHERE story_id = ? AND deleted_by = 'purchase'`)
      .get(story.id).n;

    return {
      story: { id: story.id, title: story.title, entries },
      stats: {
        sentences: entries.filter((entry) => entry.kind === 'sentence').length,
        pages: entries.filter((entry) => entry.kind === 'page').length,
        deleted,
      },
      reserved: {
        title: pending.some((order) => order.product === 'title'),
        end: pending.some((order) => order.product === 'end'),
        deletes: pending.filter((order) => order.product === 'delete').map((order) => order.entryId),
      },
      names: db
        .prepare('SELECT name FROM names WHERE hidden = 0 ORDER BY id DESC LIMIT 500')
        .all()
        .map((row) => row.name),
    };
  }

  function getArchive() {
    return db
      .prepare('SELECT id, title, finished_at FROM stories WHERE finished_at IS NOT NULL ORDER BY id DESC')
      .all()
      .map((story) => ({ ...story, entries: visibleEntries(story.id) }));
  }

  // --- Moderation ---

  function adminOverview() {
    return {
      stories: db.prepare('SELECT id, title, finished_at FROM stories ORDER BY id DESC').all(),
      entries: db
        .prepare(
          `SELECT id, story_id, kind, text, created_at FROM entries
           WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 300`,
        )
        .all(),
      names: db.prepare('SELECT id, name, created_at FROM names WHERE hidden = 0 ORDER BY id DESC').all(),
      orders: db
        .prepare(
          `SELECT id, product, amount, discounted, status, error, created_at FROM orders
           WHERE status != 'pending' OR expires_at > ? ORDER BY created_at DESC LIMIT 100`,
        )
        .all(iso()),
    };
  }

  const hideEntry = (id) =>
    db
      .prepare(`UPDATE entries SET deleted_at = ?, deleted_by = 'admin' WHERE id = ? AND deleted_at IS NULL`)
      .run(iso(), id).changes > 0;

  const hideName = (id) => db.prepare('UPDATE names SET hidden = 1 WHERE id = ?').run(id).changes > 0;

  const resetTitle = (id) => db.prepare('UPDATE stories SET title = NULL WHERE id = ?').run(id).changes > 0;

  return {
    quote,
    createOrder,
    fulfill,
    getOrder,
    setStatus,
    cancelOrder,
    setSession,
    getState,
    getArchive,
    adminOverview,
    hideEntry,
    hideName,
    resetTitle,
  };
}
