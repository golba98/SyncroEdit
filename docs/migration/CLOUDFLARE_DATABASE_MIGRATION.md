# Cloudflare Database Migration Decision

Mongoose cannot run directly inside Cloudflare Workers. The Worker must not connect directly to
MongoDB with Node driver assumptions, long-lived sockets, or local secret files.

## Options

### 1. Keep MongoDB Behind Node Temporarily

- Lowest risk and current default.
- Preserves existing Mongoose models, auth/session checks, document queries, history, and Yjs state
  persistence.
- Requires the Worker proxy to remain production-safe.
- Recommended for this sprint.

### 2. Move Metadata/Auth/Session State To D1

- Good fit for relational auth/session/document metadata.
- Requires schema design, migrations, and new Worker-owned business logic.
- Does not automatically solve binary Yjs update persistence or email/session flows.
- Future candidate after route ownership and auth boundaries are stable.

### 3. Move To Neon/Postgres

- Good fit if the app wants a managed Postgres data model outside Cloudflare D1 limits.
- Requires replacing Mongoose models and Mongo-shaped document queries.
- Can be accessed from Workers through HTTP/serverless Postgres-compatible patterns, but needs
  careful connection and secret handling.

### 4. Use MongoDB Only Through A Server/API Layer

- Keeps MongoDB while avoiding direct Worker database connections.
- The server layer can be the existing Node backend or a smaller dedicated API service.
- Good transitional architecture if MongoDB remains the preferred datastore.

## Sprint Decision

Keep MongoDB behind Node for this branch. Add only Worker database boundary scaffolding under
`worker/src/db/` and do not add database credentials to Wrangler configuration.
