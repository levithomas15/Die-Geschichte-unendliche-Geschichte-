import { api, el, formatEuro, plural, renderStory } from './story.js';

const $ = (id) => document.getElementById(id);

const FIELDS = {
  sentence: { label: 'Dein Satz', rows: 3, placeholder: 'Und dann geschah etwas, womit niemand gerechnet hatte.' },
  page: {
    label: 'Deine Seite',
    rows: 12,
    placeholder: 'Schreib hier deine ganze Seite. Mit einer Leerzeile beginnst du einen neuen Absatz.',
  },
  end: { label: 'Das Ende der Geschichte', rows: 12, placeholder: 'Und so endete die Geschichte …' },
  title: { label: 'Der Titel', line: true, placeholder: 'z. B. Die Reise ans Ende der Welt' },
  name: { label: 'Dein Name', line: true, placeholder: 'Vorname, Spitzname oder Künstlername' },
};

const dialog = $('checkout');
const drafts = {};
let state = null;
let deleteMode = false;
let checkout = null; // { product, entryId }

const product = (id) => state.products.find((item) => item.id === id);
const activeInput = () => (FIELDS[checkout.product]?.line ? $('text-line') : $('text-area'));

async function load() {
  try {
    state = await api('api/state');
    render();
  } catch (err) {
    showToast(err.message);
  }
}

function render() {
  const { story, stats } = state;
  $('demo-banner').hidden = !state.demo;
  if (state.demoNotice) $('demo-banner').textContent = state.demoNotice;
  $('volume').textContent = `Band ${story.id}`;
  $('title').textContent = story.title ?? 'Noch ohne Titel';
  $('title').classList.toggle('untitled', !story.title);
  $('title-cta').hidden = Boolean(story.title || state.reserved.title);
  document.title = story.title ? `${story.title} – Die unendliche Geschichte` : 'Die unendliche Geschichte';
  $('stats').textContent = [
    plural(stats.sentences, 'Satz', 'Sätze'),
    plural(stats.pages, 'Seite', 'Seiten'),
    `${stats.deleted.toLocaleString('de-DE')} gelöscht`,
  ].join(' · ');

  renderNames();
  renderProducts();
  renderStoryArea();
}

function renderNames() {
  const names = state.names.length
    ? state.names.map((name) => el('li', null, name))
    : [el('li', 'names-empty', 'Noch niemand – sei der Erste!')];
  $('names').replaceChildren(...names);
}

function unavailable(item) {
  if (item.id === 'title' && state.story.title) return 'Schon vergeben';
  if (item.id === 'title' && state.reserved.title) return 'Wird gerade gekauft';
  if (item.id === 'end' && state.reserved.end) return 'Wird gerade gekauft';
  if (item.id === 'delete' && !state.stats.sentences) return 'Noch keine Sätze da';
  return null;
}

function renderProducts() {
  const items = state.products.map((item) => {
    const reason = unavailable(item);
    const button = el('button', 'product');
    button.type = 'button';
    button.dataset.buy = item.id;
    button.disabled = Boolean(reason);

    const text = el('span', 'product-text');
    text.append(el('span', 'product-name', item.name));
    text.append(reason ? el('span', 'product-status', reason) : el('span', 'product-desc', item.description));
    button.append(text, el('span', 'product-price', formatEuro(item.price)));

    const li = el('li');
    li.append(button);
    return li;
  });
  $('products').replaceChildren(...items);
}

function renderStoryArea() {
  const story = renderStory($('story'), state.story.entries);
  if (!state.story.entries.length) {
    story.append(el('p', 'empty', 'Noch steht hier kein einziges Wort. Schreib den ersten Satz dieser Geschichte.'));
  }

  // Schreibmarke am Ende der Geschichte
  const last = story.lastElementChild;
  const line = last?.tagName === 'P' ? last : story.appendChild(el('p'));
  const more = el('button', 'continue', `Weiterschreiben – ${formatEuro(product('sentence').price)}`);
  more.type = 'button';
  more.dataset.buy = 'sentence';
  line.append(' ', el('span', 'caret'), more);

  story.classList.toggle('selecting', deleteMode);
  $('delete-hint').hidden = !deleteMode;
  for (const sentence of story.querySelectorAll('.sentence')) {
    const reserved = state.reserved.deletes.includes(Number(sentence.dataset.id));
    sentence.classList.toggle('reserved', reserved);
    if (deleteMode && !reserved) {
      sentence.tabIndex = 0;
      sentence.setAttribute('role', 'button');
    }
  }
}

