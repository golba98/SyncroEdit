/**
 * @jest-environment jsdom
 */

import { DynamicBackground } from '../../../../public/js/features/theme/background.js';

describe('DynamicBackground', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="main-workspace"></div>';
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fillText: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      createRadialGradient: jest.fn(() => ({
        addColorStop: jest.fn(),
      })),
      measureText: jest.fn(() => ({ width: 10 })),
    }));
    window.requestAnimationFrame = jest.fn(() => 1);
    window.cancelAnimationFrame = jest.fn();
  });

  it('does not crash when the current theme is missing', () => {
    const background = new DynamicBackground();
    background.currentTheme = 'missing-theme';

    expect(() => background.createParticles()).not.toThrow();
    expect(background.particles.length).toBeGreaterThan(0);
  });
});
