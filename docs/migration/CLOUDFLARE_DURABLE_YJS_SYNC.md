# Cloudflare Durable Object Yjs Sync Migration

This document details the implementation of full Yjs/y-websocket protocol compatibility and state persistence within the Cloudflare Durable Object realtime backend, along with the ticket validation bridge on the Node backend.

## Implemented Features

### 1. Durable Object Yjs Sync Protocol
- **Single Instance Y.Doc & Awareness**: Inside `DocumentSyncObject`, a single `Y.Doc` and `Awareness` instance are maintained for each active document room.
- **WebSocket Upgrade Handling**: Correctly accepts the connection and immediately sends Yjs sync step 1 (server state vector) and the current awareness states of all other connected clients.
- **y-websocket Protocol Support**: Supports `messageSync = 0` and `messageAwareness = 1` binary payload structures.
- **Read-Only Enforcement**: Automatically blocks sync updates (Step 2/Update) from connections flagged as read-only.
- **Connection Cleanups**: Cleans up client awareness state on disconnect and broadcasts the state removal to remaining clients.
- **DO Storage Persistence**: Encodes document state as compacted updates (`Y.encodeStateAsUpdate`) and persists it to Durable Object SQLite storage. State writes are debounced (2-second buffer) and immediately flushed on the last client's disconnect.

### 2. Node Backend Ticket Consumption Bridge
- Added `POST /api/auth/ws-ticket/consume` route.
- Bypasses global CSRF protection specifically for this bridge path.
- Consumes and validates the Node-issued WebSocket ticket.
- Verifies document permissions (owner/collaborator/viewer/public) and determines the read-only flag before returning a clean JSON structure to the Worker: `{ ok: true, user: { id, username }, readOnly }`.

### 3. Frontend Config Backend Resolution
- Added `REALTIME_BACKEND` option to `public/config.js` (and local/production examples), defaulting to `"node"`.
- Frontend `editor.js` checks this configuration option. When set to `"durable-object"`, it targets the Worker WebSocket route `/ws/:documentId`.

---

## What Remains Node-Owned

- Primary document REST APIs (creation, history, settings, deletion).
- Primary user authentication, session state, token signing, and WS ticket generation.
- MongoDB document state database persistence (used as the primary database while Durable Object SQLite storage functions as a real-time hot cache).

---

## Verification

### Automated Tests
- Written unit tests verifying the Hono routing, mock ticket bridge validation, and Durable Object WebSocket upgrades.
- Verified Yjs multi-client state sync, awareness propagation, read-only protection, and storage persistence.
- Verified CSRF bypass and Node consumption bridge integration tests.
- Run:
  ```bash
  npm run test:unit
  npm run test:integration
  ```
  All tests passed successfully with 0 errors.

### How to Enable Durable Object Realtime Locally

1. Create a local override variable in your Worker local environment or inside `worker/wrangler.toml`:
   ```toml
   [vars]
   REALTIME_DURABLE_OBJECTS_ENABLED = "true"
   ```
2. Enable Durable Object backend in `public/config.js`:
   ```javascript
   window.SYNCROEDIT_CONFIG = {
     API_BASE_URL: 'http://localhost:8787/api/node',
     WS_BASE_URL: 'ws://localhost:8787',
     REALTIME_BACKEND: 'durable-object'
   };
   ```
3. Start the application stack:
   ```bash
   # Terminal 1: MongoDB
   docker start syncroedit-mongo
   
   # Terminal 2: Node backend
   npm run dev
   
   # Terminal 3: Cloudflare Worker
   npm run cf:dev
   ```

---

## Rollback Plan

If issues occur with the Cloudflare Durable Object route:
1. Revert `REALTIME_BACKEND` to `"node"` in the frontend configuration (`public/config.js`).
2. Keep `REALTIME_DURABLE_OBJECTS_ENABLED = "false"` in the wrangler settings/environment variables.
3. Node will instantly serve as the default fallback WebSocket handler, bypassing Worker routing to DO.

## Next Recommended Phase

1. **Production DB Integration**: Build an asynchronous sync bridge from the Worker / Durable Object to Node's MongoDB backend to periodically flush long-term documents to the primary Mongo DB.
2. **Global Edge Rate Limiting**: Enable the rate limit middleware backed by Durable Objects or KV on Cloudflare.
3. **JWT Preverification**: Pre-verify JWT access tokens directly on the edge worker before routing/upgrading.
