import { expect, Page, test } from '@playwright/test';

// Voice mode and the Talk to Hermes shortcut, end to end in mock mode. The deterministic
// FakeVoiceBackend stands in for the microphone, STT/TTS sockets and provider (no real audio, no
// credentials); `window.__fakeVoice` exposes its script and a serializable call log.

const MOCK_ORIGIN_KEY = 'https://mock.hermes.invalid';
const TRANSCRIPT = 'Hello there, what is on my plate today?';

async function enableMock(page: Page) {
  await page.goto('/?e2e=voice');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

async function switchProfile(page: Page, profile: string) {
  await page.getByRole('button', { name: /Active profile/ }).click();
  await page.getByRole('option', { name: profile }).click();
}

async function openChat(page: Page, title: string) {
  await page.locator('.session-row', { hasText: title }).first().click();
  await expect(page.locator('.chat-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.locator('.message-row').first()).toBeVisible(); // history has loaded
  await expect.poll(async () => page.locator('.status-pill').getAttribute('data-phase')).not.toBe('connecting');
}

const fake = (page: Page) => page.evaluate(() => (window as unknown as { __fakeVoice: { snapshot(): any } }).__fakeVoice.snapshot());
const script = (page: Page, patch: Record<string, unknown>) => page.evaluate((value) => Object.assign((window as any).__fakeVoice.auto, value), patch);
const panel = (page: Page) => page.getByRole('region', { name: 'Voice controls' });

async function openVoice(page: Page) {
  await page.getByRole('button', { name: 'Open voice' }).click();
  await expect(panel(page)).toBeVisible();
}

test.describe('generic voice in an ordinary chat', () => {
  test('dictation submits through the normal chat path and the reply is spoken incrementally', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await script(page, { transcript: TRANSCRIPT });
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await expect(panel(page)).toContainText('Hello there,'); // ephemeral partial caption
    await page.getByRole('button', { name: 'Stop and send' }).click();

    // The transcript lands in ordinary text history exactly once, then the assistant answers.
    await expect(page.locator('.message-row.user', { hasText: TRANSCRIPT })).toHaveCount(1);
    await expect(page.locator('.message-row.assistant', { hasText: 'Mock mode is wired' })).toBeVisible();
    await expect(panel(page).getByRole('status')).toContainText('Ready', { timeout: 5000 });

    const snapshot = await fake(page);
    expect(snapshot.dictations).toHaveLength(1);
    // Voice is scoped to the live gateway session id (message frames are tagged with it), not the history key.
    // The final transcript settled the dictation: the backend released the mic and socket itself.
    expect(snapshot.dictations[0]).toMatchObject({ profile: 'default', sessionId: 'live-mock-weekend-reading', finished: true, settled: true });
    expect(snapshot.speeches).toHaveLength(1);
    expect(snapshot.speeches[0]).toMatchObject({ profile: 'default', sessionId: 'live-mock-weekend-reading', done: true, stopped: false });
    // Deltas were fed incrementally, in order, and together equal the rendered assistant text.
    expect(snapshot.speeches[0].spoken.length).toBeGreaterThan(1);
    const rendered = await page.locator('.message-row.assistant', { hasText: 'Mock mode is wired' }).innerText();
    expect(rendered.replace(/\s+/g, ' ')).toContain(snapshot.speeches[0].spoken.join('').replace(/\s+/g, ' ').trim().slice(0, 40));
    expect(snapshot.speeches[0].closed).toBe(true);
  });

  test('every voice socket is opened for the chat profile, including a non-default one', async ({ page }) => {
    await enableMock(page);
    await switchProfile(page, 'sales-test');
    await openChat(page, 'Launch campaign');
    await openVoice(page);
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await expect(page.locator('.message-row.user', { hasText: TRANSCRIPT })).toBeVisible();
    await expect.poll(async () => (await fake(page)).speeches.length).toBe(1);
    const snapshot = await fake(page);
    expect(snapshot.dictations[0]).toMatchObject({ profile: 'sales-test', sessionId: 'live-sales-campaign' });
    expect(snapshot.speeches[0]).toMatchObject({ profile: 'sales-test', sessionId: 'live-sales-campaign' });
  });

  test('a blank final transcript sends nothing', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await script(page, { transcript: '   ' });
    const before = await page.locator('.message-row.user').count();
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await expect(panel(page)).toContainText('Nothing was sent');
    await expect(page.locator('.message-row.user')).toHaveCount(before);
    expect((await fake(page)).speeches).toHaveLength(0);
  });

  test('TTS failure degrades to readable text without failing the prompt', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await script(page, { failSpeech: true });
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await expect(page.locator('.message-row.assistant', { hasText: 'Mock mode is wired' })).toBeVisible();
    await expect(panel(page)).toContainText('Reading the reply as text');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Not sent')).toHaveCount(0);
    expect((await fake(page)).speeches).toHaveLength(1); // never retried
  });

  test('Stop speaking silences playback and keeps the text', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Speaking');
    await page.getByRole('button', { name: 'Stop speaking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Stopped');
    await expect(page.locator('.message-row.assistant', { hasText: 'Mock mode is wired' })).toBeVisible();
    await expect(page.locator('.message-row.assistant', { hasText: 'Connect to your dashboard URL' })).toBeVisible({ timeout: 5000 });
    const snapshot = await fake(page);
    expect(snapshot.speeches[0].stopped).toBe(true);
    await expect(page.getByRole('button', { name: 'Start talking' })).toBeEnabled({ timeout: 5000 });
  });

  test('a denied microphone shows a specific error and text chat keeps working', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await script(page, { deny: 'permission-denied' });
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('alert')).toContainText('Microphone permission was denied');
    await page.getByPlaceholder('Message Hermes…').fill('typed instead');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.message-row.user', { hasText: 'typed instead' })).toBeVisible();
  });

  test('without a secure context voice explains HTTPS and text chat stays usable', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.evaluate(() => { (window as any).__fakeVoice.capabilityResult = { supported: false, code: 'insecure-context', message: 'Voice needs a secure connection (HTTPS). Open Hermes over https:// to use the microphone; text chat still works.' }; });
    await openVoice(page);
    await expect(panel(page).getByRole('alert')).toContainText('HTTPS');
    await expect(page.getByRole('button', { name: 'Start talking' })).toBeDisabled();
    await page.getByPlaceholder('Message Hermes…').fill('still typing');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.message-row.user', { hasText: 'still typing' })).toBeVisible();
  });
});

