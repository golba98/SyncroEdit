# Cloudflare Route Ownership

This map defines which runtime owns each route during the full migration sprint.

## Worker-Owned Routes

- `GET /`
- `GET /api/health`
- `GET /api/config`
- Worker security headers
- Optional Worker edge rate limiting when `EDGE_RATE_LIMITING_ENABLED=true`
- Optional Worker JWT preverification only after RS256/JWKS public verification is available

## Node-Proxied Routes

- `/api/node/*`

The Worker rewrites `/api/node/*` to `/api/*` on the Node backend. These routes remain
Node-owned:

- Auth, refresh-token rotation, logout, CSRF, and WebSocket ticket issuance
- User profile and session APIs
- Document metadata, sharing, history, settings, and ownership APIs
- MongoDB/Mongoose persistence

## Future Worker-Owned Routes

- `GET /ws/:documentId`
- `GET /api/realtime/:documentId`

These routes are guarded by `REALTIME_DURABLE_OBJECTS_ENABLED`. They currently provide a
Durable Object WebSocket broadcast skeleton and are not the default production Yjs path.

## Code Source Of Truth

The code-level ownership map lives in `worker/src/config/routes.js`.
