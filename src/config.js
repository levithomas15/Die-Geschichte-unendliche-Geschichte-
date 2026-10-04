// Alle Preise in Cent. Hier anpassen, wenn sich ein Preis oder Text ändern soll.
export const PRODUCTS = {
  sentence: {
    name: 'Einen Satz schreiben',
    price: 100,
    description: 'Hänge einen Satz an das Ende der Geschichte an.',
  },
  delete: {
    name: 'Einen Satz löschen',
    price: 200,
    description: 'Lösche einen beliebigen Satz aus der Geschichte.',
  },
  title: {
    name: 'Den Titel bestimmen',
    price: 500,
    description: 'Nur einmal pro Band: Wer zuerst kauft, gibt der Geschichte ihren Namen.',
  },
  page: {
    name: 'Eine Seite schreiben',
    price: 5000,
    description: 'Schreib eine ganze Seite am Stück.',
  },
  end: {
    name: 'Das Ende schreiben',
    price: 90000,
    description: 'Schreib das Ende dieses Bandes. Danach beginnt ein neuer Band.',
  },
  name: {
    name: 'Name auf der Startseite',
    price: 1200,
    description: 'Dein Name wird für alle sichtbar auf der Startseite veröffentlicht.',
  },
};

export const DISCOUNT_PERCENT = 30;

// Erlaubte Textlänge (Zeichen) je Produkt: [min, max]
export const LIMITS = {
  sentence: [2, 280],
  page: [20, 3000],
  end: [20, 5000],
  title: [2, 100],
  name: [2, 40],
};

// So lange ist die Stripe-Bezahlseite offen (Stripe verlangt mindestens 30 Minuten) …
export const CHECKOUT_MINUTES = 31;
// … und so lange bleiben Titel, Ende oder ein zu löschender Satz währenddessen für andere reserviert.
export const RESERVATION_MINUTES = 35;
