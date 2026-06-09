# Cloudflare Full Migration Sprint

This sprint moves SyncroEdit from preparation to implementation while preserving the working Node
backend.

## Implemented

- Worker route ownership map in `worker/src/config/routes.js`.
- Production-safe `/api/node/*` proxy boundary with local-only backend fallback.
- Feature flags:
  - `REALTIME_DURABLE_OBJECTS_ENABLED=false`
  - `EDGE_RATE_LIMITING_ENABLED=false`
- Durable Object binding and migration for `DocumentSyncObject`.
- Feature-flagged WebSocket endpoints:
  - `GET /ws/:documentId`
  - `GET /api/realtime/:documentId`
- Per-isolate Worker rate-limit foundation for strict, auth-sensitive, and default route groups.
- Frontend runtime config examples for local and production Cloudflare routing.
- Database and auth boundary documentation.

## Still Node-Owned

- Auth, CSRF, refresh tokens, session revocation, and WebSocket ticket issuance.
- MongoDB/Mongoose persistence.
- Document metadata, history, sharing, settings, and ownership APIs.
- Production Yjs collaboration protocol and persistence.

## Local Node And Worker

Run Node:

```bash
npm run dev
```

Run Worker:

```bash
npm run cf:dev
```

The local Worker uses `BACKEND_ORIGIN=http://localhost:3000`. Production-like environments must set
`BACKEND_ORIGIN` explicitly to the HTTPS origin of the Node backend while Node remains the fallback.

## Proxy Checks

```bash
curl -i http://localhost:8787/
curl -i http://localhost:8787/api/health
curl -i http://localhost:8787/api/config
curl -i http://localhost:8787/api/node/auth/csrf-token
curl -i http://localhost:8787/api/node/user/profile
```

Expected unauthenticated `/api/node/user/profile` behavior is a Node-generated auth error returned
through the Worker proxy.

## Durable Object Skeleton Check

The Durable Object route is disabled by default. To test locally, temporarily set
`REALTIME_DURABLE_OBJECTS_ENABLED="true"` for `wrangler dev`, then connect two WebSocket clients:

```bash
npx wscat -c ws://localhost:8787/ws/test-document
```

Messages sent by one client should be broadcast to the other client. This skeleton is not yet a full
`y-websocket` protocol implementation.

## Deploy

Deploy Pages:

```bash
npm run pages:deploy
```

Deploy Worker:

```bash
npm run cf:deploy
```

Production Worker variables required while Node remains fallback:

- `ENVIRONMENT=production`
- `BACKEND_ORIGIN=https://<node-backend-origin>`
- `REALTIME_DURABLE_OBJECTS_ENABLED=false` until the DO path is protocol-compatible
- `EDGE_RATE_LIMITING_ENABLED=false` until the per-isolate limiter is intentionally enabled

Do not configure JWT secrets, private keys, MongoDB URIs, CSRF secrets, email credentials, or local
secret files in `worker/wrangler.toml`.

## Rollback

- Disable Worker routing rules and route `/api/*` traffic back to Node.
- Keep `REALTIME_DURABLE_OBJECTS_ENABLED=false`.
- Keep frontend `API_BASE_URL` and `WS_BASE_URL` same-origin or pointed at Node.
- Re-deploy the previous Worker if needed with `cf:deploy` from the last stable commit.

## Next Phase Checklist

- Implement y-websocket protocol compatibility inside `DocumentSyncObject`.
- Add auth handoff for Durable Object upgrades using Node-issued WS tickets.
- Decide D1 vs Postgres vs API-backed MongoDB for document metadata.
- Add global production rate limiting backed by Durable Objects, KV, or D1.
- Add optional RS256/JWKS Worker preverification after Node emits RS256 access tokens.
