# Cloudflare Migration Code Complete

This document outlines the finished codebase changes for the hybrid Cloudflare migration of SyncroEdit and provides the exact checklist for the remaining external configuration and deployment.

---

## Code Completed in This Phase

1. **Worker Route Ownership & Config:** Clear route patterns mapping edge-owned endpoints (`/`, `/api/health`, `/api/config`, `/ws/:id`, `/api/realtime/:id`) and proxying Node routes (`/api/node/*`).
2. **Production-Hardened Worker Proxy:** Cleans headers (removes hop-by-hop), preserves cookies, supports multiple `Set-Cookie` headers, forwards bodies safely, logs securely without leaking secrets/cookies, and returns generic JSON 502 error responses if the backend is unreachable.
3. **Flexible Frontend Configuration:** `public/config.js` defaults to safe same-origin values. Clear comments and usage documented in `public/config.example.local.js` and `public/config.example.production.js`.
4. **WebSocket URL Resolution:** Resolved custom and relative URL schemes dynamically depending on the selected `REALTIME_BACKEND` (`node` vs `durable-object`).
5. **Worker Yjs Durable Object (DocumentSyncObject):** Correctly manages `Y.Doc` state, broadcasts sync/awareness updates, blocks write operations from read-only viewers, and gracefully cleans up on disconnects.
6. **WS-Ticket Consumption Bridge:** A fully verified secure internal ticket consumption endpoint (`POST /api/auth/ws-ticket/consume`) complete with robust unit tests.
7. **Durable Object Yjs state persistence sync:** Periodically flushes compacted Yjs state back to the Node/MongoDB database via a secure internal endpoint (`POST /api/internal/documents/:id/yjs-state`).
8. **Worker Rate Limiting:** Hardened edge rate limiter to return standard `Retry-After` headers on 429 responses.
9. **Full Test Coverage:** Added unit and integration tests covering Worker proxy, WS ticket consumption, URL builders, Durable Object sync and awareness behavior, and internal persistence sync endpoint.

---

## Feature Flags & Configuration Defaults

### Cloudflare Worker (`worker/wrangler.toml` or Env)

| Flag                               | Default | Description                                                   |
| ---------------------------------- | ------- | ------------------------------------------------------------- |
| `REALTIME_DURABLE_OBJECTS_ENABLED` | `false` | Toggles Durable Object WebSocket collaboration routes on/off. |
| `EDGE_RATE_LIMITING_ENABLED`       | `false` | Toggles edge-level rate limiting on/off.                      |
| `DO_PERSISTENCE_SYNC_ENABLED`      | `false` | Enables flushing DO state back to Node/Mongo.                 |

### Client-Side Configuration (`config.local.js` / `config.production.js`)

| Key                | Default  | Description                                                       |
| ------------------ | -------- | ----------------------------------------------------------------- |
| `REALTIME_BACKEND` | `"node"` | Toggles client realtime provider: `"node"` or `"durable-object"`. |

---

## How to Run and Test Locally

### Running Local Hybrid Mode

1. Start your local MongoDB database:
   ```bash
   docker start syncroedit-mongo
   ```
2. Start the Node/Express backend:
   ```bash
   npm run dev
   ```
3. Start the Cloudflare Worker locally:
   ```bash
   npm run cf:dev
   ```
4. Copy `public/config.example.local.js` to `public/config.local.js` and configure it to point to the worker:
   ```javascript
   window.SYNCROEDIT_CONFIG = {
     API_BASE_URL: 'http://localhost:8787/api/node',
     WS_BASE_URL: 'ws://localhost:3000', // Keeps default Node WS fallback
     REALTIME_BACKEND: 'node',
   };
   ```
5. Open your browser and navigate to `http://localhost:8787`. All static resources are served, and API requests proxy through the Worker to the Node backend.

### Running and Testing Durable Object Realtime Locally

1. Enable Durable Objects in your local wrangler config or via override:
   Update `worker/wrangler.toml` `vars`:
   ```toml
   REALTIME_DURABLE_OBJECTS_ENABLED = "true"
   ```
2. Copy `public/config.example.local.js` to `public/config.local.js` and toggle the realtime backend:
   ```javascript
   window.SYNCROEDIT_CONFIG = {
     API_BASE_URL: 'http://localhost:8787/api/node',
     WS_BASE_URL: 'ws://localhost:8787', // Points to the Worker port
     REALTIME_BACKEND: 'durable-object',
   };
   ```
