import { api, el, renderStory } from './story.js';

const container = document.getElementById('volumes');

try {
  const volumes = await api('api/archive');
  if (!volumes.length) {
    container.append(el('p', 'card', 'Noch ist kein Band zu Ende geschrieben. Das Ende kann man auf der Startseite kaufen.'));
  }
  for (const volume of volumes) {
    const card = el('article', 'card volume-card');
    const finished = new Date(volume.finished_at).toLocaleDateString('de-DE', { dateStyle: 'long' });
    card.append(
      el('p', 'volume', `Band ${volume.id} · beendet am ${finished}`),
      el('h2', null, volume.title ?? 'Ohne Titel'),
      renderStory(el('div', 'story'), volume.entries),
    );
    container.append(card);
  }
} catch (err) {
  container.append(el('p', 'error', err.message));
}