test.describe('voice cleanup', () => {
  async function listening(page: Page) {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
  }

  test('back navigation cancels the microphone and releases the backend', async ({ page }) => {
    await listening(page);
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    const snapshot = await fake(page);
    expect(snapshot.dictations[0].cancelled).toBe(true);
    expect(snapshot.disposals).toBeGreaterThan(0);
  });

  test('switching to another chat cancels dictation and starts the next chat idle', async ({ page }) => {
    await listening(page);
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await openChat(page, 'Lisbon trip');
    await expect(panel(page)).toHaveCount(0); // voice mode is per-chat and starts closed
    const snapshot = await fake(page);
    expect(snapshot.dictations[0].cancelled).toBe(true);
  });

  test('a hidden page releases the microphone', async ({ page }) => {
    await listening(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(panel(page).getByRole('status')).toContainText('Ready');
    expect((await fake(page)).dictations[0].cancelled).toBe(true);
  });
});

test.describe('voice and the chat gateway', () => {
  test('a gateway drop mid-turn returns voice to idle, releases audio, and never speaks the resumed turn', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Speaking');
    const before = await fake(page);
    await page.evaluate(() => (window as unknown as { __mockDropGateway: () => void }).__mockDropGateway());
    await expect(panel(page).getByRole('status')).toContainText('Ready');
    await expect(panel(page)).toContainText('Connection lost');
    const dropped = await fake(page);
    expect(dropped.disposals).toBeGreaterThan(before.disposals);
    expect(dropped.speeches[0].closed).toBe(true);
    // The mock keeps streaming the abandoned turn and then reconnects/resumes: none of it is spoken.
    await expect(page.locator('.status-pill')).toHaveText('Ready', { timeout: 10_000 });
    await expect(page.locator('.message-row.assistant', { hasText: 'Connect to your dashboard URL' })).toBeVisible({ timeout: 5000 });
    const settled = await fake(page);
    expect(settled.speeches).toHaveLength(1);
    expect(settled.speeches[0].spoken).toEqual(dropped.speeches[0].spoken);
    await expect(panel(page).getByRole('status')).toContainText('Ready');
    await expect(page.getByRole('button', { name: 'Start talking' })).toBeEnabled();
  });
});

