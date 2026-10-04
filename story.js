// Gemeinsame Helfer für Startseite, Archiv und Erfolgsseite.

const wholeEuro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const exactEuro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export const formatEuro = (cents) => (cents % 100 === 0 ? wholeEuro : exactEuro).format(cents / 100);

export const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Auf GitHub Pages gibt es keinen Server: Dort beantwortet eine Browser-Vorschau die Anfragen.
const staticPreview = document.documentElement.dataset.backend === 'static';
let preview;

export async function api(url, body) {
  if (staticPreview) {
    preview ??= await import('./demo-backend.js');
    return preview.handle(url, body);
  }
  const options = body
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : {};
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Da ist etwas schiefgelaufen. Bitte versuch es noch einmal.');
  return data;
}

// Aufeinanderfolgende Sätze fließen zu einem Absatz zusammen, Seiten und das Ende stehen für sich.
export function renderStory(container, entries) {
  container.replaceChildren();
  let paragraph = null;

  for (const entry of entries) {
    if (entry.kind === 'sentence') {
      if (paragraph) paragraph.append(' ');
      else container.append((paragraph = el('p')));
      const sentence = el('span', 'sentence', entry.text);
      sentence.dataset.id = entry.id;
      paragraph.append(sentence);
      continue;
    }

    paragraph = null;
    const section = el('section', entry.kind === 'page' ? 'page' : 'ending');
    for (const block of entry.text.split(/\n{2,}/)) section.append(el('p', null, block));
    if (entry.kind === 'end') section.append(el('p', 'ending-mark', 'Ende'));
    container.append(section);
  }
  return container;
}
