# Die unendliche Geschichte

Eine Website, auf der alle gemeinsam eine Geschichte schreiben – und jeder Schritt kostet Geld.

| Was                            | Preis | Mit Code `1589` (−30 %) |
| ------------------------------ | ----: | ----------------------: |
| Einen Satz schreiben           |   1 € |                  0,70 € |
| Einen Satz löschen             |   2 € |                  1,40 € |
| Den Titel bestimmen (nur der Erste) | 5 € |                3,50 € |
| Eine Seite schreiben           |  50 € |                    35 € |
| Das Ende schreiben             | 900 € |                   630 € |
| Name auf der Startseite        |  12 € |                  8,40 € |

- Nach jedem Kauf bekommt der Käufer den Rabattcode **1589** angezeigt (−30 % auf den nächsten Kauf).
- Den Titel kann pro Band nur der Erste kaufen. Während jemand bezahlt, ist er 35 Minuten reserviert. Bezahlen zwei trotzdem gleichzeitig, bekommt der Zweite sein Geld automatisch zurück.
- Wer das Ende kauft, schließt den aktuellen Band ab. Er landet im **Archiv**, und ein neuer Band beginnt – die Geschichte bleibt also unendlich.
- Bezahlt wird über **Stripe** (Karte, PayPal, Klarna, Apple Pay … – je nachdem, was im Stripe-Dashboard aktiviert ist).

## Lokal ausprobieren (Demo-Modus)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 22.

```bash
npm install
npm start
```

Dann <http://localhost:3000> öffnen. Ohne Stripe-Schlüssel läuft die Seite im **Demo-Modus**: Jeder Kauf wird sofort und kostenlos ausgeführt, oben steht ein Hinweisbalken.

## Live gehen

1. **Stripe-Konto** auf <https://stripe.com> anlegen und unter *Entwickler → API-Schlüssel* den geheimen Schlüssel kopieren (`sk_test_…` zum Testen, `sk_live_…` für echtes Geld).
2. **Hoster** mit dauerhaftem Speicher wählen, z. B. Render, Railway, Fly.io oder ein eigener Server. Wichtig: Der Ordner aus `DATA_DIR` muss dauerhaft gespeichert werden (dort liegt die Datenbank mit der ganzen Geschichte).
   - Startbefehl: `npm start`, Build-Befehl: `npm install`
3. **Umgebungsvariablen** beim Hoster setzen (siehe `.env.example`):
   - `STRIPE_SECRET_KEY`, `BASE_URL` (z. B. `https://deine-domain.de`), `ADMIN_PASSWORD`, `DATA_DIR`, `NODE_ENV=production`
4. **Stripe-Webhook** anlegen: *Entwickler → Webhooks → Endpunkt hinzufügen*
   - URL: `https://deine-domain.de/api/stripe/webhook`
   - Ereignisse: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Das Signatur-Geheimnis (`whsec_…`) als `STRIPE_WEBHOOK_SECRET` eintragen.
5. **Impressum, AGB und Datenschutz** in `public/impressum.html` ausfüllen (gelb markierte Stellen) und am besten rechtlich prüfen lassen. Wer in Deutschland etwas verkauft, braucht ein Impressum.

Mit `NODE_ENV=production` startet die Seite nur, wenn ein Stripe-Schlüssel gesetzt ist – so kann der Demo-Modus nicht aus Versehen live gehen.

## Moderation

Unter `/admin` (Benutzername egal, Passwort = `ADMIN_PASSWORD`) kannst du beleidigende oder rechtswidrige Sätze, Seiten, Namen und Titel entfernen und alle Bestellungen sehen. Links und Web-Adressen werden schon beim Kauf abgelehnt.

## Anpassen

- **Preise, Texte, Zeichenlimits:** `src/config.js`
- **Rabattcode:** Umgebungsvariable `DISCOUNT_CODE` (Standard `1589`), Rabatthöhe in `src/config.js`
- **Aussehen:** `public/style.css`

## Aufbau

```
server.js          Start, liest die Umgebungsvariablen
src/config.js      Preise und Limits
src/db.js          SQLite-Datenbank
src/shop.js        Bestellungen prüfen und ausführen
src/app.js         Webserver, Stripe, Webhook, Admin
public/            Startseite, Erfolgsseite, Archiv, Impressum
admin/             Moderationsseite
test/              Tests (npm test)
```
