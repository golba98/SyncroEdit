# Cloudflare Migration Phase 1

## Goal

Prepare SyncroEdit for a phased migration to Cloudflare Pages and Cloudflare Workers.

## Completed in this phase

- Added a Cloudflare Worker API shell under `worker/`.
- Added a Hono app with `GET /` and `GET /api/health`.
- Added `worker/wrangler.toml`.
- Added npm scripts for Worker dev, Worker deploy, and Pages deploy.

## Not migrated yet

The existing Node.js backend remains the source of truth for now.

Not migrated yet:

- Express routes
- MongoDB / Mongoose models
- Auth/session logic
- Email utilities
- Yjs WebSocket collaboration
- Document persistence
- Durable Objects

## Local Node app

Run the existing app with:

    npm run dev

The app expects MongoDB through `MONGODB_URI`.

For local development, use:

    MONGODB_URI=mongodb://127.0.0.1:27017/synchroedit

## Local Worker API

Run:

    npm run cf:dev

Then test:

    curl http://localhost:8787/
    curl http://localhost:8787/api/health

## Cloudflare Pages frontend deploy

Run:

    npm run pages:deploy

This deploys the existing `public/` directory.

## Later phases

1. Move simple REST routes from Express to Hono.
2. Decide database strategy.
3. Migrate auth carefully.
4. Move Yjs/WebSocket collaboration to Durable Objects.
