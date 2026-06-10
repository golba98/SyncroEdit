const CACHE_NAME = 'syncroedit-v6';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/config.js',
  '/css/styles.css',
  '/js/app/app.js',
  '/js/app/network.js',
  '/js/app/utils.js',
  '/js/features/ui/ui.js',
  '/js/features/auth/auth.js',
  '/js/features/theme/theme.js',
  '/js/features/profile/profile.js',
  '/js/features/theme/background.js',
  '/js/features/auth/authController.js',
  '/js/features/editor/editor.js',
  '/js/features/editor/managers/PageManager.js',
  '/js/features/editor/managers/BorderManager.js',
  '/js/features/editor/managers/CursorManager.js',
  '/js/features/editor/managers/ImageManager.js',
  '/js/features/library/LibraryManager.js',
  '/js/features/editor/managers/ReadabilityManager.js',
  '/js/features/editor/managers/SelectionManager.js',
  '/js/features/editor/managers/NavigationManager.js',
  '/js/features/ui/ToolbarController.js',
  '/js/features/ui/UIManager.js',
  '/pages/login.html',
  '/pages/start.html',
  '/pages/forgot-password.html',
  '/pages/reset-password.html',
  '/pages/verify.html',
  // External CDNs - Cache them for performance/offline
  '/vendor/fontawesome/css/all.min.css',
  'https://cdn.quilljs.com/1.3.6/quill.snow.css',
  'https://cdn.quilljs.com/1.3.6/quill.js',
  '/vendor/idb-keyval/index.js',
  'https://esm.sh/yjs@13.6.28',
  'https://esm.sh/y-quill@1.0.0?deps=yjs@13.6.28',
  '/js/vendor/y-websocket.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching App Shell');
      // Use cache.addAll cautiously, if one fails, the whole install fails.
      // Better to map and catch errors if some assets might be missing.
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn(`Failed to cache ${url}:`, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing Old Cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Handle messages safely
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Explicitly return nothing to indicate synchronous handling (or no handling)
});

// Helper to detect navigation / HTML requests
function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('Accept')?.includes('text/html'))
  );
}

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const urlString = event.request.url;

  // Ignore non-http/https schemes early
  if (!urlString.startsWith('http')) {
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(urlString);
  } catch (e) {
    // If the URL cannot be parsed for some reason, do not handle it
    return;
  }

  // Ignore API requests, WebSocket upgrades, and socket.io paths for same-origin requests
  if (requestUrl.origin === self.location.origin) {
    const pathname = requestUrl.pathname || '';
    if (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/ws/') ||
      pathname.startsWith('/socket.io')
    ) {
      return;
    }
  }

  // Ignore non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Navigation requests: Network-First
  if (isNavigationRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          console.debug('[SW] Navigation fetch failed, falling back to cache:', event.request.url);
          return caches.match(event.request);
        })
    );
    return;
  }

  // Static assets: Cache-First
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch((err) => {
          console.warn('[SW] Fetch failed:', event.request.url);
          return new Response('Network Error', { status: 404, statusText: 'Network Error' });
        });
    })
  );
});
