import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const defaultBaseURL = 'http://127.0.0.1:4183';
const baseURL = process.env.QA_BASE_URL ?? defaultBaseURL;
const outDir = new URL('../test-results/manual-mobile-ux/', import.meta.url).pathname;
await mkdir(outDir, { recursive: true });

let server;
if (!process.env.QA_BASE_URL) {
  server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4183'], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(baseURL, 15_000);
}

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 14'], reducedMotion: 'reduce' });
const page = await context.newPage();
const logs = [];
page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));

async function metrics(label) {
  const data = await page.evaluate(() => {
    const doc = document.documentElement;
    const shell = document.querySelector('.app-shell');
    const main = document.querySelector('.main-panel');
    const messages = document.querySelector('.messages');
    const composer = document.querySelector('.composer');
    const lastMessage = Array.from(document.querySelectorAll('.message-row')).at(-1);
    const sessionList = document.querySelector('.session-list');
    const connect = document.querySelector('.connect-card');
    const rect = (el) => el ? Object.fromEntries(['top','right','bottom','left','width','height'].map((k) => [k, el.getBoundingClientRect()[k]])) : null;
    const scroll = (el) => el ? { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null;
    const rawPattern = /\[CONTEXT COMPACTION|<untrusted_tool_result|prompt\.submit|session_id|exit_code|\[terminal\]|["']method["']\s*:|["']params["']\s*:/;
    return {
      viewport: { innerWidth, innerHeight, visualHeight: visualViewport?.height ?? null, visualOffsetTop: visualViewport?.offsetTop ?? null },
      horizontalOverflow: doc.scrollWidth - doc.clientWidth,
      shell: rect(shell), main: rect(main), messages: scroll(messages), composer: rect(composer), lastMessage: rect(lastMessage), sessionList: scroll(sessionList), connect: scroll(connect),
      rawToolVisible: Array.from(document.querySelectorAll('.message-row p')).some((p) => rawPattern.test(p.textContent ?? '')),
      attachVisible: Boolean(document.querySelector('button[aria-label="Attach file or screenshot"]')),
    };
  });
  console.log(label, JSON.stringify(data));
  return data;
}

function assertNoLayoutFunk(label, data) {
  if (data.horizontalOverflow > 1) throw new Error(`${label}: horizontal overflow ${data.horizontalOverflow}px`);
  if (data.rawToolVisible) throw new Error(`${label}: raw tool/prompt JSON is visible`);
  if (data.composer) {
    const bottomGap = data.viewport.innerHeight - data.composer.bottom;
    if (bottomGap > 56) throw new Error(`${label}: composer has ${Math.round(bottomGap)}px of white/empty space below it`);
    if (data.composer.bottom > data.viewport.innerHeight + 1) throw new Error(`${label}: composer is below the viewport`);
  }
  if (data.composer && data.lastMessage && data.lastMessage.bottom > data.composer.top - 4) {
    throw new Error(`${label}: last message intersects composer`);
  }
}

await page.goto(`${baseURL}/?qa=mobile`);
await page.screenshot({ path: `${outDir}/01-connect.png` });
assertNoLayoutFunk('connect', await metrics('connect'));
await page.getByLabel('Mode').selectOption('mock');
await page.getByRole('button', { name: 'Connect' }).click();
await page.screenshot({ path: `${outDir}/02-sessions.png` });
assertNoLayoutFunk('sessions', await metrics('sessions'));
await page.getByText('Weekend reading').click();
await page.screenshot({ path: `${outDir}/03-chat.png` });
assertNoLayoutFunk('chat', await metrics('chat'));
await page.getByPlaceholder('Message Hermes…').fill('Test mobile UX');
await page.screenshot({ path: `${outDir}/04-chat-focused.png` });
assertNoLayoutFunk('chat-focused', await metrics('chat-focused'));
await page.evaluate(() => {
  window.dispatchEvent(new Event('resize'));
  document.documentElement.style.setProperty('--composer-bottom-buffer', '8px');
});
await page.screenshot({ path: `${outDir}/05-keyboard-buffer.png` });
assertNoLayoutFunk('keyboard-buffer', await metrics('keyboard-buffer'));

console.log('consoleLogs', JSON.stringify(logs));
await browser.close();
if (server) server.kill('SIGTERM');

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`QA server did not start: ${lastError?.message ?? 'timeout'}`);
}
