// Candidate QA against the built bundle served on 127.0.0.1:4180 (dist-candidate), mock mode.
// Not part of the regular suite: run with
//   npx playwright test scripts/qa/candidate-search-qa.spec.ts --config scripts/qa/candidate.config.ts
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'docs/research/evidence-2026-11-20-candidate-qa';
const LAYOUT_HEIGHT = 852;
const KEYBOARD_HEIGHT = 336;

test.beforeAll(() => { mkdirSync(OUT, { recursive: true }); });

async function installFakeVisualViewport(page: import('@playwright/test').Page) {
  await page.addInitScript(({ layoutHeight }) => {
    const listeners: Record<string, Set<EventListener>> = { resize: new Set(), scroll: new Set() };
    const state = { height: layoutHeight, offsetTop: 0 };
    const fake = {
      get height() { return state.height; }, get width() { return window.innerWidth; },
      get offsetTop() { return state.offsetTop; }, get offsetLeft() { return 0; },
      get pageTop() { return state.offsetTop; }, get pageLeft() { return 0; }, get scale() { return 1; },
      addEventListener(type: string, listener: EventListener) { listeners[type]?.add(listener); },
      removeEventListener(type: string, listener: EventListener) { listeners[type]?.delete(listener); },
      dispatchEvent() { return true; },
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    (window as unknown as { __setVisualViewport: (next: { height: number; offsetTop: number }) => void }).__setVisualViewport = (next) => {
      const resized = next.height !== state.height; const panned = next.offsetTop !== state.offsetTop;
      state.height = next.height; state.offsetTop = next.offsetTop;
      const fire = (type: 'resize' | 'scroll') => listeners[type].forEach((listener) => listener(new Event(type)));
      if (resized) fire('resize'); if (panned) fire('scroll');
    };
  }, { layoutHeight: LAYOUT_HEIGHT });
}

const setVV = (page: import('@playwright/test').Page, next: { height: number; offsetTop: number }) =>
  page.evaluate((value) => (window as unknown as { __setVisualViewport: (n: typeof value) => void }).__setVisualViewport(value), next);

async function enableMock(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

async function metrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.app-shell')!.getBoundingClientRect();
    const search = document.querySelector('.search-wrap input')!.getBoundingClientRect();
    const vv = window.visualViewport!;
    return {
      shellTop: Math.round(shell.top), shellBottom: Math.round(shell.bottom),
      visualTop: Math.round(vv.offsetTop), visualBottom: Math.round(vv.offsetTop + vv.height),
      searchTop: Math.round(search.top), searchBottom: Math.round(search.bottom),
      uncoveredBelow: Math.max(0, Math.round(vv.offsetTop + vv.height - shell.bottom)),
      uncoveredAbove: Math.max(0, Math.round(shell.top - vv.offsetTop)),
      documentScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      listPaddingBottom: Math.round(parseFloat(getComputedStyle(document.querySelector('.session-list')!).paddingBottom)),
      bundle: (document.querySelector('script[src*="assets/index-"]') as HTMLScriptElement | null)?.src ?? null,
    };
  });
}

type Metrics = Awaited<ReturnType<typeof metrics>>;
function expectShellCoversPan(state: Metrics, layoutHeight: number) {
  // Layout-viewport shell: the shell is the whole layout viewport, so no pan can expose body.
  expect(state.shellTop).toBe(0);
  expect(state.shellBottom).toBe(layoutHeight);
  expect(state.uncoveredBelow).toBe(0);
  expect(state.uncoveredAbove).toBe(0);
  expect(state.documentScrollHeight).toBe(state.innerHeight);
}

test('candidate: keyboard closed / open / panned at 390px, search finds the hidden row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: LAYOUT_HEIGHT });
  await installFakeVisualViewport(page);
  await enableMock(page);
  const log: Record<string, unknown> = {};

  log.closed = await metrics(page);
  await page.screenshot({ path: `${OUT}/01-sessions-keyboard-closed.png` });

  const search = page.getByRole('textbox', { name: 'Search conversations' });
  await search.click();
  await search.fill('Bot chat');
  await setVV(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 0 });
  await expect(page.locator('.session-row[data-search-hit="true"]', { hasText: 'Bot Chat' })).toBeVisible();
  log.open = await metrics(page);
  const open = log.open as Metrics;
  expectShellCoversPan(open, LAYOUT_HEIGHT);
  expect(open.searchBottom).toBeLessThanOrEqual(open.visualBottom);
  expect(open.listPaddingBottom).toBeGreaterThanOrEqual(KEYBOARD_HEIGHT);
  // Clip to the visual viewport so the capture shows what the phone would show above the keyboard.
  await page.screenshot({ path: `${OUT}/02-search-keyboard-open.png`, clip: { x: 0, y: 0, width: 390, height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT } });

  await setVV(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 200 });
  log.panned = await metrics(page);
  await page.screenshot({ path: `${OUT}/03-search-keyboard-panned-200.png`, clip: { x: 0, y: 200, width: 390, height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT } });
  const panned = log.panned as Metrics;
  expectShellCoversPan(panned, LAYOUT_HEIGHT);
  expect(panned.searchTop).toBeGreaterThanOrEqual(panned.visualTop);
  expect(panned.searchBottom).toBeLessThanOrEqual(panned.visualBottom);
  expect(panned.listPaddingBottom).toBeGreaterThanOrEqual(KEYBOARD_HEIGHT - 200);

  await setVV(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: KEYBOARD_HEIGHT });
  log.pannedMax = await metrics(page);
  await page.screenshot({ path: `${OUT}/03b-search-keyboard-panned-max.png`, clip: { x: 0, y: KEYBOARD_HEIGHT, width: 390, height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT } });
  expectShellCoversPan(log.pannedMax as Metrics, LAYOUT_HEIGHT);

  await setVV(page, { height: LAYOUT_HEIGHT, offsetTop: 0 });
  log.closedAgain = await metrics(page);
  expectShellCoversPan(log.closedAgain as Metrics, LAYOUT_HEIGHT);
  expect((log.closedAgain as Metrics).listPaddingBottom).toBeLessThan(KEYBOARD_HEIGHT);

  await page.locator('.session-row[data-search-hit="true"]', { hasText: 'Bot Chat' }).click();
  await expect(page.getByRole('heading', { name: 'Bot Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Set as/ })).toBeVisible();
  await page.screenshot({ path: `${OUT}/04-hidden-bot-chat-opened.png` });

  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(log, null, 2));
});
