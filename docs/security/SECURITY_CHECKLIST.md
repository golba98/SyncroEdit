# SyncroEdit Security Checklist

## Runtime Boundary

- Production API routes run in `src-worker/index.js`.
- Static assets are served from `./public` by the Worker assets binding.
- D1 is accessed only through the `DB` binding.
- Durable Object rooms use the `DOCUMENT_SYNC_OBJECT` binding.
- Auth rate limits use the `RATE_LIMIT_OBJECT` binding.

## Secrets

- Do not commit `.dev.vars`, `.env`, API keys, private keys, tokens, or production secrets.
- Configure token signing secrets with `wrangler secret put JWT_SECRET`.
- Keep examples as placeholders only.

## Auth And Sessions

- Access tokens are sent as `Authorization: Bearer ...`.
- Refresh tokens are stored in HttpOnly, Secure, SameSite cookies.
- Server-side session revocation is enforced through D1.
- Do not add CSRF claims unless state-changing cookie-authenticated routes enforce CSRF.

## Verification

Run before shipping security-sensitive changes:

```bash
npm run lint
npm run test:unit
npm run test:integration
npm audit
```
