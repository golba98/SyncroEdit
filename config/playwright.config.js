const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '../tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: {
      'x-bypass-rate-limit': 'true',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command:
      'rm -rf .wrangler/state/v3/d1 && npx wrangler d1 migrations apply DB --local && npx wrangler dev --port 8787 --var NODE_ENV:test --var EMAIL_CODE_PEPPER:test-email-code-pepper-123 --var RESEND_API_KEY:test-resend-api-key --var "EMAIL_FROM:SyncroEdit <verify@example.com>" --var APP_NAME:SyncroEdit',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
