import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// The private Tailnet URL never lives in source: set HERMES_MOBILE_CHECK_URL, or put the URL
// alone in the gitignored .hermes/mobile-check-url.txt next to this repo.
function resolveCheckUrl() {
  const fromEnv = process.env.HERMES_MOBILE_CHECK_URL;
  if (fromEnv) return fromEnv;
  const localFile = new URL('../.hermes/mobile-check-url.txt', import.meta.url);
  if (existsSync(localFile)) return readFileSync(localFile, 'utf8').trim();
  console.error('Set HERMES_MOBILE_CHECK_URL or create .hermes/mobile-check-url.txt with the PWA URL.');
  process.exit(2);
}
const baseURL = resolveCheckUrl().replace(/\/+$/, '');
const hermesPath = process.env.HERMES_MOBILE_CHECK_HERMES_PATH || '/hermes';
const requiredPlatforms = (process.env.HERMES_MOBILE_CHECK_REQUIRED_PLATFORMS || 'photon')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const timeoutMs = Number(process.env.HERMES_MOBILE_CHECK_TIMEOUT_MS || 10_000);
const failures = [];
const warnings = [];

function check(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

function warn(name, detail = '') {
  warnings.push(`${name}${detail ? `: ${detail}` : ''}`);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchText(url, options = {}) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: timeout.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    timeout.done();
  }
}

async function checkStaticApp() {
  const { response, text } = await fetchText(`${baseURL}/`);
  check('mobile app shell HTTP 200', response.ok, `${response.status} ${response.statusText}`);
  check('mobile app shell marker', text.includes('Hermes Mobile PWA'));

  const manifest = await fetchText(`${baseURL}/manifest.webmanifest`);
  check('manifest HTTP 200', manifest.response.ok, `${manifest.response.status} ${manifest.response.statusText}`);
  check('manifest looks like JSON', manifest.text.trim().startsWith('{'));
}

async function checkDashboardProxy() {
  const statusUrl = `${baseURL}${hermesPath}/api/status`;
  const { response, text } = await fetchText(statusUrl);
  check('dashboard proxy /api/status HTTP 200', response.ok, `${response.status} ${response.statusText}: ${text.slice(0, 120)}`);
  let status;
  try {
    status = JSON.parse(text);
  } catch (error) {
    failures.push(`dashboard proxy /api/status JSON: ${error.message}`);
    return null;
  }
  check('gateway running', status.gateway_running === true || status.gateway_state === 'running', JSON.stringify({ gateway_running: status.gateway_running, gateway_state: status.gateway_state }));
  check('dashboard component ok', status.components?.dashboard?.status === 'ok', JSON.stringify(status.components?.dashboard));
  check('gateway component ok', status.components?.gateway?.status === 'ok', JSON.stringify(status.components?.gateway));
  for (const platform of requiredPlatforms) {
    const state = status.gateway_platforms?.[platform]?.state;
    check(`platform ${platform} connected`, state === 'connected', `state=${state ?? 'missing'}`);
  }
  if (status.overall && status.overall !== 'ok') warn('dashboard overall not ok', status.overall);
  return status;
}

function checkTailscaleServe() {
  try {
    const raw = execFileSync('tailscale', ['serve', 'status', '--json'], { encoding: 'utf8', timeout: timeoutMs });
    const status = JSON.parse(raw);
    const serveHost = new URL(baseURL).host;
    const handler = status.Web?.[serveHost]?.Handlers?.['/']?.Proxy;
    check('tailscale serve 8447 points at mobile demo', handler === 'http://127.0.0.1:4179', `proxy=${handler ?? 'missing'}`);
  } catch (error) {
    warn('tailscale serve status unavailable', error.message);
  }
}

