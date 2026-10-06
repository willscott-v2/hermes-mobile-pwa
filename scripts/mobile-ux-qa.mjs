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
    const attention = document.querySelector('.attention-card');
    const rect = (el) => el ? Object.fromEntries(['top','right','bottom','left','width','height'].map((k) => [k, el.getBoundingClientRect()[k]])) : null;
    const scroll = (el) => el ? { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null;
    const rawPattern = /\[CONTEXT COMPACTION|<untrusted_tool_result|prompt\.submit|session_id|exit_code|\[terminal\]|["']method["']\s*:|["']params["']\s*:/;
    return {
      viewport: { innerWidth, innerHeight, visualHeight: visualViewport?.height ?? null, visualOffsetTop: visualViewport?.offsetTop ?? null },
      horizontalOverflow: doc.scrollWidth - doc.clientWidth,
      shell: rect(shell), main: rect(main), messages: scroll(messages), composer: rect(composer), lastMessage: rect(lastMessage), sessionList: scroll(sessionList), connect: scroll(connect), attention: rect(attention),
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
  if (data.attention && (data.attention.right > data.viewport.innerWidth + 1 || data.attention.bottom > data.viewport.innerHeight + 1)) {
    throw new Error(`${label}: attention card is outside the mobile viewport`);
  }
  if (data.attention && data.composer && data.attention.bottom > data.composer.top - 4) {
    throw new Error(`${label}: attention card intersects composer`);
  }
  if (data.composer) {
    const bottomGap = data.viewport.innerHeight - data.composer.bottom;
    if (bottomGap > 56) throw new Error(`${label}: composer has ${Math.round(bottomGap)}px of white/empty space below it`);
    if (data.composer.bottom > data.viewport.innerHeight + 1) throw new Error(`${label}: composer is below the viewport`);
  }
  if (data.composer && data.lastMessage && data.lastMessage.bottom > data.composer.top - 4) {
    throw new Error(`${label}: last message intersects composer`);
  }
}

// History and restored attention now load asynchronously; wait briefly before judging visibility.
async function visibleSoon(locator, timeoutMs = 5000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

await page.goto(`${baseURL}/?qa=mobile`);
await page.screenshot({ path: `${outDir}/01-connect.png` });
assertNoLayoutFunk('connect', await metrics('connect'));
await page.getByRole('button', { name: /Mode/ }).click();
await page.getByRole('option', { name: 'Mock demo' }).click();
await page.getByRole('button', { name: 'Connect' }).click();
await page.screenshot({ path: `${outDir}/02-sessions.png` });
assertNoLayoutFunk('sessions', await metrics('sessions'));
await page.getByText('Lisbon trip').click();
if (!(await visibleSoon(page.getByRole('button', { name: 'Yes', exact: true })))) throw new Error('clarify-attention-card: restored answer action is not visible');
await page.screenshot({ path: `${outDir}/03-clarify-attention-card.png` });
assertNoLayoutFunk('clarify-attention-card', await metrics('clarify-attention-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Deployment question').click();
if (!(await visibleSoon(page.getByRole('textbox', { name: 'Answer Hermes' })))) throw new Error('free-text-clarify-card: answer input is not visible');
if (!(await visibleSoon(page.getByText('Ready. Send a message to continue this session.')))) throw new Error('free-text-clarify-card: restored transcript is not visible');
await page.screenshot({ path: outDir + '/03b-free-text-clarify-card.png' });
assertNoLayoutFunk('free-text-clarify-card', await metrics('free-text-clarify-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Campaign regions').click();
if (!(await visibleSoon(page.getByRole('button', { name: 'Choose multiple answers in full dashboard' }))) || !(await page.getByRole('button', { name: 'Choose multiple answers in full dashboard' }).isDisabled())) throw new Error('multi-select-attention-card: unsafe single-choice action is enabled');
await page.screenshot({ path: outDir + '/03c-multi-select-attention-card.png' });
assertNoLayoutFunk('multi-select-attention-card', await metrics('multi-select-attention-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Morning news digest').click();
if (!(await visibleSoon(page.getByRole('heading', { name: 'Approval needed' })))) throw new Error('approval-attention-card: restored approval is not visible');
if (!(await visibleSoon(page.getByText('Ready. Send a message to continue this session.')))) throw new Error('approval-attention-card: restored transcript is not visible');
await page.screenshot({ path: `${outDir}/04-approval-attention-card.png` });
assertNoLayoutFunk('approval-attention-card', await metrics('approval-attention-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Deny-only approval').click();
if (!(await visibleSoon(page.getByRole('button', { name: 'Deny', exact: true })))) throw new Error('deny-only-approval-card: deny action is not visible');
if ((await page.getByRole('button', { name: 'Approve once' }).count()) !== 0) throw new Error('deny-only-approval-card: disallowed approve-once action is visible');
await page.screenshot({ path: outDir + '/04a-deny-only-approval-card.png' });
assertNoLayoutFunk('deny-only-approval-card', await metrics('deny-only-approval-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Current gateway approval').click();
if (!(await visibleSoon(page.getByRole('button', { name: 'Approve once' })))) throw new Error('current-approval-card: current-protocol approve action is not visible');
await page.screenshot({ path: outDir + '/04b-current-approval-card.png' });
assertNoLayoutFunk('current-approval-card', await metrics('current-approval-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Interrupted approval').click();
if (!(await visibleSoon(page.getByRole('button', { name: 'Response actions unavailable here' }))) || !(await page.getByRole('button', { name: 'Response actions unavailable here' }).isDisabled())) throw new Error('interrupted-approval-card: missing request id did not produce a disabled fallback');
if (!(await visibleSoon(page.getByText('Ready. Send a message to continue this session.')))) throw new Error('interrupted-approval-card: restored transcript is not visible');
await page.screenshot({ path: `${outDir}/04b-interrupted-approval-card.png` });
assertNoLayoutFunk('interrupted-approval-card', await metrics('interrupted-approval-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Deployment credentials').click();
if (!(await visibleSoon(page.getByRole('heading', { name: 'Secret needed' })))) throw new Error('secret-attention-card: secret fallback is not visible');
if ((await page.locator('.attention-card').innerText()).includes('DEPLOY_TOKEN')) throw new Error('secret-attention-card: environment key is visible');
await page.screenshot({ path: `${outDir}/05-secret-attention-card.png` });
assertNoLayoutFunk('secret-attention-card', await metrics('secret-attention-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('System update', { exact: true }).click();
if (!(await visibleSoon(page.getByRole('heading', { name: 'Sudo password needed' })))) throw new Error('sudo-attention-card: current-protocol fallback is not visible');
if (!(await visibleSoon(page.getByRole('button', { name: 'Enter in full dashboard' }))) || !(await page.getByRole('button', { name: 'Enter in full dashboard' }).isDisabled())) throw new Error('sudo-attention-card: current-protocol request exposed an unsafe action');
if (!(await visibleSoon(page.getByText('Ready. Send a message to continue this session.')))) throw new Error('sudo-attention-card: restored transcript is not visible');
if ((await page.locator('.attention-card input').count()) !== 0) throw new Error('sudo-attention-card: sensitive input is rendered in the PWA');
await page.screenshot({ path: `${outDir}/06-sudo-attention-card.png` });
assertNoLayoutFunk('sudo-attention-card', await metrics('sudo-attention-card'));
await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByText('Weekend reading').click();
await page.locator('.message-row').first().waitFor({ state: 'visible', timeout: 5000 });
await page.screenshot({ path: `${outDir}/07-chat.png` });
assertNoLayoutFunk('chat', await metrics('chat'));
await page.getByPlaceholder('Message Hermes…').fill('Test mobile UX');
await page.screenshot({ path: `${outDir}/08-chat-focused.png` });
assertNoLayoutFunk('chat-focused', await metrics('chat-focused'));
await page.evaluate(() => {
  window.dispatchEvent(new Event('resize'));
  document.documentElement.style.setProperty('--composer-bottom-buffer', '8px');
});
await page.screenshot({ path: `${outDir}/09-keyboard-buffer.png` });
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
