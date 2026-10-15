const { test, expect } = require('@playwright/test');
const { createVerifiedSessionViaApi } = require('./helpers/auth');

const HEADER_CONTROLS = ['#menuBtn', '#docTitle', '#saveBtn', '#chatToggle', '#shareBtn'];

async function openNewDocument(page) {
  await createVerifiedSessionViaApi(page, `mob_${Math.random().toString(36).slice(2, 10)}`);
  await page.goto('/index.html');
  await expect(page.locator('#docLibrary')).toBeVisible();
  await page.click('#fabCreateDoc');
  await expect(page.locator('body')).toHaveAttribute('data-editor-ready', 'true', {
    timeout: 30000,
  });
  await expect(page.locator('.ql-editor').first()).toBeVisible();
}

function rgb(color) {
  const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number);
  return { r, g, b, a };
}

test.describe('Mobile editor', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone layout only');

  test('header stays one quiet row with a readable title', async ({ page }) => {
    await openNewDocument(page);
    await expect(page.locator('#fabEditDoc')).toHaveCount(0);

    for (const width of [393, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(60);
      const header = await page.locator('.header').boundingBox();
      expect(header.height).toBeLessThanOrEqual(57);

      const boxes = [];
      for (const selector of [...HEADER_CONTROLS, '#headerMoreBtn']) {
        const control = page.locator(selector);
        await expect(control).toBeVisible();
        boxes.push(await control.boundingBox());
      }
      for (const box of boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
        expect(box.y).toBeGreaterThanOrEqual(header.y - 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height + 0.5);
      }
      const title = await page.locator('#docTitle').boundingBox();
      expect(title.width).toBeGreaterThanOrEqual(width >= 360 ? 96 : 72);
    }

    const save = page.locator('#saveBtn');
    await expect(save).toHaveAttribute('data-status', /^(saved|saving|unsaved|offline|failed)$/);
    await expect(save).toHaveAttribute('aria-label', /Saved|Saving|Unsaved|Offline|Save failed/);
    const saveBackground = rgb(await save.evaluate((el) => getComputedStyle(el).backgroundColor));
    expect(
      saveBackground.a === 0 || saveBackground.r + saveBackground.g + saveBackground.b < 200
    ).toBe(true);
    const titleColor = rgb(
      await page.locator('#docTitle').evaluate((el) => getComputedStyle(el).color)
    );
    expect(Math.min(titleColor.r, titleColor.g, titleColor.b)).toBeGreaterThanOrEqual(220);

    await page.setViewportSize({ width: 393, height: 851 });
    await page.screenshot({ path: test.info().outputPath('mobile-editor-idle.png') });
  });

  test('formatting toolbar docks to the bottom while editing and keeps focus', async ({ page }) => {
    await openNewDocument(page);
    const toolbar = page.locator('#mobileContextualToolbar');
    // A new document focuses the editor, so the toolbar follows that focus.
    await expect(toolbar).toBeVisible();
    await toolbar.locator('#mobileCloseKeyboard').tap();
    await expect(toolbar).toBeHidden();

    await page.locator('.ql-editor').first().tap();
    await page.keyboard.type('Mobile formatting');
    await expect(toolbar).toBeVisible();

    const viewport = page.viewportSize();
    const bar = await toolbar.boundingBox();
    expect(Math.abs(bar.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(bar.width - viewport.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(bar.y + bar.height - viewport.height)).toBeLessThanOrEqual(1);
    expect(bar.height).toBeLessThanOrEqual(64);

    const tops = await toolbar
      .locator('.mobile-tool-btn:visible')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
    expect(tops.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);

    await page.keyboard.press('Control+A');
    const bold = toolbar.locator('.ql-bold');
    await bold.tap();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ql-editor'))).toBe(true);
    await expect(page.locator('.ql-editor').first().locator('strong')).toContainText(
      'Mobile formatting'
    );

    const surface = await page.evaluate((top) => {
      const pages = document.getElementById('pagesContainer');
      const sheet = document.querySelector('.page-scaler');
      const hit = document.elementFromPoint(window.innerWidth / 2, top - 4);
      return {
        pages: getComputedStyle(pages).backgroundColor,
        sheet: getComputedStyle(sheet).backgroundColor,
        onSheet: !!hit?.closest('.page-scaler'),
      };
    }, bar.y);
    expect(surface.sheet).toBe(surface.pages);
    expect(surface.onSheet).toBe(true);
    await page.screenshot({ path: test.info().outputPath('mobile-editor-editing.png') });

    await toolbar.locator('#mobileCloseKeyboard').tap();
    await expect(toolbar).toBeHidden();
  });

  test('light theme keeps one surface', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('syncroEditTheme', 'light'));
    await openNewDocument(page);
    await expect(page.locator('body')).toHaveClass(/light-theme/);
    await page.locator('.ql-editor').first().tap();
    await expect(page.locator('#mobileContextualToolbar')).toBeVisible();
    const colors = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector('.header')).backgroundColor,
      pages: getComputedStyle(document.getElementById('pagesContainer')).backgroundColor,
      sheet: getComputedStyle(document.querySelector('.page-scaler')).backgroundColor,
    }));
    expect(colors.sheet).toBe(colors.pages);
    expect(colors.header).toBe(colors.pages);
    await page.screenshot({ path: test.info().outputPath('mobile-editor-light.png') });
  });
});
