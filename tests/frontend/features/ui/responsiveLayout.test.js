/**
 * @jest-environment jsdom
 */

import {
  keyboardInset,
  layoutMode,
  VIEWPORT_BREAKPOINTS,
} from '../../../../public/js/features/ui/ResponsiveLayoutController.js';

describe('responsive layout breakpoints', () => {
  it.each([
    [320, 'mobile'],
    [599, 'mobile'],
    [600, 'tablet'],
    [899, 'tablet'],
    [900, 'compact'],
    [1199, 'compact'],
    [1200, 'desktop'],
    [2560, 'desktop'],
  ])('maps a %ipx viewport to %s mode', (width, expected) => {
    expect(layoutMode(width)).toBe(expected);
  });

  it('keeps the shared breakpoint contract stable', () => {
    expect(VIEWPORT_BREAKPOINTS).toEqual({ mobile: 600, tablet: 900, compact: 1200 });
  });
});

describe('on-screen keyboard inset', () => {
  it('measures the layout viewport covered below the visual viewport', () => {
    expect(keyboardInset(851, { height: 500, offsetTop: 0 })).toBe(351);
    expect(keyboardInset(851, { height: 500, offsetTop: 40 })).toBe(311);
  });

  it('is zero without a keyboard or visualViewport support', () => {
    expect(keyboardInset(851, { height: 851, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(851, { height: 900, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(851, undefined)).toBe(0);
  });
});
