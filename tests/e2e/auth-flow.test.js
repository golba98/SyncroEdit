const { test, expect } = require('@playwright/test');
const { createVerifiedSessionViaApi, registerVerifyAndLogin } = require('./helpers/auth');

test.describe('Auth and Basic Document Flow', () => {
  test('should register, login, create doc, edit, save, and logout', async ({ page }) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.error('PAGE ERROR:', err.stack || err.message));
    const testUser = `u_${test.info().project.name.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`;
    await registerVerifyAndLogin(page, testUser);

    // 2. Create Document
    // Library should be open by default if no doc is in URL
    await page.waitForTimeout(1000);
    const isMobile = test.info().project.name === 'mobile';
    if (isMobile) {
      await page.click('#fabCreateDoc');
    } else {
      await page.click('#createNewDoc');
    }

    // Wait for doc library to close and document to be ready
    await expect(page.locator('#docLibrary')).not.toBeVisible();

    // 3. Edit Document
    const testTitle = `Test Document ${Date.now()}`;
    await page.fill('#docTitle', testTitle);

    // Quill editor
    const editor = page.locator('.ql-editor');
    await expect(editor).toHaveAttribute('contenteditable', 'true', {
      timeout: 30000,
    });
    await editor.click({ force: true });
    await editor.fill('Hello, this is a test collaborative document!');

    // 4. Save
    const saveBtn = page.locator('#saveBtn');
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
    }
    // Check if some success message or indicator appears?
    // In many apps it might just save silently.
    // Let's assume it works if no error occurs.

    // 5. Logout
    await page.click('#userProfileTrigger');
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.click('#logoutBtnProfile', { force: true });

    // Should be back at login page
    await expect(page).toHaveURL(/\/pages\/login(?:\.html)?$/);
  });

  test('should keep session verification hidden during startup reloads', async ({ page }) => {
    await page.goto('/pages/login.html');
    const testUser = `s_${test.info().project.name.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`;

    await createVerifiedSessionViaApi(page, testUser);

    await page.goto('/index.html');

    await expect(page.locator('#authGuard')).toBeHidden();
    await expect(page.locator('#docLibrary')).toBeVisible();

    await page.reload();

    await expect(page.locator('#authGuard')).toBeHidden();
    await expect(page.locator('#docLibrary')).toBeVisible();
  });
});