test.describe('voice and a gateway drop before the submit is accepted', () => {
  async function dropWhileSubmitting(page: Page) {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await script(page, { transcript: TRANSCRIPT });
    await page.evaluate(() => (window as any).__mockHoldNextSubmit());
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__mockSubmits.length)).toBe(1);
    await page.evaluate(() => (window as any).__mockDropGateway());
    await expect(panel(page).getByRole('status')).toContainText('Ready');
  }

  test('the final transcript is restored to the composer once, never resubmitted or spoken', async ({ page }) => {
    await dropWhileSubmitting(page);
    await expect(page.getByPlaceholder('Message Hermes…')).toHaveValue(TRANSCRIPT);
    await expect(panel(page)).toContainText('Connection lost');
    // The reconnect/resume replays the chat; none of it is submitted again or spoken.
    await expect(page.locator('.status-pill')).toHaveText('Ready', { timeout: 10_000 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__mockSubmits)).toEqual([TRANSCRIPT]);
    expect((await fake(page)).speeches.every((speech: { spoken: string[] }) => speech.spoken.length === 0)).toBe(true);
    await expect(page.getByPlaceholder('Message Hermes…')).toHaveValue(TRANSCRIPT);
  });

  test('an existing draft in the composer is never overwritten', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await openVoice(page);
    await script(page, { transcript: TRANSCRIPT });
    await page.evaluate(() => (window as any).__mockHoldNextSubmit());
    await page.getByRole('button', { name: 'Start talking' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    await page.getByPlaceholder('Message Hermes…').fill('half-written note');
    await page.getByRole('button', { name: 'Stop and send' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__mockSubmits.length)).toBe(1);
    await page.evaluate(() => (window as any).__mockDropGateway());
    await expect(panel(page).getByRole('status')).toContainText('Ready');
    await expect(page.getByPlaceholder('Message Hermes…')).toHaveValue('half-written note');
  });
});

