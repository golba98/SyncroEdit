Read `config/environment.json` and `docs/DELIVERY.md` first. All new work starts in development. Never deploy production as part of routine development or use raw remote migration commands.

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

- `src-worker/index.js`: stable Worker and Durable Object export entrypoint.
- `src-worker/app.js`: Hono composition, middleware, route dependencies, health, and public config.
- `src-worker/routes/`: auth, profile, document, and WebSocket route registration by domain.
- `src-worker/auth.js`: Web Crypto password hashing and D1-backed session/token helpers.
- `src-worker/security.js`: validation, binding checks, CORS, and security headers.
- `src-worker/syncObject.js`: Durable Object realtime rooms backed by D1.
- `src-worker/rateLimitObject.js`: Durable Object auth abuse counters.
- `public/`: static browser app and assets served by Wrangler.
- `migrations/`: D1 schema migrations.

Read `docs/DOCUMENTATION.md` for the overview, `docs/ARCHITECTURE.md` for system behavior,
`docs/PROJECT_STRUCTURE.md` for file relationships, and `docs/FILE_REFERENCE.md` for the purpose
and ownership of every retained first-party file.

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
