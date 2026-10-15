const { defineConfig, devices } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const state = `.wrangler/e2e-${randomUUID()}`;
const root = path.resolve(__dirname, '..');
if (
  process.env.PLAYWRIGHT_BASE_URL &&
  !/^http:\/\/(?:localhost|127\.0\.0\.1):[0-9]+$/.test(process.env.PLAYWRIGHT_BASE_URL)
) {
  throw new Error('Browser tests may only target a local emulator');
}

module.exports = defineConfig({
  testDir: '../tests/e2e',
  outputDir: path.join(root, state, 'artifacts'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8791',
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
    command: `npx wrangler d1 migrations apply DB --local --env local --persist-to ${state} && npx wrangler dev --env local --port 8791 --persist-to ${state} --var NODE_ENV:test --var EMAIL_CODE_PEPPER:test-email-code-pepper-123 --var RESEND_API_KEY:test-resend-api-key --var "EMAIL_FROM:SyncroEdit <verify@example.com>" --var APP_NAME:SyncroEdit --var JWT_SECRET:local-e2e-only-secret-123`,
    cwd: root,
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8791',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
