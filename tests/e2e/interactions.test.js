const { test, expect } = require('@playwright/test');

test.describe('UI Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test in this describe block
    await page.goto('/pages/login.html');

    // Using dev-mode shortcut mentioned in login.html if available,
    // or just register a new user.
    // Since we want these tests to be independent, let's just register.
    const testUser = `i_${test.info().project.name.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`;
    await page.click('#showSignup');
    await page.fill('#signupUsername', testUser);
    await page.fill('#signupEmail', `${testUser}@example.com`);
    await page.fill('#signupPassword', 'Password123!');
    await page.fill('#signupPasswordConfirm', 'Password123!');
    await page.click('#signupBtn');
    await expect(page).toHaveURL(/\/(?:index\.html)?$/);
    await page.waitForTimeout(1000);
    const isMobile = test.info().project.name === 'mobile';
    if (isMobile) {
      await page.click('#fabCreateDoc');
    } else {
      await page.click('#createNewDoc');
    }
    await expect(page.locator('#docLibrary')).not.toBeVisible();
  });

  test('should toggle bold and italic via toolbar', async ({ page }) => {
    const editor = page.locator('.ql-editor');
    await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 30000 });
    await editor.click({ force: true });
    await editor.fill('Testing toolbar');

    // Select text
    await page.keyboard.press('Control+a');

    // Click bold button (Quill uses .ql-bold)
    const boldBtn = page.locator('.ql-bold:visible').first();
    await boldBtn.click();

    // Check if bold is applied (Quill wraps in <strong> or <b> or styles)
    const boldText = editor.locator('strong, b');
    await expect(boldText).toBeVisible();

    // Click italic button
    const italicBtn = page.locator('.ql-italic:visible').first();
    await italicBtn.click();
    const italicText = editor.locator('em, i');
    await expect(italicText).toBeVisible();
  });

  test('should switch between light and dark themes', async ({ page }) => {
    await page.click('#userProfileTrigger');
    await expect(page.locator('#profileModal')).toBeVisible();

    // Click Appearance tab
    await page.click('button[data-tab="appearance"]', { force: true });
    await expect(page.locator('#appearance-content')).toBeVisible();

    // Click Light Theme
    await page.click('#lightThemeBtn');
    await expect(page.locator('body')).toHaveClass(/light-theme/);

    // Click Dark Theme
    await page.click('#darkThemeBtn');
    await expect(page.locator('body')).not.toHaveClass(/light-theme/);
  });
});
