declare const Buffer: { from(input: string | number[]): Uint8Array };

import { expect, Page, test } from '@playwright/test';

// iOS WebKit can revoke access to a picked file (or an iCloud/Files provider can stop serving it)
// shortly after selection (WebKit bug 228683). These tests model that: file reads are allowed while
// the change event is handled, then any later read throws, exactly like a revoked handle.

type ReadControl = { __lockFileReads: boolean; __slowReadsMs: number; __slowFailReadsMs: number };

async function installReadControl(page: Page) {
  await page.addInitScript(() => {
    const control = window as unknown as ReadControl;
    control.__lockFileReads = false;
    control.__slowReadsMs = 0;
    control.__slowFailReadsMs = 0;
    const revoked = () => new DOMException('The object can not be found here.', 'NotFoundError');
    const proto = FileReader.prototype as unknown as Record<string, (...args: unknown[]) => void>;
    for (const method of ['readAsDataURL', 'readAsArrayBuffer', 'readAsText', 'readAsBinaryString']) {
      const original = proto[method];
      proto[method] = function (this: FileReader, ...args: unknown[]) {
        if (control.__lockFileReads) throw revoked();
        if (control.__slowFailReadsMs > 0) { window.setTimeout(() => this.dispatchEvent(new ProgressEvent('error')), control.__slowFailReadsMs); return; }
        if (control.__slowReadsMs > 0) { window.setTimeout(() => original.apply(this, args), control.__slowReadsMs); return; }
        return original.apply(this, args);
      };
    }
    const blobProto = Blob.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const method of ['arrayBuffer', 'text']) {
      const original = blobProto[method];
      blobProto[method] = function (this: Blob, ...args: unknown[]) {
        if (control.__lockFileReads) return Promise.reject(revoked());
        return original.apply(this, args);
      };
    }
  });
}

const setReads = (page: Page, patch: Partial<ReadControl>) => page.evaluate((value) => Object.assign(window, value), patch);

async function openMockChat(page: Page) {
  await installReadControl(page);
  await page.goto('/?e2e=attachments');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await page.getByText('Weekend reading').click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.locator('.message-row').first()).toBeVisible();
  await expect.poll(async () => page.locator('.status-pill').getAttribute('data-phase')).not.toBe('connecting');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

test('a selected attachment is snapshotted at selection and sends after the OS file handle is revoked', async ({ page }) => {
  await openMockChat(page);
  await page.locator('input[type="file"]').setInputFiles({ name: 'IMG_0042.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.attachment-chip', { hasText: 'IMG_0042.png' })).toBeVisible();
  await setReads(page, { __lockFileReads: true }); // the phone has now lost the file
  await page.getByPlaceholder('Message Hermes…').fill('Look at this screenshot');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message-row.user', { hasText: '📎 IMG_0042.png' })).toBeVisible();
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  await expect(page.getByText(/upload failed|Could not attach/i)).toHaveCount(0);
});

test('a file that cannot be read at selection shows a sanitized error and never becomes a chip', async ({ page }) => {
  await openMockChat(page);
  await setReads(page, { __lockFileReads: true });
  await page.locator('input[type="file"]').setInputFiles({ name: 'IMG_0043.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.inline-banner')).toContainText('Could not attach IMG_0043.png');
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  await page.getByPlaceholder('Message Hermes…').fill('Anything');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
});

test('send stays disabled while an attachment is still being read', async ({ page }) => {
  await openMockChat(page);
  await setReads(page, { __slowReadsMs: 600 });
  await page.locator('input[type="file"]').setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer: PNG });
  await page.getByPlaceholder('Message Hermes…').fill('Waiting for the file');
  await expect(page.getByRole('status').filter({ hasText: 'Preparing slow.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await expect(page.locator('.attachment-chip', { hasText: 'slow.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
});

test('a read that finishes after leaving the chat is discarded, success or failure', async ({ page }) => {
  await openMockChat(page);
  await setReads(page, { __slowReadsMs: 600 });
  await page.locator('input[type="file"]').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await page.waitForTimeout(900);
  await setReads(page, { __slowReadsMs: 0 });
  await page.getByText('Weekend reading').click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.locator('.attachment-chip')).toHaveCount(0);
  await expect(page.locator('.attachment-status')).toHaveCount(0);

  // A read that fails after the user left must not surface an error about an abandoned file.
  await setReads(page, { __slowFailReadsMs: 600 });
  await page.locator('input[type="file"]').setInputFiles({ name: 'doomed.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText('Could not attach doomed.png')).toHaveCount(0);
  await setReads(page, { __slowFailReadsMs: 0 });
  await page.getByText('Weekend reading').click();
  await expect(page.getByText('Could not attach doomed.png')).toHaveCount(0);
});
