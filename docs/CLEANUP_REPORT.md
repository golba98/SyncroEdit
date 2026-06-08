# SyncroEdit Cleanup Report

This report records the cleanup classifications made before reorganizing files on the
`cleanup/reorganize-syncroedit-files` branch.

## Keep

- Root project files: `package.json`, `package-lock.json`, `README.md`, `SECURITY.md`,
  `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `.env.example`,
  `.env.docker.example`.
  These are active project, package, security, Docker, and environment template files.
- `src/`, `tests/`, `config/`, `.github/`.
  These contain active backend code, test suites, tool configuration, and repository
  automation metadata.
- Active frontend files under `public/index.html`, `public/css/`, `public/js/app/`,
  `public/js/features/`, `public/js/vendor/y-websocket.js`, `public/logo.svg`,
  `public/favicon.ico`, `public/manifest.json`, `public/sw.js`, and active auth pages.
  These are referenced by the app entrypoint, service worker, tests, or served pages.
- `public/vendor/fontawesome/`.
  The app imports `/vendor/fontawesome/css/all.min.css`; the vendored package is kept
  intact to avoid breaking icon/font references.

## Move

- `docs/SETUP.md` to `docs/setup/SETUP.md`.
  Setup docs are active but belong in a setup-focused docs folder.
- `docs/SECURITY_CHECKLIST.md` to `docs/security/SECURITY_CHECKLIST.md`.
  Security checklist remains useful and should stay separate from general docs.
- `docs/AI_CONTEXT.md` to `docs/architecture/AI_CONTEXT.md`.
  It describes app architecture and development context.
- `docs/PERFORMANCE.md` to `docs/architecture/PERFORMANCE.md`.
  It is an architectural/performance planning document.
- `docs/logo-redesign.html` to `docs/design/logo-redesign.html`.
  The design reference is useful, but it belongs with design material rather than root docs.
- Script helpers into `scripts/dev/`, `scripts/test/`, and `scripts/maintenance/`
  based on whether they start the app, create test data, or perform diagnostics.

## Rename

- No source files require behavior-preserving renames beyond documentation placement.
  Active frontend module names are already consistent under `public/js/app/` and
  `public/js/features/`.

## Archive

- `EYE_TRACKING_FIX.md`.
  Historical fix note for an old eye-tracking debug page.
- `docs/ARCHIVE_page.md`.
  Old page-management design notes, already marked as archive material.
- `docs/FILE_REORGANIZATION.md`.
  Historical summary of an earlier reorganization.
- `public/brand/*`.
  Logo experiment artifacts that are not imported by the active app; active branding uses
  `public/logo.svg`.
- `public/pages/test-eye-tracking.html`.
  Standalone test page referenced only by historical notes.

## Delete

- `public/js/core/app.js`, `public/js/managers/LibraryManager.js`,
  `public/js/ui/profile.js`.
  These are stale duplicate frontend modules pointing at old `/js/core`, `/js/ui`, and
  `/js/managers` paths. The active app entrypoint is `public/js/app/app.js`, and tests
  target the `public/js/features/` modules.
- Generated logs and test output: `logs/*.log`, `test-results/`.
  These are runtime/test artifacts and are ignored by `.gitignore`.
- `.vscode/settings.json`.
  Local editor configuration should not be committed.
- Empty directories left after the above moves/deletions.

## Needs Manual Review

- Local `.env`.
  It is ignored and may contain secrets; cleanup must not inspect, move, or commit it.
- The unmerged `security/audit-and-hardening` branch.
  This cleanup branch intentionally starts from current local `main`, so that security
  branch remains outside this cleanup scope.
- Future Font Awesome migration.
  Replacing the vendored package with an npm dependency is broader than this cleanup.
