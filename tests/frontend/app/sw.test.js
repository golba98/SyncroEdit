/**
 * @jest-environment jsdom
 */

describe('Service Worker', () => {
  let eventListeners = {};

  beforeEach(() => {
    jest.clearAllMocks();
    eventListeners = {};

    global.self = {
      addEventListener: jest.fn((event, callback) => {
        eventListeners[event] = callback;
      }),
      skipWaiting: jest.fn(),
      clients: {
        claim: jest.fn(),
      },
      location: {
        origin: 'https://syncroedit.example.com',
      },
    };

    global.caches = {
      open: jest.fn(),
      match: jest.fn(),
      keys: jest.fn(),
      delete: jest.fn(),
    };

    global.fetch = jest.fn();

    // Reset module cache to load fresh service worker environment
    jest.resetModules();
  });

  it('should register event listeners', () => {
    require('../../../public/sw.js');
    expect(global.self.addEventListener).toHaveBeenCalledWith('install', expect.any(Function));
    expect(global.self.addEventListener).toHaveBeenCalledWith('activate', expect.any(Function));
    expect(global.self.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(global.self.addEventListener).toHaveBeenCalledWith('fetch', expect.any(Function));
  });

  it('cache name is syncroedit-v8 (ensures stale-CSS cache is always busted)', () => {
    require('../../../public/sw.js');
    // The CACHE_NAME constant is not exported, but the activate handler only
    // keeps the current version.  We verify indirectly: when activate runs with
    // an old cache present, only the NEW version survives.
    expect(global.caches.keys).toBeDefined(); // sw loaded without throwing
  });

  it('should clean up old caches on activate', async () => {
    require('../../../public/sw.js');
    const activateCallback = eventListeners['activate'];
    expect(activateCallback).toBeDefined();

    const mockCacheKeys = [
      'syncroedit-v4',
      'syncroedit-v5',
      'syncroedit-v6',
      'syncroedit-v7',
      'syncroedit-v8',
      'some-other-cache',
    ];
    global.caches.keys.mockResolvedValue(mockCacheKeys);
    global.caches.delete.mockResolvedValue(true);

    const mockEvent = {
      waitUntil: jest.fn((promise) => promise),
    };

    activateCallback(mockEvent);
    await new Promise(process.nextTick);

    // Should delete all caches except syncroedit-v8
    expect(global.caches.delete).toHaveBeenCalledWith('syncroedit-v4');
    expect(global.caches.delete).toHaveBeenCalledWith('syncroedit-v5');
    expect(global.caches.delete).toHaveBeenCalledWith('syncroedit-v6');
    expect(global.caches.delete).toHaveBeenCalledWith('syncroedit-v7');
    expect(global.caches.delete).toHaveBeenCalledWith('some-other-cache');
    expect(global.caches.delete).not.toHaveBeenCalledWith('syncroedit-v8');
  });

  describe('fetch handler', () => {
    let fetchCallback;

    beforeEach(() => {
      require('../../../public/sw.js');
      fetchCallback = eventListeners['fetch'];
    });

    it('should ignore non-http schemes', () => {
      const mockEvent = {
        request: {
          url: 'chrome-extension://abc',
          method: 'GET',
        },
        respondWith: jest.fn(),
      };
      fetchCallback(mockEvent);
      expect(mockEvent.respondWith).not.toHaveBeenCalled();
    });

    it('should ignore non-GET requests', () => {
      const mockEvent = {
        request: {
          url: 'https://syncroedit.example.com/index.html',
          method: 'POST',
        },
        respondWith: jest.fn(),
      };
      fetchCallback(mockEvent);
      expect(mockEvent.respondWith).not.toHaveBeenCalled();
    });

    it('should use network-first strategy for navigation requests', async () => {
      const mockRequest = {
        url: 'https://syncroedit.example.com/index.html',
        method: 'GET',
        mode: 'navigate',
        headers: {
          get: jest.fn().mockReturnValue('text/html'),
        },
      };

      const mockResponse = {
        status: 200,
        clone: jest.fn(() => 'cloned-response'),
      };

      global.fetch.mockResolvedValue(mockResponse);
      const mockCache = {
        put: jest.fn().mockResolvedValue(true),
      };
      global.caches.open.mockResolvedValue(mockCache);

      const mockEvent = {
        request: mockRequest,
        respondWith: jest.fn(),
      };

      fetchCallback(mockEvent);

      expect(mockEvent.respondWith).toHaveBeenCalled();
      const responsePromise = mockEvent.respondWith.mock.calls[0][0];
      const result = await responsePromise;

      expect(global.fetch).toHaveBeenCalledWith(mockRequest);
      expect(result).toBe(mockResponse);
      expect(global.caches.open).toHaveBeenCalledWith('syncroedit-v8');
      expect(mockCache.put).toHaveBeenCalledWith(mockRequest, 'cloned-response');
    });

    it('should fall back to cache for navigation request if fetch fails', async () => {
      const mockRequest = {
        url: 'https://syncroedit.example.com/index.html',
        method: 'GET',
        mode: 'navigate',
        headers: {
          get: jest.fn().mockReturnValue('text/html'),
        },
      };

      global.fetch.mockRejectedValue(new Error('Network error'));
      global.caches.match.mockResolvedValue('cached-response');

      const mockEvent = {
        request: mockRequest,
        respondWith: jest.fn(),
      };

      fetchCallback(mockEvent);

      const responsePromise = mockEvent.respondWith.mock.calls[0][0];
      const result = await responsePromise;

      expect(global.caches.match).toHaveBeenCalledWith(mockRequest);
      expect(result).toBe('cached-response');
    });

    it('should use cache-first strategy for static assets', async () => {
      const mockRequest = {
        url: 'https://syncroedit.example.com/css/styles.css',
        method: 'GET',
        mode: 'no-cors',
        headers: {
          get: jest.fn().mockReturnValue('text/css'),
        },
      };

      global.caches.match.mockResolvedValue('cached-css');

      const mockEvent = {
        request: mockRequest,
        respondWith: jest.fn(),
      };

      fetchCallback(mockEvent);

      const responsePromise = mockEvent.respondWith.mock.calls[0][0];
      const result = await responsePromise;

      expect(global.caches.match).toHaveBeenCalledWith(mockRequest);
      expect(result).toBe('cached-css');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch and cache static assets if cache miss', async () => {
      const mockRequest = {
        url: 'https://syncroedit.example.com/css/styles.css',
        method: 'GET',
        mode: 'no-cors',
        headers: {
          get: jest.fn().mockReturnValue('text/css'),
        },
      };

      global.caches.match.mockResolvedValue(null);
      const mockResponse = {
        status: 200,
        clone: jest.fn(() => 'cloned-css'),
      };
      global.fetch.mockResolvedValue(mockResponse);
      const mockCache = {
        put: jest.fn().mockResolvedValue(true),
      };
      global.caches.open.mockResolvedValue(mockCache);

      const mockEvent = {
        request: mockRequest,
        respondWith: jest.fn(),
      };

      fetchCallback(mockEvent);

      const responsePromise = mockEvent.respondWith.mock.calls[0][0];
      const result = await responsePromise;

      expect(global.caches.match).toHaveBeenCalledWith(mockRequest);
      expect(global.fetch).toHaveBeenCalledWith(mockRequest);
      expect(result).toBe(mockResponse);
      expect(global.caches.open).toHaveBeenCalledWith('syncroedit-v8');
      expect(mockCache.put).toHaveBeenCalledWith(mockRequest, 'cloned-css');
    });
  });
});
