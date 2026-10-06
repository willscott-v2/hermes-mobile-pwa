declare const Buffer: { from(input: string): Uint8Array };

import { expect, test } from '@playwright/test';

async function enableMock(page: import('@playwright/test').Page) {
  await page.goto('/?e2e=mobile-layout');
  await page.getByRole('button', { name: /Mode/ }).click();
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}

test('connect mode picker uses an in-page menu instead of a native mobile select', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/?e2e=mode-picker');
  await expect(page.locator('select')).toHaveCount(0);
  await page.getByRole('button', { name: /Mode/ }).click();
  await expect(page.getByRole('listbox', { name: 'Mode' })).toBeVisible();
  const pickerMetrics = await page.locator('.select-options').evaluate((node) => {
    const styles = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return { position: styles.position, zIndex: Number(styles.zIndex), right: rect.right, viewportWidth: window.innerWidth };
  });
  expect(pickerMetrics.position).toBe('absolute');
  expect(pickerMetrics.zIndex).toBeGreaterThanOrEqual(20);
  expect(pickerMetrics.right).toBeLessThanOrEqual(pickerMetrics.viewportWidth);
  await page.getByRole('option', { name: 'Mock demo' }).click();
  await expect(page.getByRole('button', { name: /Mode Mock demo/ })).toBeVisible();
});

test('connect mode picker supports keyboard selection without relying on native select UI', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/?e2e=mode-picker-keyboard');
  const modeButton = page.getByRole('button', { name: /Mode/ });
  await modeButton.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: 'Mode' })).toBeVisible();
  await expect(modeButton).toHaveAttribute('aria-activedescendant', /mode-select-options-option-0/);
  await page.keyboard.press('ArrowDown');
  await expect(modeButton).toHaveAttribute('aria-activedescendant', /mode-select-options-option-1/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mode Mock demo/ })).toBeVisible();
});

test('connect mode picker closes from keyboard without relying on native select UI', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto('/?e2e=mode-picker-keyboard-close');
  await page.getByRole('button', { name: /Mode/ }).click();
  await expect(page.getByRole('listbox', { name: 'Mode' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Mode' })).toHaveCount(0);
});

test('connect screen keeps actions and status visible on a browser-chrome iPhone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/?e2e=connect-actions');
  const connectButton = page.getByRole('button', { name: 'Connect' });
  await expect(connectButton).toBeVisible();
  const metrics = await page.locator('.button-row, .info-banner, .security-note').evaluateAll((nodes) => {
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { bottom: rect.bottom, viewportHeight: window.innerHeight };
    });
  });
  expect(metrics.length).toBe(3);
  for (const metric of metrics) {
    expect(metric.bottom).toBeLessThanOrEqual(metric.viewportHeight);
  }

  const density = await page.locator('.connect-card').evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(density.scrollHeight - density.clientHeight).toBeLessThanOrEqual(10);

  const touchTargets = await page.locator('.connect-card input, .select-trigger, .connect-card button').evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
  );
  for (const height of touchTargets) {
    expect(height).toBeGreaterThanOrEqual(48);
  }
});

test('connect screen keeps expired-login guidance visible on a browser-chrome iPhone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.addInitScript(() => {
    window.localStorage.setItem('hermes-mobile-pwa.server-url', `${window.location.origin}/hermes`);
    window.localStorage.setItem('hermes-mobile-pwa.token', 'expired-demo-token');
  });
  await page.goto('/?e2e=connect-expired-login');
  const banner = page.getByText('Saved login expired. Sign in again to continue.');
  await expect(banner).toBeVisible();
  const metrics = await page.locator('.info-banner').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { bottom: rect.bottom, viewportHeight: window.innerHeight };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
});


test('connect screen does not call a missing cookie session an expired saved login', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.addInitScript(() => {
    window.localStorage.setItem('hermes-mobile-pwa.server-url', `${window.location.origin}/hermes`);
    window.localStorage.removeItem('hermes-mobile-pwa.token');
  });
  await page.goto('/?e2e=connect-no-token-restore');
  await expect(page.getByText('Saved login expired.')).toHaveCount(0);
  await expect(page.getByText('Couldn’t restore dashboard session. Sign in to continue.')).toBeVisible();
});

