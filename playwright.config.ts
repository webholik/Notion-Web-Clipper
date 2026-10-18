import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: 'chrome', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
  webServer: { command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:4173/popup.html', reuseExistingServer: true },
  reporter: 'list'
});
