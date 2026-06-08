# Cloudflare Migration: Phase 3A - Worker Foundation & Simple Routes

This document details the tasks completed in Phase 3A of the Cloudflare migration, the current architecture state, and instructions for running and testing the Worker locally.

## What Was Added in Phase 3A

We established a modular, clean directory structure for the Cloudflare Worker API under `worker/src/`:

1. **Worker Entrypoint (`worker/src/index.js`):**
   * Configures Hono routing.
   * Registers global middleware (security headers, CORS).
   * Defines standard root route (`GET /`).
   * Configures a custom `notFound` JSON fallback handler.

2. **Endpoints:**
   * **`GET /` (Kept):** Returns a welcome message.
   * **`GET /api/health` (Kept):** Returns worker health status.
   * **`GET /api/config` (Added):** Returns safe, non-sensitive public environment details (`appName`, `environment`, `apiVersion`, and `workerRuntime`).

3. **Global Security Headers Middleware (`worker/src/middleware/securityHeaders.js`):**
   * Automatically sets the following HTTP response headers for all requests:
     * `X-Content-Type-Options: nosniff`
     * `Referrer-Policy: no-referrer`
     * `X-Frame-Options: DENY`
     * `Permissions-Policy: geolocation=(), microphone=(), camera=()`

4. **JSON Response Helpers (`worker/src/utils/responses.js`):**
   * `successResponse(c, data, status)`
   * `errorResponse(c, message, status)`
   * `notFoundResponse(c, message)`

5. **Wrangler Configuration (`worker/wrangler.toml`):**
   * Configured the `[vars]` block with safe public values.
   * Avoided adding any secrets, keys, or internal environment values to prevent leaks.

---

## What Remains on Node.js

To minimize risk and ensure stability, we did not migrate any stateful or complex operations in this phase. The following systems remain running exclusively on the Node.js Express server:

* **Authentication & JWT Verification:** Password hashing, two-factor authentication, and JWT signing/verification.
* **Database & Persistence:** All MongoDB / Mongoose operations.
* **Real-time Collaboration:** Yjs document synchronization and WebSockets (`ws` protocol).
* **Sessions & Cookies:** Express sessions, CSRF protection, and cookies.
* **Email Delivery:** SMTP and Resend configurations.

### Why Auth, Database, and Realtime Were Intentionally Not Migrated

Migrating stateful or real-time components (such as database connections or WebSockets) requires careful handling of persistent connections, connection pools, and real-time state sync (e.g., using Cloudflare Durable Objects, Hyperdrive, or proxy services). By delaying these migrations, we can isolate and fully verify the worker's routing foundation, CORS logic, and security headers without introducing complexities related to cold starts, connection limit thresholds, or CRDT synchronization.

---

## How to Run the Worker Locally

From the project root directory, run:

```bash
npm run cf:dev
```

This commands executes `wrangler dev` in the `worker/` directory, exposing the worker on `http://localhost:8787/`.

---

## How to Test Endpoints

You can verify the responses and headers using `curl -i`:

1. **Test Root Endpoint (`GET /`):**
   ```bash
   curl -i http://localhost:8787/
   ```

2. **Test Health Endpoint (`GET /api/health`):**
   ```bash
   curl -i http://localhost:8787/api/health
   ```

3. **Test Config Endpoint (`GET /api/config`):**
   ```bash
   curl -i http://localhost:8787/api/config
   ```

4. **Test Unknown Route (404 Fallback):**
   ```bash
   curl -i http://localhost:8787/does-not-exist
   ```

---

## Next Recommended Phase

**Phase 3B: Session, Auth Middleware, and Safe API proxying.**
In the next phase, we recommend:
1. Replicating the JWT validation logic inside a custom Hono middleware to decode and verify JWTs at the edge.
2. Formulating the proxy layer to forward write/read requests to the existing Node.js/MongoDB cluster backend for endpoints requiring database access.
