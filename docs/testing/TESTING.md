# Testing

Use the npm scripts in `package.json`:

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run lint
```

Jest uses `tests/env.js` and `tests/setup.js` for shared environment setup. Integration
tests use `mongodb-memory-server`; its binary cache is stored under
`.cache/mongodb-binaries` so tests do not need to write into a user home directory.

Playwright tests use `config/playwright.config.js` and start the app through
`tests/e2e/start-server.js`.