test('connect screen can scroll on a short iPhone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.goto('/?e2e=connect-scroll');
  const card = page.locator('.connect-card');
  await expect(card).toBeVisible();
  const before = await card.evaluate((node) => node.scrollTop);
  await card.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const after = await card.evaluate((node) => node.scrollTop);
  expect(after).toBeGreaterThanOrEqual(before);
  await expect(page.getByRole('button', { name: 'Connect' })).toBeVisible();
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

test('new chat sheet owns profile model and reasoning pickers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await expect(page.getByRole('region', { name: 'New chat runtime controls' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Profile default/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByRole('dialog', { name: 'New chat' })).toBeVisible();
  const backdropStyle = await page.locator('.sheet-backdrop').evaluate((node) => {
    const styles = window.getComputedStyle(node);
    return { backgroundColor: styles.backgroundColor, backdropFilter: styles.backdropFilter };
  });
  expect(backdropStyle.backgroundColor).toBe('rgba(0, 0, 0, 0.68)');
  expect(backdropStyle.backdropFilter).toContain('blur');
  await expect(page.getByRole('button', { name: /Profile default/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Model Mock Fast/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reasoning Inherit/ })).toBeVisible();

  await page.getByRole('button', { name: /Profile default/ }).click();
  await page.getByRole('option', { name: 'sales-test' }).click();
  await expect(page.getByRole('button', { name: /Profile sales-test/ })).toBeVisible();

  await page.getByRole('button', { name: /Model Mock Fast/ }).click();
  await page.getByRole('option', { name: 'Mock Deep' }).click();
  await expect(page.getByRole('button', { name: /Model Mock Deep/ })).toBeVisible();

  await page.getByRole('button', { name: /Reasoning Inherit/ }).click();
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await expect(page.getByRole('button', { name: /Reasoning High/ })).toBeVisible();

  await page.getByRole('button', { name: 'Start chat' }).click();
  await expect(page.getByRole('dialog', { name: 'New chat' })).toHaveCount(0);
  await expect(page.getByText('Profile: sales-test · Model: mock/mock-deep · Reasoning: high')).toBeVisible();
});

test('restored batch clarify renders as a compact mobile attention card without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Lisbon trip').click();
  const card = page.locator('.attention-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Hermes needs an answer' })).toBeVisible();
  await expect(card.getByText('Which neighborhood? (answered: Alfama) · Need breakfast included? (Yes / productionuscentral1releasecandidatewithnobreakopportunities)')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Yes', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'productionuscentral1releasecandidatewithnobreakopportunities', exact: true })).toBeVisible();
  const metrics = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      right: rect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflow).toBe(0);
});

test('multi-select clarify uses an honest mobile fallback instead of sending one choice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Campaign regions').click();
  const card = page.locator('.attention-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('US', { exact: true })).toBeVisible();
  await expect(card.getByText('EU', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Choose multiple answers in full dashboard' })).toBeDisabled();
  const metrics = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { bottom: rect.bottom, right: rect.right, viewportHeight: window.innerHeight, viewportWidth: window.innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflow).toBe(0);
});

test('restored clarify choices keep long unbroken values inside the mobile card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Lisbon trip').click();
  const card = page.locator('.attention-card');
  await expect(card.getByRole('button', { name: 'productionuscentral1releasecandidatewithnobreakopportunities', exact: true })).toBeVisible();
  const metrics = await card.evaluate((node) => ({
    cardBottom: node.getBoundingClientRect().bottom,
    cardClientWidth: node.clientWidth,
    cardScrollWidth: node.scrollWidth,
    composerTop: document.querySelector('.composer')?.getBoundingClientRect().top ?? 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(metrics.cardScrollWidth).toBeLessThanOrEqual(metrics.cardClientWidth);
  expect(metrics.cardBottom).toBeLessThanOrEqual(metrics.composerTop - 4);
  expect(metrics.overflow).toBe(0);
});

test('restored clarify choice can be answered from the attention card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Lisbon trip').click();
  const card = page.locator('.attention-card');
  await card.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Answer sent.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('restored free-text clarify can be answered without leaving the mobile card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Deployment question').click();
  const card = page.locator('.attention-card.clarify');
  await expect(card).toBeVisible();
  await expect(card.getByText('Which deployment label should Hermes use?')).toBeVisible();
  await expect(page.getByText('Ready. Send a message to continue this session.')).toBeVisible();
  const answer = card.getByRole('textbox', { name: 'Answer Hermes' });
  await answer.fill('release-candidate');
  const metrics = await card.evaluate((node) => ({
    cardBottom: node.getBoundingClientRect().bottom,
    composerTop: document.querySelector('.composer')?.getBoundingClientRect().top ?? 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(metrics.cardBottom).toBeLessThanOrEqual(metrics.composerTop - 4);
  expect(metrics.overflow).toBe(0);
  await card.getByRole('button', { name: 'Send answer' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Answer sent.')).toBeVisible();
});

test('restored approval shows safe command context without hiding the transcript', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Morning news digest').click();
  const card = page.locator('.attention-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Approval needed' })).toBeVisible();
  await expect(card.getByText('Publish the prepared digest? · Command: hermes send --platform slack --channel morning-brief')).toBeVisible();
  await expect(card.locator('.attention-choices')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Deny' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Approve once' })).toBeVisible();
  await expect(page.getByText('Ready. Send a message to continue this session.')).toBeVisible();
  const metrics = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      right: rect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflow).toBe(0);
});

