# SyncroEdit (Cloudflare-Native)

SyncroEdit is a high-performance, real-time collaborative document editor rebuilt as a **Cloudflare-native backend** with a minimalist "Dark OLED" design. It uses Conflict-free Replicated Data Types (CRDTs) via **Yjs** and WebSockets coordinated by **Durable Objects** to provide zero-conflict, real-time multi-user editing.

---

## Architecture Overview

SyncroEdit is deployed completely on Cloudflare's serverless edge architecture:

```mermaid
graph TD
    Client[Browser Client] -->|HTTP / API| Worker[Cloudflare Worker / Hono]
    Client -->|WebSocket| DO[Durable Object: DocumentSyncObject]
    Worker -->|D1 Binding| D1[(D1 SQLite Database)]
    DO -->|Sync State & Pages| D1
    Worker -->|Assets| CF_Assets[Static Assets /public]
```

- **Cloudflare Worker (Hono):** Handles all HTTP routing, user authentication, profile details, and document CRUD API endpoints.
- **Cloudflare D1:** Acts as the primary SQL relational database (replacing MongoDB) to store users, sessions, documents, and permissions.
- **Durable Objects (`DocumentSyncObject`):** Represents individual document collaboration rooms. Manages WebSocket connections, state vectors, Yjs sync steps, cursor awareness propagation, and debounces state flushes back to D1.
- **Static Assets:** Served directly from the `./public` directory via Wrangler's assets binding.

---

## Tech Stack & Core Libraries

- **Frontend:** Vanilla JavaScript (ES Modules), Quill.js (Rich text editor), Yjs (Sync engine), `y-websocket` (WebSocket provider).
- **Backend Worker:** Hono Router, Web Crypto APIs for JWT/password hashing, Durable Objects.
- **Database:** Cloudflare D1 (SQLite).

---

## Required Cloudflare Bindings & Secrets

To run SyncroEdit in production, configure the following bindings in your Cloudflare dashboard or `wrangler.toml`:

### Bindings
1. **D1 Database:** Bind a D1 database to `DB`.
2. **Durable Objects:** Bind the class `DocumentSyncObject` to `DOCUMENT_SYNC_OBJECT`.

### Secrets
Set the following secret using wrangler CLI:
```bash
wrangler secret put JWT_SECRET
```
*Note: `JWT_SECRET` is used for signing/verifying session access tokens and short-lived WebSocket connection tickets.*

---

## Development Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Apply Database Migrations (Local)
Create the local SQLite database and apply the schema:
```bash
npm run db:migrate:local
```

### 3. Start Local Development Server
Launch wrangler's local dev server (which emulates D1 and Durable Objects locally):
```bash
npm run dev
```
Open `http://localhost:8787` in your browser.

---

## CLI Commands

| Command | Description |
|---|---|
| `npm run dev` | Runs the wrangler dev emulator on `http://localhost:8787` |
| `npm run deploy` | Deploys the Worker and static assets to Cloudflare |
| `npm run db:migrate:local` | Applies migrations to the local development D1 database |
| `npm run db:migrate:remote` | Applies migrations to the production remote D1 database |
| `npm run test` | Runs the Jest test suite |
| `npm run lint` | Runs ESLint checker |
| `npm run format` | Standardizes codebase formatting via Prettier |

---

## Testing

The tests run using Jest and Hono's lightweight request testing harness combined with a stateful D1 mock database.

To execute tests:
```bash
npm test
```

---

## What Was Removed / Replaced

1. **MongoDB / Mongoose:** Replaced with Cloudflare D1 (relational SQLite database).
2. **Node.js / Express Server:** Replaced with Cloudflare Workers (Hono framework).
3. **Local Tunnel Tunnels / trycloudflare:** Removed completely. Development and production both run direct endpoints.
4. **Hybrid Proxy Config:** Removed all Worker-to-Node proxy routes. The worker now directly handles all API routes.
5. **Old test files:** Archival copy of old MongoDB/Express integration and unit tests moved to `tests/archive/`.

---

## Follow-up / Future Work

- **Turnstile Integration:** Optionally integrate Cloudflare Turnstile on the signup/login pages for DDoS protection.
- **Document Exporter:** Add export to PDF/Docx directly using Worker-compatible libraries if needed in the future.
