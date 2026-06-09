# Cloudflare Auth Boundary

Node remains the authentication source of truth during this migration sprint.

## Worker Responsibilities

- Proxy auth-sensitive requests to Node.
- Preserve `Authorization`, `Cookie`, `Set-Cookie`, and `X-CSRF-Token` headers.
- Optionally reject obviously invalid or expired RS256 access tokens early only after public-key
  verification support exists.
- Apply optional per-isolate rate limiting when `EDGE_RATE_LIMITING_ENABLED=true`.

## Node Responsibilities

- JWT signing and verification.
- Refresh token rotation and theft detection.
- CSRF token creation and validation.
- Session revocation and MongoDB session checks.
- Password hashing, signup, login, logout, email verification, and password reset.
- WebSocket ticket issuance until the Durable Object realtime migration is complete.

## Current Sprint Boundary

This branch does not move refresh-token rotation, CSRF, session revocation, or Mongo-backed session
checks into the Worker. The Worker may reduce backend load, but Node still makes the authoritative
auth decision.
