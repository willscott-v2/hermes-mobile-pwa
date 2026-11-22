import { expect, test } from '@playwright/test';

// Regression for docs/PWA-ISSUES-2026-11-19.md "Canonical Bot Chat absent from search".
// The recent list excludes hidden rows by design, so searching loaded rows can never find
// the hidden canonical chat. Conversations search must also consult the profile-scoped
// server search, surface the hit, and open it with the existing session flow; pinning stays
// an explicit user action in the chat toolbar. The mock mirrors this with a hidden row
// ('mock-hidden-bot-chat', title "Bot Chat") that only search/by-id can reach.

async function enableMock(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=search-hidden');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

async function switchProfile(page: import('@playwright/test').Page, profile: string) {
  await page.getByRole('button', { name: /Active profile/ }).click();
  await page.getByRole('option', { name: profile }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await enableMock(page);
});

test('the hidden canonical chat is not in the ordinary list but is found by search and opens', async ({ page }) => {
  // Not in the recent list (hidden rows are not widened into the listing).
  await expect(page.getByRole('button', { name: /^Bot Chat/ })).toHaveCount(0);
  await expect(page.getByText('Hidden canonical chat')).toHaveCount(0);

  const search = page.getByRole('textbox', { name: 'Search conversations' });
  await search.fill('Bot chat');
  const hit = page.locator('.session-row[data-search-hit="true"]', { hasText: 'Bot Chat' });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('found by search');
  // Loaded rows still filter instantly and stay distinguishable from server hits.
  await expect(page.locator('.session-row[data-search-hit="true"]')).toHaveCount(1);

  await hit.click();
  await expect(page.getByRole('heading', { name: 'Bot Chat' })).toBeVisible();
  // Pinning remains an explicit control; nothing is auto-pinned by opening a search hit.
  await expect(page.getByRole('button', { name: /Set as/ })).toBeVisible();
});

test('server search stays inside the active profile', async ({ page }) => {
  await switchProfile(page, 'sales-test');
  const search = page.getByRole('textbox', { name: 'Search conversations' });
  await search.fill('Bot chat');
  await expect(page.getByRole('status').filter({ hasText: /No conversations match/ })).toBeVisible();
  await expect(page.locator('.session-row', { hasText: 'Bot Chat' })).toHaveCount(0);
  await switchProfile(page, 'default');
  // A profile switch clears the filter (existing behaviour); searching again under default finds it.
  await expect(search).toHaveValue('');
  await search.fill('Bot chat');
  await expect(page.locator('.session-row[data-search-hit="true"]', { hasText: 'Bot Chat' })).toBeVisible();
});

test('clearing the search restores the plain loaded list without hidden rows', async ({ page }) => {
  const search = page.getByRole('textbox', { name: 'Search conversations' });
  await search.fill('Bot chat');
  await expect(page.locator('.session-row[data-search-hit="true"]', { hasText: 'Bot Chat' })).toBeVisible();
  await search.fill('');
  await expect(page.locator('.session-row[data-search-hit="true"]')).toHaveCount(0);
  await expect(page.getByText('Hidden canonical chat')).toHaveCount(0);
  await expect(page.getByText('Weekend reading')).toBeVisible();
});
