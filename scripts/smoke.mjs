import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
// HERMES_PWA_DIST lets the smoke gate check a candidate build (dist-candidate)
// without requiring a rebuild of the live `dist` the LaunchAgent serves.
const distDir = process.env.HERMES_PWA_DIST || 'dist';
const required = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
].map((file) => `${distDir}/${file}`);
const missing = required.filter((file) => !existsSync(join(root, file)));
if (missing.length) {
  console.error(`Missing build outputs:\n${missing.join('\n')}`);
  process.exit(1);
}
const html = readFileSync(join(root, `${distDir}/index.html`), 'utf8');
for (const needle of ['Hermes Mobile PWA', '/manifest.webmanifest']) {
  if (!html.includes(needle)) {
    console.error(`${distDir}/index.html missing marker: ${needle}`);
    process.exit(1);
  }
}
console.log(`Smoke OK: ${distDir} app shell is present.`);