test('approval card only offers choices allowed by the gateway', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Deny-only approval').click();
  const card = page.locator('.attention-card.approval');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Deny' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Approve once' })).toHaveCount(0);
  const metrics = await card.evaluate((node) => ({
    right: node.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflow).toBe(0);
});

test('restored approval can be approved once from the attention card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Morning news digest').click();
  const card = page.locator('.attention-card');
  await card.getByRole('button', { name: 'Approve once' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Approved once.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('current-protocol approval can be answered from the mobile card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Current gateway approval').click();
  const card = page.locator('.attention-card.approval');
  await expect(card.getByText('Run the current gateway command? · Command: npm run check:daily')).toBeVisible();
  await card.getByRole('button', { name: 'Approve once' }).click();
  await expect(card).toHaveCount(0);
  // Current-protocol responses have no acknowledgement; only the gateway's cancel frame resolves them.
  await expect(page.locator('[data-attention="resolved"]')).toHaveText('Resolved.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('restored approval without a request id stays visible as a disabled fallback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Interrupted approval').click();
  const card = page.locator('.attention-card.approval');
  await expect(card).toBeVisible();
  await expect(card.getByText('A command is still waiting.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Response actions unavailable here' })).toBeDisabled();
  await expect(page.getByText('Ready. Send a message to continue this session.')).toBeVisible();
  const metrics = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      right: rect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflow).toBe(0);
});

test('secret request event uses a compact secure fallback without exposing the environment key', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Deployment credentials').click();
  const card = page.locator('.attention-card.secret');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Secret needed' })).toBeVisible();
  await expect(card.getByText('Enter the deploy token.')).toBeVisible();
  await expect(card.getByText('Sensitive values stay out of this PWA.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Enter in full dashboard' })).toBeDisabled();
  await expect(card).not.toContainText('DEPLOY_TOKEN');
  const metrics = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      right: rect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflow).toBe(0);
});

test('sudo request event uses a compact secure fallback without exposing password entry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('System update', { exact: true }).click();
  const card = page.locator('.attention-card.sudo');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Sudo password needed' })).toBeVisible();
  await expect(card.getByText('Sensitive values stay out of this PWA.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Enter in full dashboard' })).toBeDisabled();
  await expect(card.locator('input')).toHaveCount(0);
  const metrics = await card.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      right: rect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.overflow).toBe(0);
});

