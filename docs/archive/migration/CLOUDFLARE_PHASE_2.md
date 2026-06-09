# Cloudflare Migration Phase 2: Frontend Runtime Configuration

## Goal

Prepare the SyncroEdit static frontend for deployment on Cloudflare Pages by supporting a runtime configuration for the API and WebSocket base URLs. This decouples the frontend code from a hardcoded same-origin assumption, allowing the client to talk to backend services hosted on separate domains (e.g., Cloudflare Workers & Durable Objects) in future phases.

## What was completed in this phase

- **Runtime Configuration Injection**: Added a `/config.js` script to the application root that declares a global `window.SYNCROEDIT_CONFIG` object.
- **HTML Script Injections**: Injected the `/config.js` script block into `public/index.html` and all `public/pages/*.html` views before they load their core ES modules.
- **Service Worker Cache**: Added `/config.js` to the Service Worker cache list (`ASSETS_TO_CACHE`) in `public/sw.js` to support offline capabilities and ensure it is cached as part of the app shell.
- **Dynamic API/WS URL Building**:
  - Refactored `public/js/app/network.js` to build all API fetch calls dynamically using `API_BASE_URL` if configured.
  - Refactored WebSocket connection logic in `public/js/app/network.js` and `public/js/features/editor/editor.js` to use `WS_BASE_URL` if configured, falling back to an automatically derived URL from the API base URL or `window.location`.
- **Default Local Behavior Preserved**: Initialized both config URLs as empty strings (`''`), which guarantees that same-origin requests are used by default. This preserves local development with the Node.js/Express backend at `http://localhost:3000`.

---

## Local Node Mode

By default, `/public/config.js` is set to:

```javascript
window.SYNCROEDIT_CONFIG = window.SYNCROEDIT_CONFIG || {
  API_BASE_URL: '',
  WS_BASE_URL: '',
};
```

This ensures that:

- Fetch calls to `/api/...` go to the same origin (e.g., `http://localhost:3000`).
- WebSocket connections are established using the browser's hostname (e.g., `ws://localhost:3000`).

No manual configuration is required for running SyncroEdit locally using:

```bash
npm run dev
```

---

## Future Pages + Worker Deployments

In a fully-migrated environment:

1. The static frontend is deployed to **Cloudflare Pages**.
2. The REST API is hosted on a **Cloudflare Worker** (e.g. at `https://api.syncroedit.com`).
3. Collaborative document sync is handled by **Durable Objects** (e.g. at `wss://api.syncroedit.com`).

To configure the frontend to point to these deployed services, you can replace or dynamically overwrite the `/config.js` file at deploy time (or write a Pages middleware to inject env-specific scripts) with the target endpoints.

### Example Production Configuration

```javascript
window.SYNCROEDIT_CONFIG = {
  API_BASE_URL: 'https://api.syncroedit.com',
  WS_BASE_URL: 'wss://api.syncroedit.com',
};
```

With this configuration:

- Every fetch request made by the client automatically routes to `https://api.syncroedit.com/api/...` instead of the Pages host.
- WebSocket connections connect to `wss://api.syncroedit.com` instead of the Pages host.
- Cookies and authorization headers are properly preserved using `credentials: 'include'`.

---

## Next Steps (Phase 3)

1. Move authentication logic and Express routes to the Cloudflare Worker under `worker/`.
2. Transition collaborative WebSockets and Yjs document replication to Durable Objects.
3. Configure persistent storage (e.g., Cloudflare D1 or external MongoDB Atlas connection).
