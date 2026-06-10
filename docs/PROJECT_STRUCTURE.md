# Project Structure

This file explains where project files belong and what should not be committed.

## Top-Level Files

- `package.json` and `package-lock.json`: Node dependencies and npm scripts.
- `README.md`: practical setup and run instructions.
- `SECURITY.md`: public vulnerability reporting policy.
- `.env.example`: local Worker secret template guidance.
- `config/`: tool configuration that does not need to live at the root.

## Source Code

- `src-worker/`: Cloudflare Worker and Durable Object backend.
  - `index.js`: Hono routes for auth, users, documents, config, and WebSocket routing.
  - `auth.js`: Worker-compatible password hashing and token/session helpers.
  - `syncObject.js`: Durable Object realtime document rooms.
  - `security.js`: validation, env binding guards, CORS, and security headers.
- `public/`: browser app and static assets.
  - `public/index.html`: main app shell.
  - `public/pages/`: login, verification, and password reset pages.
  - `public/css/`: app styles.
  - `public/js/app/`: app entrypoint, network helpers, and shared frontend utilities.
  - `public/js/features/`: feature modules for auth, editor, profile, theme, library, and UI.
  - `public/js/vendor/`: vendored browser modules used by import maps.
  - `public/vendor/`: vendored third-party assets such as Font Awesome.

## Tests

- `tests/unit/`: isolated backend and frontend unit tests.
- `tests/integration/`: API, database, auth, security, sharing, and socket integration tests.
- `tests/frontend/`: jsdom-based frontend tests.
- `tests/e2e/`: Playwright browser flows.
- `tests/mocks/`: test doubles shared by multiple suites.
- `tests/setup.js` and `tests/env.js`: shared Jest setup.

## Documentation

- `docs/setup/`: setup and development environment docs.
- `docs/security/`: security checklist and security implementation notes.
- `docs/architecture/`: architecture context and performance notes.
- `docs/testing/`: test-running guidance.
- `docs/design/`: design explorations that are still worth keeping.

## Scripts

- `scripts/dev/`: local development launch helpers.

## Do Not Commit

- `.env`, `.env.local`, `.env.*.local`, or real secrets.
- JWT private keys, PEM files, or generated key material.
- `node_modules/`, `.cache/`, coverage, Playwright reports, and test results.
- Runtime logs under `logs/`.
- OS/editor junk such as `.DS_Store`, `Thumbs.db`, `.idea/`, and `.vscode/`.
- Local agent files that are not part of the project documentation.
