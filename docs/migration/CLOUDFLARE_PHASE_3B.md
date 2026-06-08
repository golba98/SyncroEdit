# Cloudflare Migration: Phase 3B - Safe Worker Proxy Foundation & Auth Strategy

This document details the tasks completed in Phase 3B of the Cloudflare migration, the authentication/session strategy, local testing instructions, and future deployment considerations.

## What Was Added in Phase 3B

We introduced a secure and transparent API proxy foundation inside the Cloudflare Worker to route requests to the Node.js/Express backend while keeping standard health and config routes Worker-owned.

1. **Proxy Endpoint (`worker/src/routes/proxy.js`):**
   - Configured `app.all('/api/node/*', handleProxy)` to capture all requests destined for the backend.
   - Rewrites routes from `/api/node/subpath` to `/api/subpath` (e.g., `/api/node/user/profile` becomes `/api/user/profile` on the target backend).
   - Proxies HTTP methods, headers, cookies, query parameters, and raw request bodies for non-GET/HEAD requests (`POST`, `PUT`, `PATCH`, `DELETE`).
   - Protects client-side UX by returning a clean `502 Bad Gateway` JSON error on backend connection failures, hiding internal network exception stack traces.

2. **Header & Cookie Preservation (`worker/src/utils/proxy.js`):**
   - Standardizes header filtering by stripping connection-specific hop-by-hop headers (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `host`).
   - Preserves session state by passing along auth tokens, cookies, and custom security headers (e.g., `X-CSRF-Token`).
   - **Careful Set-Cookie Handling:** Multiple `Set-Cookie` headers are preserved individually using V8's `Headers.prototype.getSetCookie()` and `Headers.prototype.append()`. They are never collapsed or joined into a single comma-joined header, preventing browser cookie parsing failures.

3. **Safe Variable Configuration (`worker/wrangler.toml` & `worker/src/config/env.js`):**
   - Exposed `BACKEND_ORIGIN = "http://localhost:3000"` inside the `[vars]` block of `wrangler.toml` for local development.
   - Created a config helper to dynamically read and sanitize `BACKEND_ORIGIN` from Hono's environment context.
   - Left sensitive credentials (e.g., `JWT_SECRET`, `MONGODB_URI`, `CSRF_SECRET`, database/SMTP credentials) entirely on the Node/Express backend. No secrets are stored in wrangler configurations.

---

## Auth & Session Migration Strategy

Full authentication migration has been intentionally delayed in this phase to maintain the Node.js backend as the single source of truth and reduce architectural risk.

### Current State:

- **Node Backend Responsibilities:** JWT signing/generation, CSRF token creation/validation, Express-session lifecycle, email verification, database persistence (user records and active sessions).
- **Worker Proxy Responsibilities:** Edge proxying only. The Worker does not evaluate JWT signatures or validate CSRF tokens yet. It forwards all incoming headers and cookies to the backend, which performs all validation.

### Edge Authentication Strategy (Future Phases):

- **Access Token Verification at the Edge:** Verify JWT access tokens directly on the Worker before hitting the proxy. This rejects unauthorized requests early, saving backend server bandwidth.
- **Stateless Token/Session Validation:** Use Cloudflare KV or D1 to replicate active session storage so the Worker can inspect or invalidate session IDs at the edge.
- **CSRF Token Handling:** Introduce double-cookie submit or origin validation at the edge once routing is fully owned by Cloudflare Workers.

---

## Known Cookie, CORS, and SameSite Issues

Deploying a decoupled frontend (e.g. Cloudflare Pages) and backend (e.g. Cloudflare Workers API) across different domains presents significant cookie and CORS challenges:

1. **Cross-Origin Cookie Restrictions (SameSite):**
   - If the client frontend is hosted on `https://syncroedit.pages.dev` and the API runs on `https://syncroedit-api.workers.dev`, browsers treat requests as cross-origin.
   - Set-Cookie headers require `SameSite=None; Secure`. However, modern browsers (Chrome's third-party cookie restrictions, Safari's Intelligent Tracking Prevention) block cross-site cookies by default.
2. **CORS Preflight Overhead:**
   - Cross-origin requests trigger CORS preflight `OPTIONS` requests, increasing latency.

### Mitigations for Production Deployment:

- **Custom Domain Routing (Recommended):** Route all traffic through a single custom domain (e.g. `syncroedit.com`).
  - Serve the frontend (Pages) from the root domain `syncroedit.com`.
  - Route `/api/*` to the Worker using Cloudflare Rules/Routes.
  - This merges them into a single origin. SameSite can be set to `Lax` or `Strict` and CORS preflight requests are avoided entirely.
- **Unified Subdomains:** Alternatively, use `client.syncroedit.com` and `api.syncroedit.com`. Set cookie `Domain=.syncroedit.com` and `SameSite=Lax`.

---

## What Remains on Node.js

The following operations remain fully on Node:

- Database operations (Mongoose/MongoDB).
- Yjs WebSocket synchronization and ticket-based socket authentication.
- Session creation, database session storage, and JWT token signing.
- SMTP Email verification/sending.

---

## How to Run Node and Worker Together Locally

1. **Start the Node.js Backend:**

   ```bash
   npm run dev
   ```

   - Runs the backend on `http://localhost:3000`.

2. **Start the Cloudflare Worker:**
   ```bash
   npm run cf:dev
   ```

   - Runs the Worker on `http://localhost:8787` and loads variables from `wrangler.toml`.
   - **Note:** `BACKEND_ORIGIN` is configured as `http://localhost:3000` inside wrangler.toml. This is local-only; in production, it must be updated to the public HTTPS domain of the Node backend.

---

## How to Test the Proxy Route

Open a terminal and verify endpoints using `curl -i`:

1. **Verify Worker Health and Configuration (Worker-owned, not proxied):**

   ```bash
   curl -i http://localhost:8787/api/health
   curl -i http://localhost:8787/api/config
   ```

2. **Test Proxied CSRF Token Endpoint:**

   ```bash
   curl -i http://localhost:8787/api/node/auth/csrf-token
   ```

   - **Expected Response:** `200 OK` containing a JSON object with a CSRF token.
   - **Validation:** Verify that `Set-Cookie` headers for `ps-csrf-secret` are returned from the response.

3. **Test Proxied User Profile Endpoint (Requires Auth):**
   ```bash
   curl -i http://localhost:8787/api/node/user/profile
   ```

   - **Expected Response:** `401 Unauthorized` containing a JSON error message from the Node auth middleware.
   - **Validation:** This confirms that the Worker proxy correctly forwards the request to the Node backend, invokes the Node auth middleware, and returns the correct response status.

---

## Next Recommended Phase

**Phase 3C: Edge JWT Verification.**
In the next phase, we recommend:

1. Replicating JWT decoding/verification inside a Hono middleware on the Worker.
2. Intercepting requests and rejecting expired/invalid tokens at the edge without querying the backend.
