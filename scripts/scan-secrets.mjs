import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const skip = new Set(['.git', 'node_modules', 'dist', '.hermes']);
const patterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b(?:api[_-]?key|secret|password|token)\s*=\s*['"][^'"]{8,}['"]/i, 'assigned credential'],
  [/Bearer\s+[A-Za-z0-9._~+\/-]{16,}/, 'bearer token'],
  [/ghp_[A-Za-z0-9_]{20,}/, 'GitHub PAT'],
  [/xox[baprs]-[A-Za-z0-9-]{20,}/, 'Slack token'],
  [/\b[a-z0-9-]+\.tail[0-9a-z-]+\.ts\.net\b/i, 'private Tailnet hostname'],
  [/\/Users\/(?:bob|willscott)\b/, 'local user path'],
];
const allowFiles = new Set(['README.md', 'SECURITY.md', 'docs/ARCHITECTURE.md', '.env.example']);
const findings = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (st.isFile() && st.size < 500_000) {
      const rel = relative(root, path);
      const text = readFileSync(path, 'utf8');
      for (const [regex, label] of patterns) {
        if (regex.test(text) && !allowFiles.has(rel)) findings.push(`${rel}: ${label}`);
      }
    }
  }
}
walk(root);
if (findings.length) {
  console.error(`Potential secret findings:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('Secret scan OK: no obvious credentials found.');