function setDeleteMode(on) {
  deleteMode = on;
  renderStoryArea();
  if (on) $('delete-hint').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function startPurchase(id) {
  if (id === 'delete') return setDeleteMode(true);
  if (deleteMode) setDeleteMode(false);
  openCheckout(id);
}

function openCheckout(id, entryId) {
  const item = product(id);
  checkout = { product: id, entryId };
  $('checkout-title').textContent = item.name;
  $('checkout-desc').textContent = item.description;

  const entry = id === 'delete' && state.story.entries.find((candidate) => candidate.id === entryId);
  $('checkout-target').hidden = !entry;
  $('checkout-target').textContent = entry ? entry.text : '';

  const field = FIELDS[id];
  $('text-field').hidden = !field;
  if (field) {
    $('text-line').hidden = Boolean(!field.line);
    $('text-area').hidden = Boolean(field.line);
    $('text-label').textContent = field.label;
    const input = activeInput();
    input.placeholder = field.placeholder;
    input.maxLength = state.limits[id][1];
    if (!field.line) input.rows = field.rows;
    input.value = drafts[id] ?? '';
    updateCounter();
  }

  $('checkout-error').hidden = true;
  $('agree').checked = false;
  resetPayButton();
  updatePrice();
  dialog.showModal();
  (field ? activeInput() : $('code')).focus();
}

function updateCounter() {
  const [, max] = state.limits[checkout.product];
  $('counter').textContent = `${activeInput().value.length.toLocaleString('de-DE')} / ${max.toLocaleString('de-DE')}`;
}

let quoteTimer;
let quoteRequest = 0;

function showPrice(amount, before) {
  $('price').textContent = formatEuro(amount);
  $('price-old').hidden = before === undefined;
  $('price-old').textContent = before === undefined ? '' : formatEuro(before);
}

function setCodeStatus(message, tone) {
  $('code-status').textContent = message;
  $('code-status').dataset.tone = tone ?? '';
}

function updatePrice() {
  const code = $('code').value.trim();
  showPrice(product(checkout.product).price);
  setCodeStatus('');
  clearTimeout(quoteTimer);
  if (!code) return;

  const request = ++quoteRequest;
  const id = checkout.product;
  quoteTimer = setTimeout(async () => {
    try {
      const quote = await api('api/quote', { product: id, code });
      if (request !== quoteRequest) return;
      if (quote.discounted) {
        showPrice(quote.amount, quote.price);
        setCodeStatus(`Code gültig: −${state.discountPercent} %`, 'ok');
      } else {
        setCodeStatus('Diesen Code gibt es nicht.', 'bad');
      }
    } catch (err) {
      if (request === quoteRequest) setCodeStatus(err.message, 'bad');
    }
  }, 350);
}

function showError(message) {
  $('checkout-error').textContent = message;
  $('checkout-error').hidden = false;
}

function resetPayButton() {
  $('pay').disabled = false;
  $('pay').textContent = 'Zahlungspflichtig bestellen';
}

let toastTimer;
function showToast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 6000);
}

$('checkout-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = checkout.product;
  const text = FIELDS[id] ? activeInput().value : undefined;
  if (FIELDS[id] && text.trim().length < state.limits[id][0]) {
    return showError(`Bitte mindestens ${state.limits[id][0]} Zeichen schreiben.`);
  }
  if (!$('agree').checked) return showError('Bitte bestätige zuerst die Bedingungen.');

  $('checkout-error').hidden = true;
  $('pay').disabled = true;
  $('pay').textContent = 'Einen Moment …';
  try {
    const { url } = await api('api/checkout', {
      product: id,
      text,
      entryId: checkout.entryId,
      code: $('code').value.trim(),
      agree: true,
    });
    delete drafts[id];
    location.assign(url);
  } catch (err) {
    showError(err.message);
    resetPayButton();
    load();
  }
});

for (const input of [$('text-line'), $('text-area')]) {
  input.addEventListener('input', () => {
    drafts[checkout.product] = input.value;
    updateCounter();
  });
}
$('code').addEventListener('input', updatePrice);
$('checkout-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

$('delete-cancel').addEventListener('click', () => setDeleteMode(false));

document.addEventListener('click', (event) => {
  const buy = event.target.closest('[data-buy]');
  if (buy) return startPurchase(buy.dataset.buy);
  const sentence = event.target.closest('.selecting .sentence:not(.reserved)');
  if (sentence) openCheckout('delete', Number(sentence.dataset.id));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && deleteMode && !dialog.open) setDeleteMode(false);
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.selecting .sentence')) {
    event.preventDefault();
    event.target.click();
  }
});

// Zurück von Stripe per Zurück-Taste: Seite kommt aus dem Cache, Button wieder freigeben.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  resetPayButton();
  load();
});

const cancelled = new URLSearchParams(location.search).get('abgebrochen');
if (cancelled) {
  history.replaceState(null, '', location.pathname);
  showToast('Bezahlung abgebrochen – es wurde nichts berechnet.');
  api(`api/orders/${encodeURIComponent(cancelled)}/cancel`, {}).catch(() => {}).finally(load);
} else {
  load();
}

// Neue Sätze anderer Leute erscheinen automatisch.
setInterval(() => {
  if (!document.hidden && !dialog.open) load();
}, 20_000);
