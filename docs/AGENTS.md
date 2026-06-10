# Repository Guidelines

## Project Structure & Module Organization

`src-worker/` contains the Cloudflare Worker, auth helpers, validation/security helpers, and Durable Object classes. Browser code and static assets live in `public/`: client modules are under `public/js/`, styles in `public/css/`, pages in `public/pages/`, and vendored Font Awesome assets in `public/vendor/`. D1 migrations live in `migrations/`. Tests are split across `tests/unit`, `tests/integration`, `tests/frontend`, and `tests/e2e`.

## Build, Test, and Development Commands

Note: There is no `npm run build` script. Static assets are served directly from the `public/` directory by Cloudflare.

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev` / `npm start`: run the Worker locally with Wrangler.
- `npm run deploy` / `npx wrangler deploy --config wrangler.toml`: deploy the Worker and static assets to Cloudflare.
- `npm run db:migrate:local`: apply D1 migrations locally.
- `npm run db:migrate:remote`: apply D1 migrations remotely.
- `npm test`: run all unit, integration, and frontend Jest suites.
- `npm run test:unit`: run Worker unit tests.
- `npm run test:integration`: run Worker integration/security tests.
- `npm run test:e2e`: run Playwright tests using `config/playwright.config.js`.
- `npm run lint`: run ESLint.
- `npm run format`: apply Prettier formatting repo-wide.

## Security & Configuration Tips

Do not commit secrets or local `.env` files. Configure production secrets with Wrangler. Keep production assumptions Cloudflare-native: Worker routes, D1, Durable Objects, and static assets from `./public`.
