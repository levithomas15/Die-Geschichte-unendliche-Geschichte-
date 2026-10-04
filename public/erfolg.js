import { api } from './story.js';

const $ = (id) => document.getElementById(id);

const DONE = {
  sentence: 'Dein Satz steht jetzt in der Geschichte.',
  delete: 'Der Satz ist aus der Geschichte verschwunden.',
  title: 'Die Geschichte trägt jetzt deinen Titel.',
  page: 'Deine Seite ist jetzt Teil der Geschichte.',
  end: 'Du hast das Ende geschrieben. Ab jetzt beginnt ein neuer Band.',
  name: 'Dein Name steht jetzt auf der Startseite.',
};

function show(headline, message) {
  $('headline').textContent = headline;
  $('message').textContent = message;
}

async function check(attempt = 0) {
  const id = new URLSearchParams(location.search).get('order');
  if (!id) return show('Keine Bestellung gefunden', 'Dieser Link ist unvollständig.');

  let order;
  try {
    order = await api(`/api/orders/${encodeURIComponent(id)}`);
  } catch (err) {
    return show('Keine Bestellung gefunden', err.message);
  }

  switch (order.status) {
    case 'fulfilled':
      show('Danke!', DONE[order.product]);
      $('discount-code').textContent = order.discountCode;
      $('code-hint').textContent = `= −${order.discountPercent} % auf alles`;
      $('code-box').hidden = false;
      break;
    case 'refunded':
      show('Leider zu spät', `${order.reason} Du bekommst dein Geld automatisch zurück.`);
      break;
    case 'expired':
      show('Bezahlung abgebrochen', 'Es wurde nichts berechnet.');
      break;
    case 'failed':
    case 'conflict':
      show('Das hat nicht geklappt', 'Bitte melde dich bei uns (siehe Impressum). Wir kümmern uns darum.');
      break;
    default:
      if (attempt < 30) return setTimeout(() => check(attempt + 1), 2000);
      show(
        'Zahlung wird noch bestätigt',
        'Das kann bei manchen Zahlarten etwas dauern. Sobald die Zahlung da ist, wird dein Kauf automatisch ausgeführt.',
      );
  }
}

check();
