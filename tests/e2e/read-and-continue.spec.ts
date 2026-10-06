declare const Buffer: { from(input: string): Uint8Array };

import { expect, test } from '@playwright/test';

async function enableMock(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=mobile-layout');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

test('server check never reads as ready', async ({ page }) => {
  await page.goto('/?e2e=rc-probe');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Enable mock' }).click();
  const pill = page.locator('.status-pill');
  await expect(pill).toHaveText('Server reachable');
  await expect(pill).toHaveAttribute('data-phase', 'reachable-signed-out');
});

test('login inputs are at least 16px', async ({ page }) => {
  await page.goto('/?e2e=rc-font');
  const sizes = await page
     .locator('.connect-card input')
     .evaluateAll(
       (nodes) =>
        Array.from(nodes).map((n) =>
          parseFloat(window.getComputedStyle(n).fontSize),
        ),
      );
  expect(sizes.length).toBeGreaterThanOrEqual(3);
  for (const size of sizes) {
    expect(size).toBeGreaterThanOrEqual(16);
  }
});

test('back button is a 44px target', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  const back = page.getByRole('button', { name: 'Back to sessions' });
  const box = await back.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test('older messages load with a stable reading anchor', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Long research thread').click();
  const rows = page.locator('.message-row');
  await expect(rows).toHaveCount(120);
  await page.evaluate(() => {
    const el = document.querySelector('.messages');
    if (el) el.scrollTop = 0;
  });
  const record = await page.evaluate(() => {
    const first = document.querySelector('.message-row');
    if (!first) return null;
    const rect = first.getBoundingClientRect();
    return { text: first.textContent || '', top: rect.top };
  });
  expect(record).not.toBeNull();
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(rows).toHaveCount(240);
  const anchor = await page.evaluate((text) => {
    const row = Array.from(
      document.querySelectorAll('.message-row'),
    ).find((r) => (r.textContent || '').includes(text));
    if (!row) return null;
    return row.getBoundingClientRect().top;
  }, record!.text);
  expect(anchor).not.toBeNull();
  expect(Math.abs(anchor! - record!.top)).toBeLessThanOrEqual(2);

  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(rows).toHaveCount(300);
  await expect(page.locator('[data-history="complete"]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Load older messages' }),
  ).toHaveCount(0);
});

test('refresh keeps older loaded pages', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Long research thread').click();
  const rows = page.locator('.message-row');
  await expect(rows).toHaveCount(120);
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(rows).toHaveCount(240);
  await page.getByRole('button', { name: 'Refresh transcript' }).click();
  await page.waitForTimeout(300);
  await expect(rows).toHaveCount(240);
});

test('follow-up after a completed turn stays in the same conversation', async ({
  page,
}) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await expect(page.locator('.message-row').first()).toBeVisible();
  const send = page.getByRole('button', { name: 'Send message' });
  const composer = page.locator('textarea');

  await composer.fill('Follow-up one');
  await send.click();
  await expect(page.getByText(/Follow-up one/).first()).toBeVisible();
  await expect(page.locator('.status-pill')).toHaveText('Ready', {
    timeout: 10000,
  });

  await composer.fill('Follow-up two');
  await send.click();
  await expect(page.locator('.status-pill')).toHaveText('Ready', {
     timeout: 10000,
   });
  const assistantCount = await page.locator('.message-row.assistant').count();
  expect(assistantCount).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('heading', { name: 'Weekend reading' })).toBeVisible();
});

test('running session offers queue and steer, never a bare send', async ({
  page,
}) => {
  await enableMock(page);
  await page.getByText('Running build').click();
  await expect(page.locator('.status-pill')).toHaveText('Running');
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toHaveCount(0);

  const composer = page.locator('textarea');
  await composer.fill('please also run the tests');
  await page.getByRole('button', { name: 'Queue for after this turn' }).click();
  await expect(page.locator('.inline-banner')).toContainText('Queued.');
  await expect(
    page.locator('.message-row.user .message-meta').last(),
  ).toContainText('queued for after this turn');
  await expect(composer).toHaveValue('');
});

test('unsupported steer keeps the draft', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Running build').click();
  const composer = page.locator('textarea');
  await composer.fill('[[mock-unsupported]] tighten the loop');
  await page.getByRole('button', { name: 'Steer the current turn' }).click();
  await expect(page.locator('.inline-banner')).toContainText(
    'does not support steering',
  );
  await expect(composer).toHaveValue('[[mock-unsupported]] tighten the loop');
});

test('accepted steer is labelled as a steer', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Running build').click();
  const composer = page.locator('textarea');
  await composer.fill('skip the docs step');
  await page.getByRole('button', { name: 'Steer the current turn' }).click();
  await expect(page.locator('.inline-banner')).toContainText('Steer accepted');
  await expect(
    page.locator('.message-row.user .message-meta').last(),
  ).toContainText('steer');
});

test('pending attention blocks ordinary send and never reads ready', async ({
  page,
}) => {
  await enableMock(page);
  await page.getByText('Morning news digest').click();
  await expect(page.locator('.attention-card')).toBeVisible();
  await expect(page.locator('.status-pill')).toHaveText('Needs you');
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeDisabled();
  await expect(page.locator('.composer-hint')).toContainText(
    'Answer the pending request above first',
  );
});

test('back restores the session search', async ({ page }) => {
  await enableMock(page);
  await page.getByPlaceholder('Search loaded sessions').fill('Lisbon');
  await page.getByText('Lisbon trip').click();
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await expect(page.getByPlaceholder('Search loaded sessions')).toHaveValue(
    'Lisbon',
  );
  await expect(page.locator('.session-row')).toHaveCount(1);
});

test('forget this device clears only app keys', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'hermes-mobile-pwa.server-url',
      'http://127.0.0.1:1/hermes',
    );
    window.localStorage.setItem('other-app.key', 'keep');
  });
  await page.goto('/?e2e=rc-forget');
  await page.getByRole('button', { name: 'Forget this device' }).click();
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  const appKeys = keys.filter((k) => k.startsWith('hermes-mobile-pwa.'));
  for (const key of appKeys) {
    expect(key).toBe('hermes-mobile-pwa.schema-version');
  }
  const other = await page.evaluate(
    () => window.localStorage.getItem('other-app.key'),
  );
  expect(other).toBe('keep');
});
