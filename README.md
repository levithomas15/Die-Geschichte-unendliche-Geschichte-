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

## Online

### Vorschau auf GitHub Pages

**<https://levithomas15.github.io/Die-Geschichte-unendliche-Geschichte-/>**

Die Vorschau zeigt die echte Oberfläche, läuft aber komplett im Browser: Es wird **kein Geld** berechnet, und jeder Besucher sieht nur seine **eigene** Geschichte (gespeichert im Browser). GitHub Pages kann keine Server-Programme ausführen – für die echte Version mit Bezahlung siehe unten.

Bei jedem Push auf den Standard-Branch baut die GitHub Action `.github/workflows/pages.yml` die Vorschau neu (Branch `gh-pages`).

**Einmalig einschalten** (nur der Besitzer des Repos kann das):
*Settings → Pages → Build and deployment → Source: „Deploy from a branch“ → Branch: `gh-pages`, Ordner `/ (root)` → Save.*
Nach ein bis zwei Minuten ist die Seite unter der Adresse oben erreichbar.

Eigene Domain (z. B. `unendliche-geschichte.de`): unter *Settings → Pages → Custom domain* eintragen und beim Domain-Anbieter einen CNAME-Eintrag auf `levithomas15.github.io` setzen.

### Echte Version mit Bezahlung (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/levithomas15/Die-Geschichte-unendliche-Geschichte-)

1. **Stripe-Konto** auf <https://stripe.com> anlegen und unter *Entwickler → API-Schlüssel* den geheimen Schlüssel kopieren (`sk_test_…` zum Testen, `sk_live_…` für echtes Geld).
2. Auf den Knopf oben klicken, bei Render mit GitHub anmelden und die abgefragten Werte eintragen: `STRIPE_SECRET_KEY` (Pflicht – ohne startet die Seite nicht), `ADMIN_PASSWORD` (für `/admin`). `STRIPE_WEBHOOK_SECRET` kann erst einmal leer bleiben.
   - Die Vorlage `render.yaml` nutzt den kostenpflichtigen Tarif *Starter* mit 1 GB Festplatte. Der Gratis-Tarif hat keine dauerhafte Festplatte – die Geschichte wäre nach jedem Neustart weg.
   - Danach läuft die Seite unter `https://<name>.onrender.com`. Eine eigene Domain lässt sich bei Render unter *Settings → Custom Domains* verbinden.
3. **Stripe-Webhook** anlegen: *Entwickler → Webhooks → Endpunkt hinzufügen*
   - URL: `https://<deine-adresse>/api/stripe/webhook`
   - Ereignisse: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - Das Signatur-Geheimnis (`whsec_…`) bei Render unter *Environment* als `STRIPE_WEBHOOK_SECRET` eintragen.
4. **Impressum, AGB und Datenschutz** in `public/impressum.html` ausfüllen (gelb markierte Stellen) und am besten rechtlich prüfen lassen. Wer in Deutschland etwas verkauft, braucht ein Impressum.

Andere Hoster (Railway, Fly.io, eigener Server) gehen genauso: Build-Befehl `npm ci`, Startbefehl `npm start`, Umgebungsvariablen wie in `.env.example`, und der Ordner aus `DATA_DIR` muss dauerhaft gespeichert werden. Mit `NODE_ENV=production` startet die Seite nur, wenn ein Stripe-Schlüssel gesetzt ist – so kann der Demo-Modus nicht aus Versehen live gehen.

## Lokal ausprobieren (Demo-Modus)

Voraussetzung: [Node.js](https://nodejs.org) ab Version 22.9.

```bash
npm install
npm start
```

Dann <http://localhost:3000> öffnen. Ohne Stripe-Schlüssel läuft die Seite im **Demo-Modus**: Jeder Kauf wird sofort und kostenlos ausgeführt, oben steht ein Hinweisbalken.

Die GitHub-Pages-Vorschau lokal bauen: `node scripts/build-pages.mjs` (Ergebnis in `dist-pages/`).

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
src/rules.js       Preis- und Textregeln (auch für die Vorschau)
src/shop.js        Bestellungen prüfen und ausführen
src/app.js         Webserver, Stripe, Webhook, Admin
public/            Startseite, Erfolgsseite, Archiv, Impressum
admin/             Moderationsseite
pages/             Browser-Backend für die GitHub-Pages-Vorschau
scripts/           Build der Vorschau
render.yaml        Vorlage für Render
test/              Tests (npm test)
```
