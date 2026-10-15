const { test, expect } = require('@playwright/test');
const { createVerifiedSessionViaApi } = require('./helpers/auth');

function uniqueUser(prefix) {
  return `${prefix}_${test.info().project.name.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`;
}

test.describe('Loading surfaces', () => {
  test('boot loader uses the current monochrome brand surface', async ({ page }) => {
    const username = uniqueUser('boot');
    await createVerifiedSessionViaApi(page, username);

    let releaseProfile;
    const profileBlocked = new Promise((resolve) => {
      releaseProfile = resolve;
    });

    await page.route('**/api/user/profile', async (route) => {
      await profileBlocked;
      await route.continue();
    });

    await page.goto('/index.html');

    const bootLoader = page.locator('#bootLoader');
    await expect(bootLoader).toBeVisible();
    await expect(bootLoader.locator('img.boot-loader-mark')).toHaveAttribute('src', '/logo.svg');
    await expect(bootLoader.locator('.boot-loader-progress')).toBeVisible();
    await expect(bootLoader).not.toContainText('📄');

    releaseProfile();
    await expect(bootLoader).not.toBeVisible();
  });

  test('new document loader stays inside the editor viewport until ready', async ({ page }) => {
    const username = uniqueUser('create');
    await createVerifiedSessionViaApi(page, username);
    await page.goto('/index.html');
    await expect(page.locator('#docLibrary')).toBeVisible();

    let releaseCreate;
    const createBlocked = new Promise((resolve) => {
      releaseCreate = resolve;
    });

    await page.route('**/api/documents', async (route) => {
      if (route.request().method() === 'POST') {
        await createBlocked;
      }
      await route.continue();
    });

    await page.click('#createNewDoc');

    const loader = page.locator('#editorSkeleton');
    await expect(loader).toBeVisible();
    await expect(page.locator('#editorSkeletonTitle')).toHaveText('Creating document...');
    await expect(loader).toHaveAttribute('data-open-state', 'creating');

    const viewport = page.viewportSize();
    const workspaceBox = await page.locator('.main-workspace').boundingBox();
    const loaderBox = await loader.boundingBox();
    expect(viewport).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    expect(loaderBox).not.toBeNull();
    expect(loaderBox.x).toBeGreaterThanOrEqual(workspaceBox.x - 1);
    expect(loaderBox.y).toBeGreaterThanOrEqual(workspaceBox.y - 1);
    expect(loaderBox.x + loaderBox.width).toBeLessThanOrEqual(
      workspaceBox.x + workspaceBox.width + 1
    );
    expect(loaderBox.y + loaderBox.height).toBeLessThanOrEqual(
      workspaceBox.y + workspaceBox.height + 1
    );
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height + 1
    );

    // The visible overlay must be one opaque surface over the whole screen so
    // the header never shows as a separate band and the card sits centered.
    const overlay = page.locator('#editorWorkspaceLoader');
    await expect(overlay).toBeVisible();
    const overlayBox = await overlay.boundingBox();
    expect(Math.abs(overlayBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayBox.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(overlayBox.height - viewport.height)).toBeLessThanOrEqual(1);
    const cardBox = await overlay.locator('.editor-workspace-loader-card').boundingBox();
    expect(Math.abs(cardBox.x + cardBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(cardBox.y + cardBox.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
    const surface = await page.evaluate(() => {
      const el = document.getElementById('editorWorkspaceLoader');
      const style = getComputedStyle(el);
      const covers = (y) =>
        el.contains(document.elementFromPoint(window.innerWidth / 2, y)) &&
        el.contains(document.elementFromPoint(2, y));
      return {
        background: style.backgroundColor,
        backdrop: style.backdropFilter,
        top: covers(2),
        bottom: covers(window.innerHeight - 2),
      };
    });
    expect(surface.background).toMatch(/^rgb\(/);
    expect(surface.backdrop).toBe('none');
    expect(surface.top).toBe(true);
    expect(surface.bottom).toBe(true);
    await page.screenshot({ path: test.info().outputPath('creating-document-loader.png') });

    releaseCreate();
    await expect(loader).toBeHidden({ timeout: 30000 });
    await expect(loader).toHaveAttribute('data-open-state', 'ready');
    await expect(page.locator('.editor-container').first()).toBeVisible({ timeout: 30000 });
  });
});
