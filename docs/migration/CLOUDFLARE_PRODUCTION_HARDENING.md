# Cloudflare Production Hardening

This document outlines the security, validation, and configuration procedures implemented for the SyncroEdit hybrid Cloudflare deployment.

## Environment Variables & Secrets Management

To maintain security, **no secrets should ever be committed to the repository**. All production secrets must be set via your hosting provider's dashboard or CLI (e.g. `wrangler secret put`).

### Cloudflare Worker Environment Variables

| Variable                           | Type       | Default                 | Description                                                                           |
| ---------------------------------- | ---------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `APP_NAME`                         | Plain Text | `SyncroEdit`            | User-facing application name.                                                         |
| `ENVIRONMENT`                      | Plain Text | `development`           | Deployment environment (e.g., `production`, `development`).                           |
| `API_VERSION`                      | Plain Text | `v1`                    | Version tag for APIs.                                                                 |
| `BACKEND_ORIGIN`                   | Plain Text | `http://localhost:3000` | The origin URL of the Node/MongoDB backend. **Required and validated in production.** |
| `REALTIME_DURABLE_OBJECTS_ENABLED` | Plain Text | `false`                 | Enables/disables Durable Object Yjs realtime paths.                                   |
| `EDGE_RATE_LIMITING_ENABLED`       | Plain Text | `false`                 | Enables/disables rate limiting on the edge.                                           |
| `DO_PERSISTENCE_SYNC_ENABLED`      | Plain Text | `false`                 | Enables/disables Yjs state flushing to the Node backend.                              |
| `DO_SYNC_SECRET`                   | **Secret** | _None_                  | Shared secret token used to authenticate flushes from DO to the Node backend.         |

### Node/MongoDB Backend Environment Variables

| Variable                      | Type       | Default                                 | Description                                                            |
| ----------------------------- | ---------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `PORT`                        | Plain Text | `3000`                                  | Port for the Node server.                                              |
| `NODE_ENV`                    | Plain Text | `development`                           | Environment mode (`production`, `development`, `test`).                |
| `MONGODB_URI`                 | **Secret** | `mongodb://localhost:27017/synchroedit` | Connection URI for the MongoDB database.                               |
| `JWT_SECRET`                  | **Secret** | _None_                                  | Shared HMAC secret key for JWT validation/fallback.                    |
| `JWT_PRIVATE_KEY`             | **Secret** | _None_                                  | RSA Private Key for JWT token signing.                                 |
| `JWT_PUBLIC_KEYS`             | **Secret** | _None_                                  | JSON mapping key ID (`kid`) to RSA Public Keys for token verification. |
| `DO_PERSISTENCE_SYNC_ENABLED` | Plain Text | `false`                                 | Enables/disables the internal POST endpoint for Yjs state flushing.    |
| `DO_SYNC_SECRET`              | **Secret** | _None_                                  | Shared secret token required by the internal POST endpoint.            |

---

## CORS & Cookie/SameSite Assumptions

### Cross-Origin Resource Sharing (CORS)

- **Frontend Pages:** Typically served from a Cloudflare Pages domain (e.g., `https://syncroedit.pages.dev` or a custom domain like `https://syncroedit.com`).
- **Worker & Node backend:** Must share the same custom domain or be configured with strict CORS headers.
- The Worker handles CORS for proxies:
  - Allowed methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`.
  - Allowed headers: `Content-Type`, `Authorization`, `X-CSRF-Token`.
  - Allowed credentials: `include` (essential for cookie preservation).

### Cookie Security & SameSite

- **Secure Flag:** In production (`NODE_ENV=production`), all session and refresh token cookies must have the `Secure` attribute enabled. Locally, `DISABLE_SECURE_COOKIE=true` is used to allow HTTP testing.
- **SameSite Attribute:** Cookies should be set to `SameSite=Lax` or `SameSite=Strict`. Since the Worker proxies `/api/node/*` requests, all API calls are technically same-origin relative to the frontend, which simplifies cookie handling and prevents third-party cookie blocking.
- **HttpOnly:** All authentication/session cookies (e.g. `refreshToken`) must be marked `HttpOnly` to mitigate XSS risks.

---

## Hardening Validation Checklist

1. **Stack Trace Mitigation:**
   - Production Node/Express errors do not leak stack traces or system internals.
   - Worker proxy errors return a generic `502 Bad Gateway` JSON error when the backend is unreachable.
2. **Safe Logging:**
   - No cookie data, `Authorization` headers, CSRF tokens, or raw request/response bodies are printed in the logs.
   - Failures log only general request metadata (method, route, status code).
3. **Internal Route Protection:**
   - The `/api/internal/*` sync bridge endpoint is completely protected by `DO_SYNC_SECRET` and rejected immediately if `DO_PERSISTENCE_SYNC_ENABLED` is false.
