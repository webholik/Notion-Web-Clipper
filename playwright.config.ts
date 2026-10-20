import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
  },
  webServer: [
    {
      command: 'node scripts/preview.mjs --demo --port=4174',
      url: 'http://127.0.0.1:4174/popup.html',
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/preview.mjs --port=4175',
      url: 'http://127.0.0.1:4175/popup.html',
      reuseExistingServer: false,
    },
  ],
  reporter: 'list',
});
