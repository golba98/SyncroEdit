# Copilot Instructions for SyncroEdit

## Commands

- `npm run dev`: start Wrangler locally.
- `npm start`: alias for Wrangler local start.
- `npm test`: run unit and integration suites.
- `npm run test:unit`: run Worker unit tests.
- `npm run test:integration`: run Worker integration/security tests.
- `npm run test:e2e`: run Playwright against the local Worker.
- `npm run lint`: run ESLint.
- `npm run format`: run Prettier.

## Architecture

SyncroEdit is Cloudflare-native:

- `src-worker/index.js`: Hono Worker routes for API, auth, profile, document, and WebSocket routing.
- `src-worker/auth.js`: Web Crypto password hashing and D1-backed session/token helpers.
- `src-worker/security.js`: validation, binding checks, CORS, and security headers.
- `src-worker/syncObject.js`: Durable Object realtime rooms backed by D1.
- `src-worker/rateLimitObject.js`: Durable Object auth abuse counters.
- `public/`: static browser app and assets served by Wrangler.
- `migrations/`: D1 schema migrations.

## Security Notes

- Use D1 only through the `DB` binding.
- Use Durable Objects for realtime rooms and auth rate limits.
- Configure token signing with `wrangler secret put JWT_SECRET`.
- Do not add local secrets, proxy origins, or alternate production backends.
- Access tokens are sent in `Authorization` headers; refresh tokens are HttpOnly cookies.
- Do not claim CSRF protection unless it is enforced on state-changing cookie-auth routes.

## Tests

- Add Worker route/security tests under `tests/unit` or `tests/integration`.
- Use `tests/mockD1.js` for API tests.
- For browser behavior, use `tests/frontend` or `tests/e2e`.