test.describe('voice layout', () => {
  test('the panel never covers approval cards or the composer and does not overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await enableMock(page);
    await openChat(page, 'Current gateway approval');
    await openVoice(page);
    const card = page.locator('.attention-card');
    await expect(card).toBeVisible();
    // Voice cannot start while an approval is waiting; the reason is shown.
    await expect(page.getByRole('button', { name: 'Start talking' })).toBeDisabled();
    await expect(panel(page)).toContainText('Answer the pending request');
    await expect.poll(async () => page.evaluate(() => { const c = document.querySelector('.attention-card')!.getBoundingClientRect(); const v = document.querySelector('.voice-panel')!.getBoundingClientRect(); return c.bottom <= v.top + 1; })).toBe(true);
    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      return { card: rect('.attention-card'), panel: rect('.voice-panel'), composer: rect('.composer'), overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(boxes.card.bottom).toBeLessThanOrEqual(boxes.panel.top + 1);
    expect(boxes.panel.bottom).toBeLessThanOrEqual(boxes.composer.top + 1);
    expect(boxes.composer.bottom).toBeLessThanOrEqual(664 + 1);
    expect(boxes.overflow).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Approve once' }).click(); // approval is still answerable
  });

  test('voice controls are at least 44px, labelled, and the status is a live region', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    const toggle = page.getByRole('button', { name: 'Open voice' });
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await openVoice(page);
    const start = page.getByRole('button', { name: 'Start talking' });
    const box = (await start.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await expect(panel(page).getByRole('status')).toHaveAttribute('aria-live', 'polite');
    await start.click();
    await expect(panel(page).getByRole('status')).toContainText('Listening');
    const stop = page.getByRole('button', { name: 'Stop and send' });
    expect((await stop.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByPlaceholder('Message Hermes…')).toBeVisible();
  });
});

test.describe('Talk to Hermes', () => {
  test('without a pin it offers a clear, safe setup path and never guesses a chat', async ({ page }) => {
    await enableMock(page);
    const shortcut = page.getByRole('button', { name: 'Set up Talk to Hermes' });
    await expect(shortcut).toBeVisible();
    expect((await shortcut.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shortcut.click();
    const dialog = page.getByRole('dialog', { name: 'Talk to Hermes' });
    await expect(dialog).toContainText('Set as Hermes main');
    await dialog.getByRole('button', { name: 'Choose a chat' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.locator('.chat-screen')).toHaveCount(0);
  });

  test('pin from an open default chat, then Talk to Hermes resumes that exact session with voice open', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    const pin = page.getByRole('button', { name: 'Set as Hermes main' });
    expect((await pin.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pin.click();
    await expect(page.getByRole('button', { name: 'Remove Hermes main pin' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    const countBefore = await page.locator('.session-summary').innerText();
    await expect(page.getByRole('button', { name: 'Talk to Hermes' })).toBeVisible();
    await page.getByRole('button', { name: 'Talk to Hermes' }).click();
    await expect(page.getByRole('heading', { name: 'Weekend reading' })).toBeVisible();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start talking' })).toBeEnabled();
    expect((await fake(page)).unlocks).toBeGreaterThan(0); // audio unlocked from the tap
    // Same ordinary conversation history, no new voice-only conversation.
    await expect(page.locator('.message-row.assistant', { hasText: 'Saved item' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    expect(await page.locator('.session-summary').innerText()).toBe(countBefore);
  });

  test('from another profile it switches to default before resolving and never leaks the other profile', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await switchProfile(page, 'sales-test');
    await expect(page.getByText(/Launch campaign/)).toBeVisible();
    await page.getByRole('button', { name: 'Talk to Hermes' }).click();
    await expect(page.getByRole('heading', { name: 'Weekend reading' })).toBeVisible();
    await expect(page.locator('.eyebrow').first()).toContainText('default');
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await expect(page.getByRole('button', { name: /Active profile default/ })).toBeVisible();
    await expect(page.getByText(/Launch campaign/)).toHaveCount(0);
    await expect(page.getByText('Private default task')).toBeVisible();
  });

  test('a Talk to Hermes resolve that finishes after the user opened another chat does nothing', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await page.evaluate(() => (window as any).__mockHoldNextSessionDetail());
    await page.getByRole('button', { name: 'Talk to Hermes' }).click();
    await expect(page.getByRole('button', { name: 'Opening Hermes…' })).toBeVisible();
    await openChat(page, 'Lisbon trip');
    await page.evaluate(() => (window as any).__mockReleaseSessionDetail());
    await expect(page.getByRole('button', { name: 'Open voice' })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByRole('heading', { name: 'Lisbon trip' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Weekend reading' })).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });

  test('navigation during the profile switch itself invalidates Talk to Hermes', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await switchProfile(page, 'sales-test');
    await expect(page.getByText(/Launch campaign/)).toBeVisible();
    // Hold the default profile's session list: the switch inside Talk to Hermes stays pending.
    await page.evaluate(() => (window as any).__mockHoldNextSessionPage());
    await page.getByRole('button', { name: 'Talk to Hermes' }).click();
    await expect(page.getByRole('button', { name: 'Opening Hermes…' })).toBeVisible();
    // The user starts a fresh chat while the switch is still loading.
    await page.getByRole('button', { name: 'New chat' }).click();
    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page.locator('.chat-screen')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();
    await page.evaluate(() => (window as any).__mockReleaseSessionPage());
    await expect(page.getByRole('button', { name: 'Talk to Hermes' })).toHaveCount(0); // still in the chat screen
    await page.waitForTimeout(500);
    await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Weekend reading' })).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Talk to Hermes' })).toHaveCount(0);
    expect((await fake(page)).speeches).toHaveLength(0);
  });

  test('a Talk to Hermes resolve that finishes after the user went back does nothing', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await page.evaluate(() => (window as any).__mockHoldNextSessionDetail());
    await page.getByRole('button', { name: 'Talk to Hermes' }).click();
    await expect(page.getByRole('button', { name: 'Opening Hermes…' })).toBeVisible();
    await openChat(page, 'Lisbon trip');
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await page.evaluate(() => (window as any).__mockReleaseSessionDetail());
    await expect(page.getByRole('button', { name: 'Talk to Hermes' })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.locator('.chat-screen')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Talk to Hermes' })).toHaveCount(0);
  });

  test('the pin control exists only in default-profile chats', async ({ page }) => {
    await enableMock(page);
    await switchProfile(page, 'sales-test');
    await openChat(page, 'Launch campaign');
    await expect(page.getByRole('button', { name: 'Set as Hermes main' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open voice' })).toBeVisible(); // voice itself is generic
  });

  test('a stale pin fails safely and can be cleared or reconfigured', async ({ page }) => {
    await page.addInitScript((origin) => {
      window.localStorage.setItem('hermes-mobile-pwa.main-chat.v1', JSON.stringify({ v: 2, entries: { [origin]: { sessionId: 'session-that-no-longer-exists', title: 'Old main', savedAt: new Date().toISOString() } } }));
    }, MOCK_ORIGIN_KEY);
    await enableMock(page);
    await page.getByRole('button', { name: 'Talk to Hermes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Talk to Hermes' });
    await expect(dialog).toContainText('no longer available');
    await expect(page.locator('.chat-screen')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Clear Hermes main' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Set up Talk to Hermes' })).toBeVisible();
  });

  test('Hermes main settings can clear a working pin', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await page.getByRole('button', { name: 'Hermes main settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Talk to Hermes' });
    await expect(dialog).toContainText('Weekend reading');
    await dialog.getByRole('button', { name: 'Clear Hermes main' }).click();
    await expect(page.getByRole('button', { name: 'Set up Talk to Hermes' })).toBeVisible();
  });

  test('the Conversations surface has no horizontal overflow with the shortcut at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await enableMock(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  });
});

test.describe('Pinned chat (second pin)', () => {
  const pinnedButton = (page: Page) => page.getByRole('button', { name: /^Open pinned chat/ });

  test('pins a second chat beside the main one; each opens its own chat, and the second opens in text mode', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await openChat(page, 'Morning news digest'); // a non-desktop (cron) source, like an automation inbox
    const pin = page.getByRole('button', { name: 'Pin to Conversations' });
    expect((await pin.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await pin.click();
    await expect(page.getByRole('button', { name: 'Unpin from Conversations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set as Hermes main' })).toBeVisible(); // still not the main pin
    await page.getByRole('button', { name: 'Back to sessions' }).click();

    await enableMock(page); // reload: both pins persist
    await expect(page.getByRole('button', { name: 'Talk to Hermes' })).toBeVisible();
    await expect(pinnedButton(page)).toHaveAccessibleName('Open pinned chat: Morning news digest');

    await pinnedButton(page).click();
    await expect(page.getByRole('heading', { name: 'Morning news digest' })).toBeVisible();
    await expect(panel(page)).toHaveCount(0); // text mode: voice not opened
    await expect(page.getByRole('button', { name: 'Open voice' })).toHaveAttribute('aria-pressed', 'false');
    await openVoice(page); // ...but voice is still available in this chat, like any other
    await page.getByRole('button', { name: 'Back to sessions' }).click();

    await page.getByRole('button', { name: 'Talk to Hermes' }).click();
    await expect(page.getByRole('heading', { name: 'Weekend reading' })).toBeVisible();
    await expect(panel(page)).toBeVisible(); // the main pin still opens with voice on
  });

  test('a session sits in one slot only: pinning the main chat as the second pin moves it', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Pin to Conversations' }).click();
    await expect(page.locator('.inline-banner')).toContainText('It is no longer Hermes main.');
    await expect(page.getByRole('button', { name: 'Set as Hermes main' })).toBeVisible();
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await expect(page.locator('.inline-banner')).toContainText('It is no longer the pinned chat.');
    await expect(page.getByRole('button', { name: 'Pin to Conversations' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await expect(pinnedButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Talk to Hermes' })).toBeVisible();
  });

  test('a stale second pin fails safely, keeps the main pin, and can be cleared', async ({ page }) => {
    await page.addInitScript((origin) => {
      const entry = (sessionId: string, title: string) => JSON.stringify({ v: 2, entries: { [origin]: { sessionId, title, savedAt: new Date().toISOString() } } });
      window.localStorage.setItem('hermes-mobile-pwa.main-chat.v1', entry('mock-weekend-reading', 'Weekend reading'));
      window.localStorage.setItem('hermes-mobile-pwa.pinned-chat.v1', entry('session-that-no-longer-exists', 'Old inbox'));
    }, MOCK_ORIGIN_KEY);
    await enableMock(page);
    await pinnedButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Pinned chat' });
    await expect(dialog).toContainText('no longer available');
    await expect(page.locator('.chat-screen')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Clear pinned chat' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(pinnedButton(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Talk to Hermes' })).toBeVisible(); // main pin untouched
  });

  test('from another profile the second pin switches to default first and opens in text mode', async ({ page }) => {
    await enableMock(page);
    await openChat(page, 'Morning news digest');
    await page.getByRole('button', { name: 'Pin to Conversations' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await switchProfile(page, 'sales-test');
    await openChat(page, 'Launch campaign');
    await expect(page.getByRole('button', { name: 'Pin to Conversations' })).toHaveCount(0); // default-profile chats only
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await pinnedButton(page).click();
    await expect(page.getByRole('heading', { name: 'Morning news digest' })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await expect(page.getByRole('button', { name: /Active profile/ })).toContainText('default');
  });

  test('Conversations with both pins fits 390px with no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await enableMock(page);
    await openChat(page, 'Weekend reading');
    await page.getByRole('button', { name: 'Set as Hermes main' }).click();
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    await openChat(page, 'Morning news digest');
    await page.getByRole('button', { name: 'Pin to Conversations' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/pins-chat-header-390.png' });
    await page.getByRole('button', { name: 'Back to sessions' }).click();
    expect((await pinnedButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/pins-conversations-390.png' });
  });
});
