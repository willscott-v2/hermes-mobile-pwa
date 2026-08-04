import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const required = [
  'dist/index.html',
  'dist/manifest.webmanifest',
  'dist/sw.js',
  'dist/icons/icon.svg',
  'dist/icons/icon-192.png',
  'dist/icons/icon-512.png',
  'dist/icons/apple-touch-icon.png',
  'dist/icons/favicon-32.png',
];
const missing = required.filter((file) => !existsSync(join(root, file)));
if (missing.length) {
  console.error(`Missing build outputs:\n${missing.join('\n')}`);
  process.exit(1);
}
const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
for (const needle of ['Hermes Mobile PWA', '/manifest.webmanifest']) {
  if (!html.includes(needle)) {
    console.error(`dist/index.html missing marker: ${needle}`);
    process.exit(1);
  }
}
console.log('Smoke OK: dist app shell is present.');
