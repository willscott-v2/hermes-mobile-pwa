import { expect, test } from '@playwright/test';

// Regression for docs/PWA-ISSUES-2026-11-19.md "iPhone search/scroll overlap".
//
// On iOS the software keyboard shrinks window.visualViewport.height while the layout
// viewport keeps window.innerHeight, and the visual viewport can then pan inside the
// layout viewport (visualViewport.offsetTop > 0) — iOS does this to reveal the focused
// field and again whenever the user drags. The app shell must occupy exactly the visual
// viewport in that state; otherwise its bottom edge clips the Conversations search field
// and bare body background shows beneath it.
//
// Desktop Chromium has no software keyboard, so the test installs a controllable fake
// visualViewport before the app boots and drives it through keyboard-open, pan, and
// keyboard-closed states. This is a layout regression, not physical-iOS proof.

const LAYOUT_HEIGHT = 852; // iPhone 14 Pro CSS px
const KEYBOARD_HEIGHT = 336;

async function installFakeVisualViewport(page: import('@playwright/test').Page) {
  await page.addInitScript(({ layoutHeight }) => {
    const listeners: Record<string, Set<EventListener>> = { resize: new Set(), scroll: new Set() };
    const state = { height: layoutHeight, offsetTop: 0 };
    const fake = {
      get height() { return state.height; },
      get width() { return window.innerWidth; },
      get offsetTop() { return state.offsetTop; },
      get offsetLeft() { return 0; },
      get pageTop() { return state.offsetTop; },
      get pageLeft() { return 0; },
      get scale() { return 1; },
      addEventListener(type: string, listener: EventListener) { listeners[type]?.add(listener); },
      removeEventListener(type: string, listener: EventListener) { listeners[type]?.delete(listener); },
      dispatchEvent() { return true; },
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    (window as unknown as { __setVisualViewport: (next: { height: number; offsetTop: number }) => void }).__setVisualViewport = (next) => {
      const resized = next.height !== state.height;
      const panned = next.offsetTop !== state.offsetTop;
      state.height = next.height;
      state.offsetTop = next.offsetTop;
      const fire = (type: 'resize' | 'scroll') => listeners[type].forEach((listener) => listener(new Event(type)));
      if (resized) fire('resize');
      if (panned) fire('scroll');
    };
  }, { layoutHeight: LAYOUT_HEIGHT });
}

async function setVisualViewport(page: import('@playwright/test').Page, next: { height: number; offsetTop: number }) {
  await page.evaluate((value) => (window as unknown as { __setVisualViewport: (next: { height: number; offsetTop: number }) => void }).__setVisualViewport(value), next);
}

async function enableMock(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=search-keyboard-pan');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

async function shellMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.app-shell') as HTMLElement;
    const search = document.querySelector('.search-wrap input') as HTMLElement;
    const shellRect = shell.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    const viewport = window.visualViewport!;
    return {
      shellTop: Math.round(shellRect.top),
      shellBottom: Math.round(shellRect.bottom),
      shellHeight: Math.round(shellRect.height),
      searchTop: Math.round(searchRect.top),
      searchBottom: Math.round(searchRect.bottom),
      visualTop: Math.round(viewport.offsetTop),
      visualBottom: Math.round(viewport.offsetTop + viewport.height),
      // The app-shell's own background is what the user perceives as "the app"; if the
      // visual viewport bottom reaches past the shell, body background shows (flat black).
      uncoveredBelowShell: Math.max(0, Math.round(viewport.offsetTop + viewport.height - shellRect.bottom)),
      uncoveredAboveShell: Math.max(0, Math.round(shellRect.top - viewport.offsetTop)),
      // iOS lets the document scroll whenever it has scrollable overflow, even with
      // body { overflow: hidden }. A shell that grows the document while the keyboard is up
      // hands iOS a scroll range that pulls the shell (and the search field) off the visible
      // region again — so the document must stay exactly one layout viewport tall.
      documentScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  });
}

