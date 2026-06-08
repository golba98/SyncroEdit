const { test, expect } = require('@playwright/test');

test.describe('Auth and Basic Document Flow', () => {
  test('should register, login, create doc, edit, save, and logout', async ({ page }) => {
    // 1. Registration
    await page.goto('/pages/login.html');
    await page.click('#showSignup');

    const testUser = `user_${test.info().project.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await page.fill('#signupUsername', testUser);
    await page.fill('#signupEmail', `${testUser}@example.com`);
    await page.fill('#signupPassword', 'Password123!');
    await page.fill('#signupPasswordConfirm', 'Password123!');
    await page.click('#signupBtn');

    // Wait for redirect to the app entrypoint (since email verification is disabled)
    await expect(page).toHaveURL(/\/(?:index\.html)?$/);

    // 2. Create Document
    // Library should be open by default if no doc is in URL
    await page.waitForTimeout(1000);
    await page.click('#createNewDoc');

    // Wait for doc library to close and document to be ready
    await expect(page.locator('#docLibrary')).not.toBeVisible();

    // 3. Edit Document
    const testTitle = `Test Document ${Date.now()}`;
    await page.fill('#docTitle', testTitle);

    // Quill editor
    const editor = page.locator('.ql-editor');
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 30000 });
    await editor.click({ force: true });
    await editor.fill('Hello, this is a test collaborative document!');

    // 4. Save
    await page.click('#saveBtn');
    // Check if some success message or indicator appears?
    // In many apps it might just save silently.
    // Let's assume it works if no error occurs.

    // 5. Logout
    await page.click('#userProfileTrigger');
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.click('#logoutBtnProfile', { force: true });

    // Should be back at login page
    await expect(page).toHaveURL(/\/pages\/login.html/);
  });

  test('should keep session verification hidden during startup reloads', async ({ page }) => {
    await page.goto('/pages/login.html');
    const testUser = `startup_${test.info().project.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const csrfResponse = await page.request.get('/api/auth/csrf-token');
    const { csrfToken } = await csrfResponse.json();

    const signupResponse = await page.request.post('/api/auth/signup', {
      headers: {
        'X-CSRF-Token': csrfToken,
      },
      data: {
        username: testUser,
        email: `${testUser}@example.com`,
        password: 'Password123!',
      },
    });

    expect(signupResponse.ok()).toBeTruthy();

    await page.goto('/index.html');

    await expect(page.locator('#authGuard')).toBeHidden();
    await expect(page.locator('#docLibrary')).toBeVisible();

    await page.reload();

    await expect(page.locator('#authGuard')).toBeHidden();
    await expect(page.locator('#docLibrary')).toBeVisible();
  });
});
