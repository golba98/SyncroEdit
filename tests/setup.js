// tests/setup.js

const isNodeEnv = typeof window === 'undefined';

jest.setTimeout(60000);

if (!isNodeEnv) {
  // Frontend Test Environment Setup
  window.testEnv = true;

  // Mock IntersectionObserver for browser environment tests
  global.IntersectionObserver = class IntersectionObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
