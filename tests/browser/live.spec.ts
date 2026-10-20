import { test, expect } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:4175' });
const id = '12345678-1234-1234-1234-123456789abc';
test(
  'local live app authenticates and searches through the bridge ' +
    'without returning demo destinations',
  async ({ page }) => {
    const queries: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/notion/v1/**', async (route) => {
      expect(route.request().headers()['x-pocket-bridge']).toBeTruthy();
      expect(route.request().headers().authorization).toBe(
        'Bearer ntn_fixture_live_transport_testing',
      );
      if (route.request().url().endsWith('/users/me')) {
        await route.fulfill({ json: { object: 'user', id, name: 'My Notion workspace' } });
        return;
      }
      const query = route.request().postDataJSON().query;
      queries.push(query);
      await route.fulfill({
        json: {
          results: [
            {
              object: 'data_source',
              id,
              title: [{ plain_text: 'Notes' }],
              properties: { Name: { id: 'title', type: 'title' } },
            },
          ],
          has_more: false,
        },
      });
    });
    await page.goto('/popup.html');
    await expect(page.getByText('LOCAL APP · Live Notion API')).toBeVisible();
    await page.getByLabel('Integration token').fill('ntn_fixture_live_transport_testing');
    await page.getByRole('button', { name: 'Connect to Notion' }).click();
    await page.getByRole('button', { name: 'Save to', exact: true }).click();
    await page.getByLabel('Search pages and databases').fill('notes');
    await expect(page.getByRole('button', { name: 'Notes Database' })).toBeVisible();
    await expect.poll(() => queries).toContain('notes');
    await expect(page.getByText('Article library')).toHaveCount(0);
    await expect(page.getByText('Reading room')).toHaveCount(0);
    await page.getByRole('button', { name: 'Notes Database' }).click();
    await page.getByLabel('Webpage URL').fill('https://example.com/my-note');
    await page.getByRole('button', { name: 'Use this link' }).click();
    await expect(page.getByRole('radio', { name: 'Link only', exact: false })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Save to Notion' })).toBeEnabled();
    expect(errors).toEqual([]);
  },
);
test(
  'displays rejected-token errors instead of accepting a fake ' + 'workspace connection',
  async ({ page }) => {
    await page.route('**/api/notion/v1/users/me', (route) =>
      route.fulfill({ status: 401, json: { object: 'error', code: 'unauthorized' } }),
    );
    await page.goto('/popup.html');
    await page.getByLabel('Integration token').fill('ntn_fixture_invalid_token_testing');
    await page.getByRole('button', { name: 'Connect to Notion' }).click();
    await expect(page.getByRole('status').first()).toContainText('invalid or has been revoked');
    await expect(page.getByRole('heading', { name: 'Connect a workspace' })).toBeVisible();
  },
);
