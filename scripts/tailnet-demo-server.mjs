import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import httpProxy from 'http-proxy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 4179);
const target = process.env.HERMES_DASHBOARD_TARGET || 'http://127.0.0.1:9119';
const proxyPrefix = process.env.HERMES_PROXY_PREFIX || '/hermes';

const proxy = httpProxy.createProxyServer({
  target,
  changeOrigin: true,
  secure: true,
  ws: true,
});

proxy.on('error', (error, _req, res) => {
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
  }
  if (res && !res.destroyed) {
    res.end(JSON.stringify({ error: 'proxy_failed', detail: error.message }));
  }
});

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

function stripPrefix(url) {
  return url === proxyPrefix ? '/' : url.slice(proxyPrefix.length) || '/';
}

function serveStatic(req, res) {
  const rawPath = new URL(req.url || '/', 'http://localhost').pathname;
  const normalized = path.normalize(decodeURIComponent(rawPath)).replace(/^\.{2,}/, '');
  const requested = normalized === '/' ? '/index.html' : normalized;
  const filePath = path.join(dist, requested);
  const safe = filePath.startsWith(dist);
  const finalPath = safe && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(dist, 'index.html');
  const ext = path.extname(finalPath);
  const basename = path.basename(finalPath);
  const cacheControl = finalPath.endsWith('index.html') || basename === 'sw.js' || basename.endsWith('.webmanifest')
    ? 'no-store'
    : 'public, max-age=60';
  res.writeHead(200, {
    'Content-Type': contentTypes.get(ext) || 'application/octet-stream',
    'Cache-Control': cacheControl,
  });
  fs.createReadStream(finalPath).pipe(res);
}

const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith(proxyPrefix)) {
    req.url = stripPrefix(req.url || '/');
    proxy.web(req, res);
    return;
  }
  serveStatic(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').startsWith(proxyPrefix)) {
    req.url = stripPrefix(req.url || '/');
    proxy.ws(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Hermes Mobile PWA demo: http://127.0.0.1:${port}`);
  console.log(`Proxying ${proxyPrefix} -> ${target}`);
});
