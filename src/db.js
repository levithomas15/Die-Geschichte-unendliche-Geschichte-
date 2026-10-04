import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id          INTEGER PRIMARY KEY,
      title       TEXT,
      created_at  TEXT NOT NULL DEFAULT ${NOW},
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS entries (
      id         INTEGER PRIMARY KEY,
      story_id   INTEGER NOT NULL REFERENCES stories(id),
      kind       TEXT NOT NULL CHECK (kind IN ('sentence', 'page', 'end')),
      text       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      deleted_at TEXT,
      deleted_by TEXT CHECK (deleted_by IN ('purchase', 'admin'))
    );
    CREATE INDEX IF NOT EXISTS entries_story ON entries (story_id, id);

    CREATE TABLE IF NOT EXISTS names (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT ${NOW},
      hidden     INTEGER NOT NULL DEFAULT 0
    );

    -- status: pending → fulfilled | conflict → refunded | failed | expired
    CREATE TABLE IF NOT EXISTS orders (
      id                TEXT PRIMARY KEY,
      product           TEXT NOT NULL,
      story_id          INTEGER NOT NULL REFERENCES stories(id),
      payload           TEXT NOT NULL,
      amount            INTEGER NOT NULL,
      discounted        INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'pending',
      stripe_session_id TEXT,
      error             TEXT,
      created_at        TEXT NOT NULL DEFAULT ${NOW},
      expires_at        TEXT NOT NULL,
      done_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS orders_pending ON orders (status, product, story_id);
  `);

  if (!db.prepare('SELECT 1 FROM stories WHERE finished_at IS NULL').get()) {
    db.prepare('INSERT INTO stories DEFAULT VALUES').run();
  }
  return db;
}
