# Production environment

Origin is `golba98/SyncroEdit`. The Worker remains `syncroedit`, serving `syncroedit.online`, with
D1 `synchroedit-db` (`22d0142f-5997-4622-bd2d-33eab48beeea`). Live bindings remain
`DocumentSyncObject` / `RateLimitObject`; all four historical compatibility exports remain declared.
No Durable Object rename, namespace deletion, D1 reset, or live migration is part of restructuring.
The custom domain is managed in Cloudflare and was inspected without modification.

Production secrets stay on the existing Worker: `JWT_SECRET`, `EMAIL_CODE_PEPPER`, `RESEND_API_KEY`.
No development secrets or data were copied here. Browser tests use explicit test-only values and a
separate local Worker (`syncroedit-production-local`) with zero-ID emulated D1.

There are no production-deploying GitHub workflows. Production deployment is the owner's explicit
local exact-SHA command, after reviewed promotion and CI. Cloudflare Workers Builds must also be
disconnected; repository workflows cannot neutralize an independent dashboard deployment trigger.