async function checkMockUi() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 14'], reducedMotion: 'reduce' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (!['error', 'warning'].includes(msg.type())) return;
    const text = msg.text();
    // The unauthenticated mock-mode page may probe the remembered /hermes API
    // before the test switches to Mock demo. A 401 there is expected and does
    // not represent broken mobile functionality.
    if (/Failed to load resource: the server responded with a status of 401/.test(text)) return;
    consoleErrors.push(`${msg.type()}: ${text}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  try {
    await page.goto(`${baseURL}/?daily-check=mock`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Mode/ }).click();
    await page.getByRole('option', { name: 'Mock demo' }).click();
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByText('Weekend reading').click();
    await page.getByPlaceholder('Message Hermes…').fill('Daily functional check');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.getByText(/Daily functional check/).waitFor({ timeout: timeoutMs });
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const composer = document.querySelector('.composer');
      const bannerText = Array.from(document.querySelectorAll('.error-banner, .info-banner')).map((node) => node.textContent || '').join('\n');
      const rect = composer?.getBoundingClientRect();
      return {
        horizontalOverflow: doc.scrollWidth - doc.clientWidth,
        composerBottom: rect?.bottom ?? null,
        innerHeight,
        bannerText,
        gatewaySocketErrorVisible: document.body.textContent?.includes('Gateway socket error.') ?? false,
      };
    });
    check('mock UI no horizontal overflow', metrics.horizontalOverflow <= 1, `${metrics.horizontalOverflow}px`);
    check('mock UI composer visible', metrics.composerBottom !== null && metrics.composerBottom <= metrics.innerHeight + 1, JSON.stringify(metrics));
    check('mock UI has no gateway socket error banner', !metrics.gatewaySocketErrorVisible, metrics.bannerText);
    check('mock UI console clean', consoleErrors.length === 0, consoleErrors.join('; '));
  } finally {
    await browser.close();
  }
}

function wsURL(path, params) {
  const url = new URL(`${baseURL}${path}`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function openWebSocket(url) {
  if (typeof WebSocket === 'undefined') {
    warn('live websocket check skipped', 'global WebSocket is unavailable in this Node runtime');
    return;
  }
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('websocket open timed out'));
    }, timeoutMs);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      socket.close(1000, 'daily check');
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('websocket error'));
    }, { once: true });
  });
}

async function checkLiveWebSocketIfConfigured() {
  const token = process.env.HERMES_MOBILE_CHECK_TOKEN;
  const username = process.env.HERMES_MOBILE_CHECK_USERNAME;
  const password = process.env.HERMES_MOBILE_CHECK_PASSWORD;
  if (token) {
    await openWebSocket(wsURL(`${hermesPath}/api/ws`, { token }));
    return 'token';
  }
  if (!username || !password) {
    warn('live websocket check skipped', 'set HERMES_MOBILE_CHECK_USERNAME/PASSWORD or HERMES_MOBILE_CHECK_TOKEN to test the authenticated gateway socket');
    return 'skipped';
  }

  const login = await fetchText(`${baseURL}${hermesPath}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'basic', username, password }),
  });
  check('password login HTTP 200', login.response.ok, `${login.response.status} ${login.text.slice(0, 120)}`);
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
  check('password login returned cookie', Boolean(cookie));
  if (!login.response.ok || !cookie) return 'failed';

  const ticket = await fetchText(`${baseURL}${hermesPath}/api/auth/ws-ticket`, { method: 'POST', headers: { cookie } });
  check('ws-ticket HTTP 200', ticket.response.ok, `${ticket.response.status} ${ticket.text.slice(0, 120)}`);
  let payload;
  try { payload = JSON.parse(ticket.text); } catch (error) { failures.push(`ws-ticket JSON: ${error.message}`); return 'failed'; }
  check('ws-ticket present', Boolean(payload.ticket));
  if (!payload.ticket) return 'failed';
  await openWebSocket(wsURL(`${hermesPath}/api/ws`, { ticket: payload.ticket }));
  return 'password';
}

async function main() {
  console.log(`Daily Hermes Mobile functional check: ${baseURL}`);
  checkTailscaleServe();
  await checkStaticApp();
  const status = await checkDashboardProxy();
  await checkMockUi();
  const liveMode = await checkLiveWebSocketIfConfigured().catch((error) => failures.push(`live websocket open: ${error.message}`));

  const result = {
    ok: failures.length === 0,
    baseURL,
    requiredPlatforms,
    liveWebSocket: liveMode || 'failed',
    gatewayState: status?.gateway_state,
    overall: status?.overall,
    failures,
    warnings,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
