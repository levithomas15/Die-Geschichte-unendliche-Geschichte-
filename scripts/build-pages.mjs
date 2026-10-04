// Baut die statische Vorschau für GitHub Pages: public/ + Browser-Backend, ohne Server.
// Aufruf: node scripts/build-pages.mjs [Zielordner]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] ?? 'dist-pages');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.copyFileSync(path.join(root, 'pages', 'demo-backend.js'), path.join(out, 'demo-backend.js'));
fs.mkdirSync(path.join(out, 'lib'));
for (const file of ['config.js', 'rules.js']) {
  fs.copyFileSync(path.join(root, 'src', file), path.join(out, 'lib', file));
}

const marker = '<html lang="de">';
for (const file of fs.readdirSync(out).filter((name) => name.endsWith('.html'))) {
  const target = path.join(out, file);
  const html = fs.readFileSync(target, 'utf8');
  if (!html.includes(marker)) throw new Error(`${file}: ${marker} nicht gefunden`);
  fs.writeFileSync(target, html.replace(marker, '<html lang="de" data-backend="static">'));
}

// Ohne diese Datei würde GitHub Pages die Seite durch Jekyll schicken.
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Vorschau gebaut: ${path.relative(root, out)}/`);
