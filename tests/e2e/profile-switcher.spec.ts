import { expect, test } from '@playwright/test';

// The Conversations profile switcher: a host-/profile-scoped selector that drives
// authoritative server-side paging, keeps one profile's sessions out of another's
// view, and seeds New Chat to the active profile. Mock demo advertises
// ['default','sales-test'] but no personal data.

async function enableMock(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=mobile-layout');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

async function switchProfile(page: import('@playwright/test').Page, profile: string) {
  await page.getByRole('button', { name: /Active profile/ }).click();
  await page.getByRole('option', { name: profile }).click();
}

test('profile selector shows only the active profile\'s sessions', async ({ page }) => {
  await enableMock(page);
  // A host-/profile-scoped selector is present at the top of Sessions.
  await expect(page.getByRole('button', { name: /Active profile/ })).toBeVisible();
  // On the default profile the private default task shows, but the sales-test
  // row of the same list stays out.
  await expect(page.getByText('Private default task')).toBeVisible();
  await expect(page.getByText(/Launch campaign/)).toHaveCount(0);
});

test('switching profile swaps the loaded rows and never overflows on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await enableMock(page);
  await switchProfile(page, 'sales-test');
  // sales-test rows appear; the default-only private task does not leak in.
  await expect(page.getByText(/Launch campaign/)).toBeVisible();
  await expect(page.getByText('Private default task')).toHaveCount(0);
  // switching back restores the default view.
  await switchProfile(page, 'default');
  await expect(page.getByText('Private default task')).toBeVisible();
  await expect(page.getByText(/Launch campaign/)).toHaveCount(0);
  // No horizontal overflow after a switch on a 390px viewport.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('new chat is seeded to the active profile', async ({ page }) => {
  await enableMock(page);
  await switchProfile(page, 'sales-test');
  await page.getByRole('button', { name: 'New chat' }).click();
  const dialog = page.getByRole('dialog', { name: 'New chat' });
  await expect(dialog).toBeVisible();
  // The per-chat runtime profile starts from the active profile, not a stale one.
  const profilePicker = dialog.getByRole('button', { name: /Profile sales-test/ });
  await expect(profilePicker).toBeVisible();
  await profilePicker.click();
  await expect(dialog.getByRole('option', { name: 'sales-test' })).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'default' })).toHaveCount(0);
});
