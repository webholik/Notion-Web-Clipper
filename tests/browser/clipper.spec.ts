import { test, expect, type Page } from '@playwright/test';
import { seal } from '../../src/vault';
async function connect(page: Page) {
  await page.goto('/popup.html');
  await page.getByLabel('Integration token').fill('ntn_fixture_token_for_testing_only');
  await page.getByRole('button', { name: 'Connect to Notion' }).click();
  await expect(page.getByRole('heading', { name: 'Save for later.' })).toBeVisible();
}
test('mobile setup, article capture, destination search and successful Notion save', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await connect(page);
  await page.getByLabel('Page title').fill('My saved article');
  await page.getByRole('button', { name: 'Save to', exact: true }).click();
  await page.getByRole('button', { name: 'Article library Database' }).click();
  await page.getByRole('button', { name: 'Save to Notion' }).click();
  await expect(page.getByText('Saved to Notion · Article library')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Notion' })).toHaveAttribute('href', /notion.so/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('clipperData')!));
  expect(saved.data.jobs[0].title).toBe('My saved article');
  const state = await page.evaluate(() => (window as any).browser.runtime.sendMessage({type:'STATE'}));
  expect(JSON.stringify(state)).not.toContain('ntn_fixture');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile-saved.png', fullPage: true });
});
test('recovers a successful append after a lost response without creating another page', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Save to', exact: true }).click();
  await page.getByRole('button', { name: 'Reading room Page' }).click();
  await page.evaluate(() => { (window as any).__failAppendOnce = true; });
  await page.getByRole('button', { name: 'Save to Notion' }).click();
  await expect(page.getByText('Paused · ready to resume', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('Saved to Notion · Reading room')).toBeVisible();
  const requests = await page.evaluate(() => (window as any).__requests);
  expect(requests.filter((r: any) => r.path === 'pages')).toHaveLength(1);
  expect(requests.filter((r: any) => r.method === 'PATCH')).toHaveLength(1);
});
test('reopens saved connections without a passphrase prompt', async ({ page }) => {
  await connect(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Save for later.' })).toBeVisible();
  await expect(page.getByLabel('Passphrase', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Workspace', { exact: true })).toContainText('Personal workspace');
});
test('keeps layout usable at 320px and shows link-only fallback', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await connect(page);
  await page.evaluate(() => { (window as any).__emptyCapture = true; });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Article', exact: false })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Link only', exact: false })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('runs the packaged article extractor in a real browser without mutating the page', async ({ page }) => {
  await page.goto('/popup.html');
  await page.setContent(`<title>Browser article</title><article><h1>Browser article</h1>${'<p>A long and thoughtful article about collecting ideas. This paragraph includes enough meaningful content for the article parser to retain it, and a link to <a href="https://example.com">the source</a>.</p>'.repeat(10)}</article>`);
  const before = await page.locator('article').innerText();
  await page.addScriptTag({ url: '/capture.js' });
  const capture = await page.evaluate(() => (window as any).__pocketCapture());
  expect(capture.blocks.length).toBeGreaterThan(5);
  expect(capture.title).toBe('Browser article');
  expect(await page.locator('article').innerText()).toBe(before);
});

test('migrates legacy encrypted connections once and never prompts on reopening', async ({ page }) => {
  const encrypted = await seal({connections:[{id:'legacy',name:'Personal workspace',token:'ntn_fixture_token_for_testing_only'}],jobs:[],recent:{}},'old passphrase');
  await page.addInitScript(value => {
    if (!localStorage.getItem('clipperData')) localStorage.setItem('vault', JSON.stringify(value));
  },encrypted);
  await page.goto('/popup.html');
  await page.getByLabel('Passphrase', {exact:true}).fill('wrong');
  await page.getByRole('button',{name:'Migrate saved connections'}).click();
  await expect(page.getByRole('status').first()).toContainText('Could not unlock');
  await page.getByLabel('Passphrase', {exact:true}).fill('old passphrase');
  await page.getByRole('button',{name:'Migrate saved connections'}).click();
  await expect(page.getByRole('heading',{name:'Save for later.'})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vault'))).toBeNull();
  await page.reload();
  await expect(page.getByLabel('Passphrase', {exact:true})).toBeHidden();
  await expect(page.getByLabel('Workspace', {exact:true})).toContainText('Personal workspace');
});

test('shows saved workspaces in settings and lets the user continue clipping', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Manage connections' }).click();
  await expect(page.getByRole('heading', { name: 'Your workspaces' })).toBeVisible();
  await expect(page.getByLabel('Integration token')).toBeHidden();
  await page.screenshot({ path: 'artifacts/saved-workspaces.png', fullPage: true });
  await page.getByRole('button', { name: 'Use Personal workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save for later.' })).toBeVisible();
  await expect(page.getByLabel('Workspace', { exact: true })).toContainText('Personal workspace');
});

test('remembers the chosen workspace across reopening', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Manage connections' }).click();
  await page.getByRole('button', { name: 'Add another workspace' }).click();
  await page.getByLabel('Workspace label', { exact: false }).fill('Work');
  await page.getByLabel('Integration token').fill('ntn_fixture_work_token_for_testing');
  await page.getByRole('button', { name: 'Connect to Notion' }).click();
  await page.getByRole('button', { name: 'Use Work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save for later.' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#workspace option:checked')).toHaveText('Work');
  await page.getByRole('button', { name: 'Use Work', exact: true }).click();
  await expect(page.getByLabel('Workspace', { exact: true })).toContainText('Work');
});

test('filters destinations while typing and clears stale sample results for no matches', async ({ page }) => {
  await connect(page);
  await page.getByRole('button', { name: 'Save to', exact: true }).click();
  await page.getByLabel('Search pages and databases').fill('Article');
  await expect(page.getByRole('button', { name: 'Article library Database' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reading room Page' })).toHaveCount(0);
  await page.getByLabel('Search pages and databases').fill('Notes');
  await expect(page.getByText('No more matches.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Article library Database' })).toHaveCount(0);
});
