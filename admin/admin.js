import { el, formatEuro } from '/story.js';

const KINDS = { sentence: 'Satz', page: 'Seite', end: 'Ende' };
const PRODUCTS = { ...KINDS, delete: 'Löschen', title: 'Titel', name: 'Name' };
const STATUS = {
  pending: 'offen',
  fulfilled: 'ausgeführt',
  conflict: 'Konflikt',
  refunded: 'erstattet',
  failed: 'fehlgeschlagen',
  expired: 'abgebrochen',
};

const date = (value) => new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

async function post(url, question) {
  if (!confirm(question)) return;
  const res = await fetch(url, { method: 'POST', headers: { 'x-admin': '1' } });
  if (!res.ok) alert('Das hat nicht geklappt.');
  load();
}

function action(label, url, question) {
  const button = el('button', null, label);
  button.type = 'button';
  button.addEventListener('click', () => post(url, question));
  return button;
}

function table(id, headers, rows) {
  const head = el('tr');
  head.append(...headers.map((header) => el('th', null, header)));
  const body = rows.map((cells) => {
    const tr = el('tr');
    for (const cell of cells) {
      const td = el('td', cell?.className);
      td.append(cell?.node ?? String(cell?.text ?? cell ?? ''));
      tr.append(td);
    }
    return tr;
  });
  document.getElementById(id).replaceChildren(head, ...body);
}

async function load() {
  const data = await (await fetch('/admin/api/overview')).json();

  table(
    'stories',
    ['Band', 'Titel', 'Status', ''],
    data.stories.map((story) => [
      story.id,
      { text: story.title ?? '—', className: 'text' },
      story.finished_at ? `beendet ${date(story.finished_at)}` : 'läuft',
      story.title
        ? { node: action('Titel entfernen', `/admin/api/stories/${story.id}/reset-title`, 'Titel entfernen? Er kann danach neu gekauft werden.') }
        : '',
    ]),
  );

  table(
    'names',
    ['Name', 'Datum', ''],
    data.names.map((name) => [
      { text: name.name, className: 'text' },
      { text: date(name.created_at), className: 'nowrap' },
      { node: action('Ausblenden', `/admin/api/names/${name.id}/hide`, `„${name.name}“ ausblenden?`) },
    ]),
  );

  table(
    'entries',
    ['Band', 'Art', 'Text', 'Datum', ''],
    data.entries.map((entry) => [
      entry.story_id,
      KINDS[entry.kind],
      { text: entry.text, className: 'text' },
      { text: date(entry.created_at), className: 'nowrap' },
      { node: action('Entfernen', `/admin/api/entries/${entry.id}/hide`, 'Diesen Text aus der Geschichte entfernen?') },
    ]),
  );

  table(
    'orders',
    ['Datum', 'Produkt', 'Betrag', 'Status', 'Hinweis'],
    data.orders.map((order) => [
      { text: date(order.created_at), className: 'nowrap' },
      PRODUCTS[order.product] ?? order.product,
      `${formatEuro(order.amount)}${order.discounted ? ' (Rabatt)' : ''}`,
      STATUS[order.status] ?? order.status,
      order.error ?? '',
    ]),
  );
}

load();
