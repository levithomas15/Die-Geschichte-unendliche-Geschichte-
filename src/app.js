import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CHECKOUT_MINUTES, DISCOUNT_PERCENT, LIMITS, PRODUCTS } from './config.js';
import { ShopError, createShop } from './shop.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const hit = hits.get(req.ip);
    if (!hit || hit.reset < now) {
      hits.set(req.ip, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) {
        for (const [ip, old] of hits) if (old.reset < now) hits.delete(ip);
      }
    } else if (++hit.count > max) {
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte warte ein paar Minuten.' });
    }
    next();
  };
}

function safeEqual(a, b) {
  const hash = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function preview(order) {
  const { text, entryId } = JSON.parse(order.payload);
  if (order.product === 'delete') return `Satz Nr. ${entryId}`;
  return text.length > 200 ? `„${text.slice(0, 199)}…“` : `„${text}“`;
}

export function createApp({
  db,
  stripe = null,
  webhookSecret = null,
  baseUrl = null,
  adminPassword = null,
  discountCode = '1589',
  trustProxy = false,
}) {
  const shop = createShop(db, { discountCode });
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  // Bestellung ausführen; wenn das nicht mehr geht (z. B. Titel schon vergeben), Geld zurück.
  async function settle(orderId, paymentIntent) {
    const result = shop.fulfill(orderId);
    if (result.status !== 'conflict') return;
    if (!stripe || !paymentIntent) {
      shop.setStatus(orderId, 'failed', result.reason);
      return;
    }
    try {
      await stripe.refunds.create({ payment_intent: paymentIntent, metadata: { order_id: orderId } });
      shop.setStatus(orderId, 'refunded', result.reason);
    } catch (err) {
      console.error(`Rückerstattung für Bestellung ${orderId} fehlgeschlagen:`, err.message);
      shop.setStatus(orderId, 'failed', `${result.reason} Rückerstattung fehlgeschlagen: ${err.message}`);
    }
  }

  // Muss vor express.json() stehen: Stripe signiert den unveränderten Request-Body.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !webhookSecret) return res.status(404).end();
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook-Fehler: ${err.message}`);
    }

    const session = event.data.object;
    const orderId = session.metadata?.order_id;
    if (orderId && shop.getOrder(orderId)) {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          if (session.payment_status === 'paid') await settle(orderId, session.payment_intent);
          break;
        case 'checkout.session.expired':
          shop.cancelOrder(orderId, 'expired');
          break;
        case 'checkout.session.async_payment_failed':
          shop.cancelOrder(orderId, 'failed', 'Zahlung fehlgeschlagen.');
          break;
      }
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: '32kb' }));

  app.get('/api/state', (req, res) => {
    res.json({
      ...shop.getState(),
      demo: !stripe,
      discountPercent: DISCOUNT_PERCENT,
      limits: LIMITS,
      products: Object.entries(PRODUCTS).map(([id, product]) => ({ id, ...product })),
    });
  });

  app.get('/api/archive', (req, res) => res.json(shop.getArchive()));

  app.post('/api/quote', rateLimit({ windowMs: 10 * 60_000, max: 60 }), (req, res) => {
    res.json(shop.quote(req.body?.product, req.body?.code));
  });

  app.post('/api/checkout', rateLimit({ windowMs: 10 * 60_000, max: 20 }), async (req, res) => {
    const { product, text, entryId, code, agree } = req.body ?? {};
    if (agree !== true) throw new ShopError('Bitte bestätige zuerst die Bedingungen.');
    const order = shop.createOrder({ product, text, entryId, code });

    if (!stripe) {
      await settle(order.id);
      return res.json({ url: `/erfolg?order=${order.id}` });
    }

    const origin = baseUrl || `${req.protocol}://${req.get('host')}`;
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        locale: 'de',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: order.amount,
              product_data: { name: PRODUCTS[order.product].name, description: preview(order) },
            },
          },
        ],
        metadata: { order_id: order.id },
        payment_intent_data: { metadata: { order_id: order.id } },
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
        success_url: `${origin}/erfolg?order=${order.id}`,
        cancel_url: `${origin}/?abgebrochen=${order.id}`,
      });
      shop.setSession(order.id, session.id);
      res.json({ url: session.url });
    } catch (err) {
      console.error('Stripe-Checkout konnte nicht erstellt werden:', err.message);
      shop.cancelOrder(order.id, 'failed', err.message);
      res.status(502).json({ error: 'Die Bezahlung konnte gerade nicht gestartet werden. Bitte versuch es später noch einmal.' });
    }
  });

  app.get('/api/orders/:id', async (req, res) => {
    let order = shop.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });

    // Falls der Webhook (noch) nicht angekommen ist, direkt bei Stripe nachfragen.
    if (order.status === 'pending' && stripe && order.stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
        if (session.payment_status === 'paid') await settle(order.id, session.payment_intent);
        else if (session.status === 'expired') shop.cancelOrder(order.id, 'expired');
        order = shop.getOrder(order.id);
      } catch (err) {
        console.error(`Stripe-Abfrage für Bestellung ${order.id} fehlgeschlagen:`, err.message);
      }
    }

    res.json({
      status: order.status,
      product: order.product,
      productName: PRODUCTS[order.product].name,
      amount: order.amount,
      reason: order.status === 'refunded' ? order.error : undefined,
      discountCode: order.status === 'fulfilled' ? discountCode : undefined,
      discountPercent: DISCOUNT_PERCENT,
    });
  });

  // Abgebrochene Bezahlung: Reservierung (Titel, Ende, Satz) sofort wieder freigeben.
  app.post('/api/orders/:id/cancel', async (req, res) => {
    const order = shop.getOrder(req.params.id);
    if (!order || order.status !== 'pending') return res.json({ ok: true });
    try {
      if (stripe && order.stripe_session_id) await stripe.checkout.sessions.expire(order.stripe_session_id);
      shop.cancelOrder(order.id, 'expired');
    } catch (err) {
      // Session wurde inzwischen bezahlt oder ist schon abgelaufen – dann bleibt alles, wie es ist.
      console.error(`Abbruch von Bestellung ${order.id} nicht möglich:`, err.message);
    }
    res.json({ ok: true });
  });

  const admin = express.Router();
  admin.use((req, res, next) => {
    if (!adminPassword) return res.status(404).end();
    const [scheme, encoded = ''] = (req.get('authorization') || '').split(' ');
    const password = scheme === 'Basic' ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
    if (!safeEqual(password, adminPassword)) {
      return res.set('WWW-Authenticate', 'Basic realm="Admin", charset="UTF-8"').status(401).send('Login erforderlich');
    }
    // Schutz gegen Cross-Site-Requests: der Browser sendet Basic-Auth sonst automatisch mit.
    if (req.method !== 'GET' && req.get('x-admin') !== '1') return res.status(403).end();
    next();
  });
  admin.use(express.static(path.join(ROOT, 'admin')));
  admin.get('/api/overview', (req, res) => res.json(shop.adminOverview()));
  admin.post('/api/entries/:id/hide', (req, res) => res.json({ ok: shop.hideEntry(Number(req.params.id)) }));
  admin.post('/api/names/:id/hide', (req, res) => res.json({ ok: shop.hideName(Number(req.params.id)) }));
  admin.post('/api/stories/:id/reset-title', (req, res) => res.json({ ok: shop.resetTitle(Number(req.params.id)) }));
  app.use('/admin', admin);

  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  app.use((err, req, res, next) => {
    if (err instanceof ShopError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Ungültige Anfrage.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Da ist etwas schiefgelaufen. Bitte versuch es später noch einmal.' });
  });

  return app;
}
