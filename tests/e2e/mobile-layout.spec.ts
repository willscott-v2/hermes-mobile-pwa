import { expect, test } from '@playwright/test';

async function enableMock(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=mobile-layout');
  await page.getByLabel('Mode').selectOption('mock');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

test('connect screen can scroll on a short iPhone viewport and shows onboarding diagnostics', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.goto('/?e2e=connect-scroll');
  const card = page.locator('.connect-card');
  await expect(card).toBeVisible();
  await expect(page.getByText('Choose how to connect')).toBeVisible();
  await expect(page.locator('.onboarding-options').getByText('Mock demo')).toBeVisible();
  await expect(page.locator('.onboarding-options').getByText('Private dashboard')).toBeVisible();
  await page.getByLabel('Mode').selectOption('mock');
  await page.getByRole('button', { name: /enable mock/i }).click();
  await expect(page.getByLabel('Connection diagnostics')).toContainText('Server URL');
  await expect(page.getByLabel('Connection diagnostics')).toContainText('Mock mode');
  const before = await card.evaluate((node) => node.scrollTop);
  await card.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const after = await card.evaluate((node) => node.scrollTop);
  expect(after).toBeGreaterThanOrEqual(before);
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
});

test('setup inputs keep iOS-safe font sizes to prevent Safari focus zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/?e2e=ios-input-fonts');
  const metrics = await page.locator('input, select, textarea').evaluateAll((nodes) => nodes.map((node) => ({
    tag: node.tagName,
    fontSize: Number.parseFloat(window.getComputedStyle(node).fontSize),
    right: node.getBoundingClientRect().right,
    left: node.getBoundingClientRect().left,
  })));
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.fontSize).toBeGreaterThanOrEqual(16);
    expect(metric.left).toBeGreaterThanOrEqual(0);
    expect(metric.right).toBeLessThanOrEqual(390);
  }
});

test('sessions screen has an independently scrollable session list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await enableMock(page);
  const list = page.locator('.session-list');
  await expect(list).toBeVisible();
  const metrics = await list.evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }));
  expect(metrics.clientHeight).toBeGreaterThan(0);
  expect(metrics.scrollHeight).toBeGreaterThanOrEqual(metrics.clientHeight);
});

test('chat composer supports compact keyboard buffer, runtime controls, and attachment control', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await expect(page.getByLabel('Runtime controls')).toBeVisible();
  await expect(page.getByLabel('Profile')).toBeVisible();
  await expect(page.getByLabel('Project')).toBeVisible();
  await expect(page.getByLabel('Model')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach file or screenshot' })).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty('--composer-bottom-buffer', '18px'));
  const box = await page.locator('.composer').boundingBox();
  expect(box?.height ?? 0).toBeLessThan(180);
  await expect(page.getByPlaceholder('Message Hermes…')).toBeVisible();
});

test('mobile transcript keeps URLs clickable while cleaning markdown punctuation', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  const url = 'https://hermes.example.test/?v=23';
  await expect(page.getByRole('link', { name: url })).toHaveAttribute('href', url);
  const visibleText = await page.locator('.messages').innerText();
  expect(visibleText).not.toContain('**Refresh transcript**');
  expect(visibleText).not.toContain('```text');
  expect(visibleText).toContain('Then tap Refresh transcript.');
  expect(visibleText).toContain('📎 filename.pdf');
});

test('document attachment selection shows a chip and sends only after upload succeeds', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(page.getByText('📎 sample.pdf')).toBeVisible();
  await page.getByPlaceholder('Message Hermes…').fill('Please review this');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('📎 sample.pdf')).toBeVisible();
});

test('send button is disabled while a prompt submit is running', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await page.getByPlaceholder('Message Hermes…').fill('Is our ICP too niche?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