test('chat composer and transcript controls keep touch-friendly targets', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await expect(page.getByRole('button', { name: 'Attach file or screenshot' })).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty('--composer-bottom-buffer', '18px'));
  const box = await page.locator('.composer').boundingBox();
  expect(box?.height ?? 0).toBeLessThan(110);
  await expect(page.getByPlaceholder('Message Hermes…')).toBeVisible();
  await expect(page.getByPlaceholder('Message Hermes…')).toHaveCSS('resize', 'none');
  const placeholderStyle = await page.getByPlaceholder('Message Hermes…').evaluate((node) => {
    const styles = window.getComputedStyle(node, '::placeholder');
    return { color: styles.color, opacity: styles.opacity };
  });
  expect(placeholderStyle.color).toBe('rgb(169, 170, 163)');
  expect(placeholderStyle.opacity).toBe('1');
  const refreshBox = await page.getByRole('button', { name: 'Refresh transcript' }).boundingBox();
  expect(refreshBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test('chat header truncates long session titles without crowding the status pill', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await page.locator('h1').evaluate((node) => {
    node.textContent = 'Quarterly mobile transcript reliability investigation with extremely long title';
  });
  const metrics = await page.evaluate(() => {
    const title = document.querySelector('h1')!;
    const titleRect = title.getBoundingClientRect();
    const pillRect = document.querySelector('.status-pill')!.getBoundingClientRect();
    const styles = window.getComputedStyle(title);
    return {
      titleHeight: titleRect.height,
      titleRight: titleRect.right,
      pillLeft: pillRect.left,
      pillRight: pillRect.right,
      viewportWidth: window.innerWidth,
      whiteSpace: styles.whiteSpace,
      textOverflow: styles.textOverflow,
    };
  });
  expect(metrics.whiteSpace).toBe('nowrap');
  expect(metrics.textOverflow).toBe('ellipsis');
  expect(metrics.titleHeight).toBeLessThanOrEqual(24);
  expect(metrics.titleRight).toBeLessThanOrEqual(metrics.pillLeft - 8);
  expect(metrics.pillRight).toBeLessThanOrEqual(metrics.viewportWidth);
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

test('document attachment selection shows a compact chip and sends only after upload succeeds', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  const longName = 'very-long-screenshot-name-from-ios-share-sheet-with-dashboard-context-redacted-and-extra-notes.pdf';
  await page.locator('input[type="file"]').setInputFiles({ name: longName, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(page.getByText(`📎 ${longName}`)).toBeVisible();
  const chipMetrics = await page.locator('.attachment-chip').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const label = node.querySelector('.attachment-name');
    const labelRect = label?.getBoundingClientRect();
    const labelStyles = label ? window.getComputedStyle(label) : null;
    return {
      chipRight: rect.right,
      chipHeight: rect.height,
      labelRight: labelRect?.right ?? 0,
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      textOverflow: labelStyles?.textOverflow,
      whiteSpace: labelStyles?.whiteSpace,
    };
  });
  expect(chipMetrics.overflow).toBe(0);
  expect(chipMetrics.chipRight).toBeLessThanOrEqual(chipMetrics.viewportWidth);
  expect(chipMetrics.chipHeight).toBeLessThanOrEqual(48);
  expect(chipMetrics.textOverflow).toBe('ellipsis');
  expect(chipMetrics.whiteSpace).toBe('nowrap');
  const removeBox = await page.getByRole('button', { name: `Remove ${longName}` }).boundingBox();
  expect(removeBox?.width ?? 0).toBeGreaterThanOrEqual(32);
  expect(removeBox?.height ?? 0).toBeGreaterThanOrEqual(32);
  await page.getByPlaceholder('Message Hermes…').fill('Please review this');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(`📎 ${longName}`)).toBeVisible();
});


test('chat composer grows for multiline prompts without covering the transcript', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await expect(page.locator('.message-row').first()).toBeVisible();
  const textarea = page.getByPlaceholder('Message Hermes…');
  const initialBox = await textarea.boundingBox();
  await textarea.fill('First line\nSecond line with more context\nThird line before sending');
  const grownBox = await textarea.boundingBox();
  expect(grownBox?.height ?? 0).toBeGreaterThan((initialBox?.height ?? 0) + 20);
  expect(grownBox?.height ?? 0).toBeLessThanOrEqual(144);
  const metrics = await page.evaluate(() => {
    const composer = document.querySelector('.composer')!.getBoundingClientRect();
    const lastMessage = Array.from(document.querySelectorAll('.message-row')).at(-1)!.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      composerBottom: composer.bottom,
      viewportHeight: window.innerHeight,
      gap: composer.top - lastMessage.bottom,
    };
  });
  expect(metrics.overflow).toBe(0);
  expect(metrics.composerBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.gap).toBeGreaterThanOrEqual(4);
});

test('send button is disabled while a prompt submit is running', async ({ page }) => {
  await enableMock(page);
  await page.getByText('Weekend reading').click();
  await page.getByPlaceholder('Message Hermes…').fill('Is our ICP too niche?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