3. Restart `npm run cf:dev` to apply variables. Realtime communication will now run on the local Cloudflare Durable Object.

### Testing Yjs State Persistence Sync Locally

1. Set up the sync secret environment variables.
   In your local backend `.env`:
   ```env
   DO_PERSISTENCE_SYNC_ENABLED=true
   DO_SYNC_SECRET=local-sync-secret-token
   ```
2. In your local worker env (configure via `.dev.vars` inside `worker/` folder - **do not commit this file**):
   ```env
   DO_PERSISTENCE_SYNC_ENABLED=true
   DO_SYNC_SECRET=local-sync-secret-token
   ```
3. Start both backend and worker dev servers. When editing a document in Durable Object mode, the Worker will periodically save state to local DO storage and flush base64 compacted state to the Node backend. On disconnecting the last client, state is flushed immediately.

---

## External Setup Checklist for the User

After code completion, the following steps must be completed outside the repository:

- [ ] **Cloudflare Account & DNS:**
  - Create a Cloudflare account.
  - Add your custom domain (e.g. `syncroedit.com`) and configure DNS records to route traffic.
- [ ] **Cloudflare Pages Setup:**
  - Set up a Pages project connected to your GitHub repository.
  - Configure the build command (`npm run build` or skip compile since it's vanilla JS) and set the output directory to `public`.
- [ ] **Cloudflare Worker Deploy:**
  - Deploy the worker using wrangler command: `npm run cf:deploy`.
- [ ] **Worker Bindings configuration:**
  - Bind the Durable Object class `DocumentSyncObject` under the name `DOCUMENT_SYNC_OBJECT` in the Cloudflare dashboard.
  - Add SQLite migrations for Durable Object storage.
- [ ] **Secret Configuration via Wrangler CLI:**
  - Run the following commands to add secrets:
    ```bash
    wrangler secret put DO_SYNC_SECRET
    ```
- [ ] **Production Environment Variables:**
  - Set `BACKEND_ORIGIN` in the Cloudflare Workers dashboard to point to your production Node server (e.g., `https://api.syncroedit.com`).
  - Set `DO_PERSISTENCE_SYNC_ENABLED` and `REALTIME_DURABLE_OBJECTS_ENABLED` to `true` when ready to go live.
- [ ] **Node/Express Server Deployment:**
  - Deploy the Node server to your cloud provider of choice (Render, Railway, Heroku, AWS).
  - Set `.env` production variables: `DO_PERSISTENCE_SYNC_ENABLED=true`, `DO_SYNC_SECRET` (matching worker secret), and correct MongoDB connection string.
- [ ] **Cookie & SameSite Verification:**
  - Test browser logins on the staging environment. Ensure cookies (`refreshToken`) are set with `Secure; HttpOnly; SameSite=Lax`.

---

## Rollback Plan

If issues occur during production deployment, execute the following:

1. **Realtime Fallback:**
   - Change `REALTIME_BACKEND` to `"node"` in the Pages environment configuration.
   - Set `REALTIME_DURABLE_OBJECTS_ENABLED="false"` in the Worker.
   - This routes all collaboration traffic back to the original Node WebSocket server (`src/documents/socket.js`) without degrading auth or metadata APIs.
2. **DNS/Worker Bypass:**
   - If the Worker proxy fails, update DNS records to point directly to the Node backend server origin domain, bypassing the Worker entirely.

---

## Known Risks

- **Isolate Cold Starts:** Initial connection to a Durable Object might experience minor latency due to isolate cold starts.
- **WebSocket Ticket Timeout:** The WS ticket expires in 30 seconds. If connection fails and reconnects, the client must obtain a fresh ticket from Node backend. This is already supported in the client-side `network.js` reconnect loop.
- **Isolate Rate Limiting:** The edge rate limiter uses in-memory Map which resets when the Worker isolate restarts. This is fine for edge protection but does not replace backend rate limiting.

---

## Next Phase

Once the external dashboard configuration and wrangler deployments are completed:

1. Conduct smoke tests verifying user profiles, CSRF validation, and document editing.
2. Monitor production logs (`npm run cf:tail`) for any network or proxy errors.
3. Migrate database and auth fully to Cloudflare (D1, KV, Turnstile) in a future phase.
