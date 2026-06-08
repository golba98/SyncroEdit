# SyncroEdit

SyncroEdit is a real-time collaborative document editor built with Node.js, Express,
MongoDB, WebSockets, and Yjs. The frontend is a vanilla JavaScript app served from
`public/`, with feature modules under `public/js/features/`.

## Install

```bash
npm install
```

Copy the local environment template and update values as needed:

```bash
cp .env.example .env
```

At minimum, local development needs:

- `PORT`: local server port, usually `3000`
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: random secret for JWT signing
- `DISABLE_SECURE_COOKIE=true`: required for local HTTP development

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

For production-style startup:

```bash
npm start
```

## Run With Docker

Copy the Docker environment template:

```bash
cp .env.docker.example .env
```

Start the app and MongoDB:

```bash
docker compose up -d
```

Validate the Compose file without starting services:

```bash
docker compose config
```

## Test And Lint

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run lint
```

There is currently no `npm run build` script; the app is served directly by Express.

## Important Files

- Backend: `src/`
- Frontend: `public/`
- Tests: `tests/`
- Config: `config/`
- Documentation: `docs/`
- Scripts: `scripts/`
- Docker: `Dockerfile`, `docker-compose.yml`, `.dockerignore`

See `docs/PROJECT_STRUCTURE.md` for a fuller map of the repository.

## Documentation

- Setup: `docs/setup/SETUP.md`
- Security checklist: `docs/security/SECURITY_CHECKLIST.md`
- Architecture context: `docs/architecture/AI_CONTEXT.md`
- Testing notes: `docs/testing/TESTING.md`
- Cleanup report: `docs/CLEANUP_REPORT.md`
- Archived planning/design material: `docs/archive/`

## Troubleshooting

- If cookies do not work locally, confirm `DISABLE_SECURE_COOKIE=true` in `.env` or use
  `npm run dev`.
- If integration tests cannot download MongoDB binaries, remove `.cache/mongodb-binaries`
  and rerun `npm test`.
- If Docker starts but the app cannot connect to MongoDB, confirm `MONGODB_URI` points to
  `mongodb://mongo:27017/synchroedit` for Compose.
- Do not commit `.env`, logs, local cache folders, generated reports, or secret key files.
