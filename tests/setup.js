// tests/setup.js

const isNodeEnv = typeof window === 'undefined';

jest.setTimeout(60000);

if (!isNodeEnv) {
  // Frontend Test Environment Setup
  window.testEnv = true;

  if (!window.matchMedia) {
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  }

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  }

  if (!window.requestIdleCallback) {
    window.requestIdleCallback = (callback) =>
      setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0);
  }

  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