test.describe('Conversations search under an iOS-style keyboard pan', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: LAYOUT_HEIGHT });
    await installFakeVisualViewport(page);
    await enableMock(page);
  });

  test('shell spans the whole layout viewport so no keyboard pan can expose body background over the search field', async ({ page }) => {
    const search = page.getByPlaceholder(/Search/);
    await search.click();
    await search.fill('Bot chat');
    const listPaddingBottom = () => page.locator('.session-list').evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom));

    // Keyboard opens: visual viewport shrinks, no pan yet.
    await setVisualViewport(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 0 });
    let metrics = await shellMetrics(page);
    // The shell keeps the layout viewport's height: the keyboard-covered strip is still shell,
    // so nothing iOS does with the visual viewport can reach past its bottom edge.
    expect(metrics.shellTop).toBe(0);
    expect(metrics.shellHeight).toBe(LAYOUT_HEIGHT);
    expect(metrics.uncoveredBelowShell).toBe(0);
    expect(metrics.uncoveredAboveShell).toBe(0);
    expect(metrics.searchBottom).toBeLessThanOrEqual(metrics.visualBottom);
    expect(metrics.documentScrollHeight).toBe(metrics.innerHeight);
    // The strip under the keyboard is handed to the list as padding so its last rows can
    // still be scrolled above the keyboard.
    expect(await listPaddingBottom()).toBeGreaterThanOrEqual(KEYBOARD_HEIGHT);

    // iOS pans the visual viewport to reveal the focused field / the user drags. Whatever
    // the visible region is, it must be painted by the shell (never bare body background),
    // and the document must not grow (extra scroll range is what lets iOS drag it away).
    await setVisualViewport(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 200 });
    metrics = await shellMetrics(page);
    expect(metrics.shellTop).toBe(0);
    expect(metrics.shellHeight).toBe(LAYOUT_HEIGHT);
    expect(metrics.uncoveredBelowShell).toBe(0);
    expect(metrics.uncoveredAboveShell).toBe(0);
    expect(metrics.documentScrollHeight).toBe(metrics.innerHeight);
    // The field the user is typing into is inside the visible region for a reveal-sized pan.
    expect(metrics.searchTop).toBeGreaterThanOrEqual(metrics.visualTop);
    expect(metrics.searchBottom).toBeLessThanOrEqual(metrics.visualBottom);
    // Only the part of the keyboard still over the layout viewport needs padding now.
    expect(await listPaddingBottom()).toBeGreaterThanOrEqual(KEYBOARD_HEIGHT - 200);
    // Filtering still works while panned (no layout-only regressions in the list).
    await expect(page.getByPlaceholder(/Search/)).toHaveValue('Bot chat');

    // Maximum pan (the whole keyboard height): still no uncovered region, still no overflow.
    await setVisualViewport(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: KEYBOARD_HEIGHT });
    metrics = await shellMetrics(page);
    expect(metrics.uncoveredBelowShell).toBe(0);
    expect(metrics.uncoveredAboveShell).toBe(0);
    expect(metrics.documentScrollHeight).toBe(metrics.innerHeight);

    // Keyboard closes: everything returns to the top-anchored full-height shell.
    await setVisualViewport(page, { height: LAYOUT_HEIGHT, offsetTop: 0 });
    metrics = await shellMetrics(page);
    expect(metrics.shellTop).toBe(0);
    expect(metrics.shellHeight).toBe(LAYOUT_HEIGHT);
    expect(metrics.uncoveredBelowShell).toBe(0);
    expect(metrics.documentScrollHeight).toBe(metrics.innerHeight);
    expect(await listPaddingBottom()).toBeLessThan(KEYBOARD_HEIGHT);
  });

  test('the chat screen keeps its visual-viewport-sized shell (composer behaviour untouched)', async ({ page }) => {
    await page.locator('.session-row').first().click();
    await expect(page.locator('.chat-screen')).toBeVisible();
    await setVisualViewport(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 0 });
    const shellHeight = await page.locator('.app-shell').evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(shellHeight).toBe(LAYOUT_HEIGHT - KEYBOARD_HEIGHT);
  });

  test('the sheet backdrop still covers the whole window (no transform re-parenting of fixed overlays)', async ({ page }) => {
    await setVisualViewport(page, { height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 120 });
    await page.getByRole('button', { name: 'New chat' }).click();
    const dialog = page.getByRole('dialog', { name: 'New chat' });
    await expect(dialog).toBeVisible();
    const backdrop = await page.locator('.sheet-backdrop, [class*="backdrop"]').first().evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height), position: getComputedStyle(node).position };
    });
    expect(backdrop.position).toBe('fixed');
    expect(backdrop.left).toBe(0);
    expect(backdrop.top).toBe(0);
    expect(backdrop.width).toBe(390);
    expect(backdrop.height).toBe(LAYOUT_HEIGHT);
  });
});
