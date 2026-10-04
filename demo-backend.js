// Browser-Vorschau für GitHub Pages: beantwortet dieselben Anfragen wie der Server (src/app.js),
// speichert aber alles nur im localStorage des Besuchers. Es gibt keine Zahlung.
import { DISCOUNT_PERCENT, LIMITS, PRODUCTS } from './lib/config.js';
import { ShopError, cleanText, quote } from './lib/rules.js';

const DISCOUNT_CODE = '1589';
const STORAGE_KEY = 'unendliche-geschichte-vorschau';
const NOTICE =
  'Vorschau: Hier wird kein Geld berechnet, und alles, was du schreibst, bleibt nur in deinem Browser gespeichert.';
const NO_STORAGE =
  'Die Vorschau braucht den Speicher deines Browsers. Bitte erlaube Cookies und Website-Daten für diese Seite.';

const fresh = () => ({
  version: 1,
  nextId: 1,
  stories: [{ id: 1, title: null, finished_at: null }],
  entries: [],
  names: [],
  orders: {},
});

const isValid = (data) =>
  data?.version === 1 &&
  Array.isArray(data.stories) &&
  Array.isArray(data.entries) &&
  Array.isArray(data.names) &&
  typeof data.orders === 'object' &&
  data.stories.some((story) => !story.finished_at);

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (isValid(saved)) return saved;
  } catch {}
  return fresh();
}

// Ohne localStorage ginge jeder Kauf beim Wechsel zur Erfolgsseite verloren – dann lieber gleich ehrlich abbrechen.
function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    throw new ShopError(NO_STORAGE);
  }
}

function storageWorks() {
  try {
    localStorage.setItem(`${STORAGE_KEY}-test`, '1');
    localStorage.removeItem(`${STORAGE_KEY}-test`);
    return true;
  } catch {
    return false;
  }
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const currentStory = (data) => data.stories.find((story) => !story.finished_at);
const visibleEntries = (data, storyId) =>
  data.entries
    .filter((entry) => entry.story_id === storyId && !entry.deleted_by)
    .map(({ id, kind, text }) => ({ id, kind, text }));

function state(data) {
  const story = currentStory(data);
  const entries = visibleEntries(data, story.id);
  return {
    story: { id: story.id, title: story.title, entries },
    stats: {
      sentences: entries.filter((entry) => entry.kind === 'sentence').length,
      pages: entries.filter((entry) => entry.kind === 'page').length,
      deleted: data.entries.filter((entry) => entry.story_id === story.id && entry.deleted_by === 'purchase').length,
    },
    reserved: { title: false, end: false, deletes: [] },
    names: data.names.map((row) => row.name).reverse().slice(0, 500),
    demo: true,
    demoNotice: storageWorks() ? NOTICE : `Vorschau: ${NO_STORAGE}`,
    discountPercent: DISCOUNT_PERCENT,
    limits: LIMITS,
    products: Object.entries(PRODUCTS).map(([id, product]) => ({ id, ...product })),
  };
}

function archive(data) {
  return data.stories
    .filter((story) => story.finished_at)
    .reverse()
    .map((story) => ({ ...story, entries: visibleEntries(data, story.id) }));
}

function checkout(data, { product, text, entryId, code, agree }) {
  if (agree !== true) throw new ShopError('Bitte bestätige zuerst die Bedingungen.');
  const { amount, discounted } = quote(product, code, DISCOUNT_CODE);
  const story = currentStory(data);
  const addEntry = (storyId, kind, value) => data.entries.push({ id: data.nextId++, story_id: storyId, kind, text: value });

  if (product === 'delete') {
    const entry = data.entries.find(
      (candidate) =>
        candidate.id === Number(entryId) && candidate.story_id === story.id && candidate.kind === 'sentence' && !candidate.deleted_by,
    );
    if (!entry) throw new ShopError('Diesen Satz gibt es nicht (mehr).');
    entry.deleted_by = 'purchase';
  } else {
    if (product === 'title' && story.title) throw new ShopError('Der Titel wurde schon vergeben.');
    const value = cleanText(product, text);
    if (product === 'title') story.title = value;
    else if (product === 'name') data.names.push({ id: data.nextId++, name: value });
    else if (product === 'end') {
      addEntry(story.id, 'end', value);
      story.finished_at = new Date().toISOString();
      data.stories.push({ id: story.id + 1, title: null, finished_at: null });
    } else addEntry(story.id, product, value);
  }

  const id = newId();
  data.orders[id] = { product, amount, discounted, status: 'fulfilled' };
  save(data);
  return { url: `erfolg.html?order=${encodeURIComponent(id)}` };
}

function order(data, id) {
  const found = Object.hasOwn(data.orders, id) && data.orders[id];
  if (!found) throw new ShopError('Bestellung nicht gefunden.');
  return {
    status: found.status,
    product: found.product,
    productName: PRODUCTS[found.product].name,
    amount: found.amount,
    discountCode: DISCOUNT_CODE,
    discountPercent: DISCOUNT_PERCENT,
  };
}

export async function handle(url, body) {
  const path = url.replace(/^\.?\//, '');
  const data = load();
  let match;
  if (body === undefined) {
    if (path === 'api/state') return state(data);
    if (path === 'api/archive') return archive(data);
    if ((match = path.match(/^api\/orders\/([^/]+)$/))) return order(data, decodeURIComponent(match[1]));
  } else {
    if (path === 'api/quote') return quote(body.product, body.code, DISCOUNT_CODE);
    if (path === 'api/checkout') return checkout(data, body);
    if (/^api\/orders\/[^/]+\/cancel$/.test(path)) return { ok: true };
  }
  throw new Error('Unbekannte Anfrage.');
}
