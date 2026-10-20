import { test, expect, type Page } from '@playwright/test';
async function connect(page: Page) {
  await page.goto('/popup.html');
  await page.getByLabel('Integration token').fill('ntn_fixture_token_for_testing_only');
  await page.getByRole('button', { name: 'Connect to Notion' }).click();
  await expect(page.getByLabel('Page title')).toBeVisible();
}
test(
  'mobile setup, article capture, destination search and ' + 'successful Notion save',
  async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await connect(page);
    await page.getByLabel('Page title').fill('My saved article');
    await page.getByRole('button', { name: 'Save to', exact: true }).click();
    await page.getByRole('button', { name: 'Article library Database' }).click();
    await page.getByRole('button', { name: 'Save to Notion' }).click();
    await expect(page.getByText('Saved to Notion')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open in Notion' })).toHaveAttribute(
      'href',
      /notion.so/,
    );
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('clipperData')!));
    expect(saved.data.jobs[0].title).toBe('My saved article');
    expect(Object.keys(saved.data.jobs[0]).sort()).toEqual(
      ['id', 'status', 'title', 'source', 'pageUrl'].sort(),
    );
    const state = await page.evaluate(() =>
      (window as any).browser.runtime.sendMessage({ type: 'STATE' }),
    );
    expect(JSON.stringify(state)).not.toContain('ntn_fixture');
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'artifacts/mobile-saved.png', fullPage: true });
  },
);
test(
  'recovers a successful append after a lost response without ' + 'creating another page',
  async ({ page }) => {
    await connect(page);
    await page.getByRole('button', { name: 'Save to', exact: true }).click();
    await page.getByRole('button', { name: 'Reading room Page' }).click();
    await page.evaluate(() => {
      (window as any).__failAppendOnce = true;
    });
    await page.getByRole('button', { name: 'Save to Notion' }).click();
    await expect(page.getByText('Paused · ready to resume', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByText('Saved to Notion')).toBeVisible();
    const requests = await page.evaluate(() => (window as any).__requests);
    expect(requests.filter((r: any) => r.path === 'pages')).toHaveLength(1);
    expect(requests.filter((r: any) => r.method === 'PATCH')).toHaveLength(1);
  },
);
test('reopens saved connections without a passphrase prompt', async ({ page }) => {
  await connect(page);
  await page.reload();
  await expect(page.getByLabel('Page title')).toBeVisible();
  await expect(page.getByLabel('Passphrase', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Workspace', { exact: true })).toContainText('Personal workspace');
});
test('keeps layout usable at 320px and shows link-only fallback', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await connect(page);
  await page.evaluate(() => {
    (window as any).__emptyCapture = true;
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Article', exact: false })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Link only', exact: false })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test(
  'runs the packaged article extractor in a real browser ' + 'without mutating the page',
  async ({ page }) => {
    await page.goto('/popup.html');
    await page.setContent(
      `<title>Browser article</title><article><h1>Browser article</h1>${(
        '<p>A long and thoughtful article about collecting ideas. ' +
        'This paragraph includes enough meaningful content for the ' +
        'article parser to retain it, and a link to <a ' +
        'href="https://example.com">the source</a>.</p>'
      ).repeat(10)}</article>`,
    );
    const before = await page.locator('article').innerText();
    await page.addScriptTag({ url: '/capture.js' });
    const capture = await page.evaluate(() => (window as any).__pocketCapture());
    expect(capture.blocks.length).toBeGreaterThan(5);
    expect(capture.title).toBe('Browser article');
    expect(await page.locator('article').innerText()).toBe(before);
  },
);

test('shows saved workspaces in settings and lets the user continue clipping', async ({ page }) => {
  await connect(page);
  await page.goto('/options.html');
  await expect(page.getByRole('heading', { name: 'Your workspaces' })).toBeVisible();
  await expect(page.getByLabel('Integration token')).toBeHidden();
  await page.screenshot({ path: 'artifacts/saved-workspaces.png', fullPage: true });
  await page.getByRole('button', { name: 'Use Personal workspace', exact: true }).click();
  await expect(page.getByLabel('Page title')).toBeVisible();
  await expect(page.getByLabel('Workspace', { exact: true })).toContainText('Personal workspace');
});

test('remembers the chosen workspace across reopening', async ({ page }) => {
  await connect(page);
  await page.goto('/options.html');
  await page.getByRole('button', { name: 'Add another workspace' }).click();
  await page.getByLabel('Workspace label', { exact: false }).fill('Work');
  await page.getByLabel('Integration token').fill('ntn_fixture_work_token_for_testing');
  await page.getByRole('button', { name: 'Connect to Notion' }).click();
  await page.getByRole('button', { name: 'Use Work', exact: true }).click();
  await expect(page.getByLabel('Page title')).toBeVisible();
  await page.reload();
  await expect(page.locator('#workspace option:checked')).toHaveText('Work');
  await page.getByRole('button', { name: 'Use Work', exact: true }).click();
  await expect(page.getByLabel('Workspace', { exact: true })).toContainText('Work');
});

test(
  'filters destinations while typing and clears stale sample ' + 'results for no matches',
  async ({ page }) => {
    await connect(page);
    await page.getByRole('button', { name: 'Save to', exact: true }).click();
    await page.getByLabel('Search pages and databases').fill('Article');
    await expect(page.getByRole('button', { name: 'Article library Database' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reading room Page' })).toHaveCount(0);
    await page.getByLabel('Search pages and databases').fill('Notes');
    await expect(page.getByText('No more matches.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Article library Database' })).toHaveCount(0);
  },
);

test('retains only the last five completed saves after reopening', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Save to', exact: true }).click();
  await page.getByRole('button', { name: 'Reading room Page' }).click();
  for (let i = 1; i <= 6; i++) {
    await page.getByLabel('Page title').fill(`Saved article ${i}`);
    await page.getByRole('button', { name: 'Save to Notion', exact: true }).click();
    await expect(page.locator('#jobs .job-title').first()).toHaveText(`Saved article ${i}`);
    await expect(page.locator('#jobs .job-meta').first()).toHaveText('Saved to Notion');
    await expect(page.getByRole('button', { name: 'Save to Notion', exact: true })).toBeEnabled();
    await expect(page.locator('#job-count')).toHaveText(`${Math.min(i, 5)} saved`);
  }
  await page.reload();
  await expect(page.locator('#jobs .job-title')).toHaveText([
    'Saved article 6',
    'Saved article 5',
    'Saved article 4',
    'Saved article 3',
    'Saved article 2',
  ]);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('clipperData')!));
  expect(stored.data.jobs).toHaveLength(5);
  for (const clip of stored.data.jobs) {
    expect(Object.keys(clip).sort()).toEqual(['id', 'status', 'title', 'source', 'pageUrl'].sort());
  }
});
