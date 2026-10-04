// Regeln für Preise und Texte. Ohne Node-Abhängigkeiten, damit dieselben Regeln
// auch in der Browser-Vorschau auf GitHub Pages gelten.
import { DISCOUNT_PERCENT, LIMITS, PRODUCTS } from './config.js';

// Fehler, die dem Käufer direkt angezeigt werden dürfen.
export class ShopError extends Error {}

const LINK_PATTERNS = [/https?:\/\//i, /www\./i, /\b[a-z0-9-]{2,}\.(de|com|net|org|io|at|ch|eu|info|xyz|ru)\b/];
const INVISIBLE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const MULTILINE = new Set(['page', 'end']);

export const isProduct = (product) => typeof product === 'string' && Object.hasOwn(PRODUCTS, product);

export function cleanText(product, raw) {
  let text = (typeof raw === 'string' ? raw : '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE_CHARS, '');

  if (MULTILINE.has(product)) {
    text = text
      .split('\n')
      .map((line) => line.replace(/ +/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    text = text.replace(/\s+/g, ' ').trim();
  }

  const [min, max] = LIMITS[product];
  if (text.length < min) throw new ShopError(`Bitte mindestens ${min} Zeichen schreiben.`);
  if (text.length > max) throw new ShopError(`Bitte höchstens ${max} Zeichen schreiben.`);
  if (LINK_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new ShopError('Links und Web-Adressen sind nicht erlaubt.');
  }
  return text;
}

export function quote(product, code, discountCode) {
  if (!isProduct(product)) throw new ShopError('Unbekanntes Produkt.');
  const { price } = PRODUCTS[product];
  const discounted = typeof code === 'string' && code.trim() !== '' && code.trim() === discountCode;
  const amount = discounted ? Math.round((price * (100 - DISCOUNT_PERCENT)) / 100) : price;
  return { product, price, amount, discounted };
}
