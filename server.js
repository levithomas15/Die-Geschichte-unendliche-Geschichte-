import path from 'node:path';
import Stripe from 'stripe';
import { createApp } from './src/app.js';
import { openDb } from './src/db.js';

const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  BASE_URL,
  ADMIN_PASSWORD,
  DISCOUNT_CODE = '1589',
  DATA_DIR = './data',
  PORT = '3000',
  TRUST_PROXY,
  NODE_ENV,
} = process.env;

if (!STRIPE_SECRET_KEY && NODE_ENV === 'production') {
  console.error('STRIPE_SECRET_KEY fehlt. Ohne Stripe-Schlüssel startet die Seite nur im Demo-Modus (nicht in Produktion).');
  process.exit(1);
}

if (!STRIPE_SECRET_KEY) {
  console.warn('⚠️  Demo-Modus: Kein STRIPE_SECRET_KEY gesetzt – Käufe werden sofort und kostenlos ausgeführt.');
} else if (!STRIPE_WEBHOOK_SECRET) {
  console.warn('⚠️  STRIPE_WEBHOOK_SECRET fehlt: Käufe werden nur bestätigt, wenn der Käufer die Erfolgsseite öffnet.');
}

const app = createApp({
  db: openDb(path.join(DATA_DIR, 'geschichte.db')),
  stripe: STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null,
  webhookSecret: STRIPE_WEBHOOK_SECRET,
  baseUrl: BASE_URL?.replace(/\/+$/, ''),
  adminPassword: ADMIN_PASSWORD,
  discountCode: DISCOUNT_CODE,
  // Standard an: Hinter einem Proxy würden sich sonst alle Besucher ein Rate-Limit teilen.
  trustProxy: TRUST_PROXY !== 'false',
});

app.listen(Number(PORT), () => console.log(`Die unendliche Geschichte läuft auf http://localhost:${PORT}`));
