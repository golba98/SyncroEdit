# SyncroEdit File Reference

This is the ownership and retention guide for the repository. Every retained first-party file is
listed individually. Vendored packages and their opaque generated binaries are grouped because
their internal files are maintained upstream rather than edited as SyncroEdit source.

Use this guide when locating behavior, adding tests, or deciding whether a file can be removed. A
file is retained when it is a runtime entrypoint, is reachable from an entrypoint, defines a
deployment or security contract, records migration history, verifies behavior, or documents an
operational requirement.

For an annotated directory tree and dependency flows between these files, read
[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md).

## Repository Root

| File                        | Purpose and ownership                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`              | Documents the names and intended sources of Worker bindings and secrets without containing secret values.                    |
| `.gitignore`                | Excludes dependencies, secrets, Wrangler state, test output, editor files, and other reproducible local artifacts.           |
| `package.json`              | Defines the package metadata, runtime/development dependencies, scripts, and Jest configuration.                             |
| `package-lock.json`         | Pins the complete npm dependency graph for reproducible installs and security review.                                        |
| `wrangler.toml`             | Defines the Worker entrypoint, static assets, D1 databases, Durable Object exports/bindings, and local/staging environments. |
| `README.md`                 | Provides the project overview, setup, commands, production boundary, and operator-facing links.                              |
| `docs/DOCUMENTATION.md`     | Provides the standardized technical overview and directs readers to the detailed guides.                                     |
| `docs/ARCHITECTURE.md`      | Describes system boundaries, routes, authentication, data relationships, realtime flow, and extension rules.                 |
| `docs/PROJECT_STRUCTURE.md` | Explains the annotated repository tree, file relationships, state ownership, and change paths.                               |
| `docs/FILE_REFERENCE.md`    | Lists every retained first-party file and explains why it exists.                                                            |
| `SECURITY.md`               | Defines vulnerability reporting and records the Quill advisory mitigation boundary.                                          |

## Repository Automation and Tooling

| File                              | Purpose and ownership                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `.github/copilot-instructions.md` | Gives GitHub Copilot the current commands, architecture entrypoints, and security constraints. |
| `.github/dependabot.yml`          | Schedules npm and GitHub Actions dependency checks.                                            |
| `config/.babelrc`                 | Configures Babel transformation used by Jest for browser modules.                              |
| `config/.prettierignore`          | Excludes dependencies, generated state, lock data, and vendored bundles from formatting.       |
| `config/.prettierrc`              | Defines the repository-wide source formatting policy.                                          |
| `config/eslint.config.cjs`        | Defines lint targets, runtime/test globals, ignored generated/vendor files, and quality rules. |
| `config/playwright.config.js`     | Defines desktop/mobile browser projects and starts the local Wrangler+D1 test server.          |

## D1 Migration History

Migrations are append-only deployment history. They remain even when later migrations supersede
individual values because existing databases replay the sequence in order.

| File                                                     | Purpose and ownership                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `migrations/0001_schema.sql`                             | Creates users, sessions, documents, pages, permissions, recents, and document-history tables.     |
| `migrations/0002_email_verification_codes.sql`           | Adds canonical email verification timestamps and purpose-bound verification-code storage/indexes. |
| `migrations/0003_backfill_email_verification_mirror.sql` | Synchronizes the legacy verification mirror with the canonical timestamp for existing users.      |

## Cloudflare Worker

| File                              | Purpose and ownership                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src-worker/index.js`             | Stable deployment entrypoint that re-exports the Hono app and historical Durable Object class names.         |
| `src-worker/app.js`               | Composes Hono middleware, dependency injection, error handling, health/config routes, and domain registrars. |
| `src-worker/auth.js`              | Owns password hashing, JWT creation, D1 session validation, authentication, and verified-user guards.        |
| `src-worker/emailVerification.js` | Generates/hashes verification codes and sends purpose-bound email through Resend.                            |
| `src-worker/security.js`          | Centralizes request limits, parsing, validation, CORS, headers, binding checks, and document authorization.  |
| `src-worker/syncObject.js`        | Implements the per-document Durable Object, Yjs synchronization, awareness, permissions, and D1 persistence. |
| `src-worker/rateLimitObject.js`   | Implements durable counters used to limit authentication abuse.                                              |
| `src-worker/routes/auth.js`       | Registers signup, login, logout, token refresh, verification, and WebSocket-ticket endpoints.                |
| `src-worker/routes/user.js`       | Registers profile, password, and session-management endpoints.                                               |
| `src-worker/routes/documents.js`  | Registers document CRUD, settings, recents, transfer, history, and metadata endpoints.                       |
| `src-worker/routes/realtime.js`   | Validates WebSocket tickets/access and forwards upgrades to document Durable Objects.                        |

## Public Platform Files and Pages

| File                                | Purpose and ownership                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `public/index.html`                 | Main editor/library document containing the application shell, import map, toolbar, dialogs, and boot guard. |
| `public/config.js`                  | Supplies same-origin browser runtime defaults before ES modules initialize.                                  |
| `public/sw.js`                      | Implements the versioned offline shell, navigation fallback, and static-asset cache policy.                  |
| `public/logo.svg`                   | Shared favicon and application logo.                                                                         |
| `public/_headers`                   | Applies CSP and browser security headers to Cloudflare-served static assets.                                 |
| `public/.well-known/security.txt`   | Canonical RFC-style security contact published at the well-known path.                                       |
| `public/security.txt`               | Compatibility copy of the security contact for clients that probe the site root.                             |
| `public/pages/login.html`           | Hosts login, signup, and signup-verification panels with the animated auth UI.                               |
| `public/pages/forgot-password.html` | Hosts the email entry step of password recovery.                                                             |
| `public/pages/reset-password.html`  | Hosts reset-token, password, and optional MFA entry.                                                         |
| `public/pages/verify.html`          | Hosts the standalone email-verification code flow.                                                           |

## Stylesheets

Application styles load in the order shown below; changing that order can change the cascade.

| File                                   | Purpose and ownership                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `public/css/app/core.css`              | Defines global variables, layout foundations, controls, Quill font mappings, and shared components. |
| `public/css/app/editor.css`            | Defines document canvas, page, editor, toolbar, responsive editor, and collaboration presentation.  |
| `public/css/app/effects.css`           | Defines themes, loading states, skeletons, animations, notifications, and transient visual effects. |
| `public/css/app/settings.css`          | Defines profile, settings, sharing, history, and modal-specific presentation.                       |
| `public/css/app/responsive.css`        | Provides shared viewport, container, editor, panel, dialog, dashboard, and mobile layout behavior.  |
| `public/css/syncro.css`                | Defines the reusable SyncroBot rig, body parts, state classes, particles, and animations.           |
| `public/css/pages/login.css`           | Defines login/signup layout, validation feedback, verification modal, and auth-page responsiveness. |
| `public/css/pages/auth-mobile.css`     | Defines shared mobile auth sizing, safe-area, keyboard, and compact mascot layout rules.            |
| `public/css/pages/forgot-password.css` | Defines the forgot-password page layout and status presentation.                                    |
| `public/css/pages/reset-password.css`  | Defines reset-password form, requirements, MFA group, and status presentation.                      |
| `public/css/pages/verify.css`          | Defines standalone verification input, actions, and status presentation.                            |
| `public/css/pages/auth-flow.css`       | Defines the shared monochrome forgot-password, reset-password, and verification presentation.       |

## Browser Application Composition and Core Utilities

| File                           | Purpose and ownership                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `public/js/main.js`            | Detects the declared page and lazily loads its single initializer.                                              |
| `public/js/dev-cache-reset.js` | Removes stale SyncroEdit service-worker caches on localhost before page initialization.                         |
| `public/js/app/bootstrap.js`   | Boots the editor page after checking whether the current session may open the application.                      |
| `public/js/app/app.js`         | Owns top-level application lifecycle, feature composition, view state, and document opening.                    |
| `public/js/app/network.js`     | Exposes the feature-oriented API façade used by existing controllers and managers.                              |
| `public/js/app/utils.js`       | Re-exports shared validation/debounce helpers and owns escaping, navigation, conversion, and storage utilities. |
| `public/js/app/Plugin.js`      | Supplies the lifecycle base class used by editor and toolbar plugins.                                           |
| `public/js/core/api.js`        | Implements low-level HTTP calls, refresh retry, WebSocket URL construction, and endpoint helpers.               |
| `public/js/core/config.js`     | Reads browser runtime configuration and builds API/WebSocket URLs safely.                                       |
| `public/js/core/debounce.js`   | Provides the shared trailing debounce primitive.                                                                |
| `public/js/core/errors.js`     | Converts API and email-configuration failures into stable user-facing messages.                                 |
| `public/js/core/validation.js` | Defines shared email and strong-password validation contracts.                                                  |

## Browser Authentication

| File                                              | Purpose and ownership                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `public/js/features/auth/auth.js`                 | Owns in-memory access-token state, refresh, logout, current-user lookup, and verified-user normalization. |
| `public/js/features/auth/pages/login.js`          | Implements login/signup forms, validation, email verification, typo suggestions, and bot interactions.    |
| `public/js/features/auth/pages/forgotPassword.js` | Implements forgot-password submission and its SyncroBot states.                                           |
| `public/js/features/auth/pages/resetPassword.js`  | Implements reset-token/password validation and submission.                                                |
| `public/js/features/auth/pages/verify.js`         | Implements standalone code verification, resend behavior, and post-verification navigation.               |
| `public/js/features/auth/syncro/SyncroBot.js`     | Owns mascot state, eye tracking, idle behavior, focus tracking, and DOM state classes.                    |

## Browser Editor and Feature Modules

| File                                                       | Purpose and ownership                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `public/js/features/editor/editor.js`                      | Coordinates Quill, Yjs, IndexedDB recovery, WebSocket sync, pages, plugins, and editor lifecycle signals. |
| `public/js/features/editor/managers/PageManager.js`        | Owns page creation, sizing, ordering, virtualization, and Yjs page metadata.                              |
| `public/js/features/editor/managers/BorderManager.js`      | Applies and reads document border controls using point-to-pixel conversion.                               |
| `public/js/features/editor/managers/ChatManager.js`        | Owns document-scoped Yjs chat state, safe rendering, unread state, and panel lifecycle.                   |
| `public/js/features/editor/managers/CursorManager.js`      | Renders and removes remote collaborator cursor/selection markers.                                         |
| `public/js/features/editor/managers/ImageManager.js`       | Owns image insertion, selection, resize handles, and image interaction cleanup.                           |
| `public/js/features/editor/managers/NavigationManager.js`  | Synchronizes page navigation controls with the active editor page.                                        |
| `public/js/features/editor/managers/ReadabilityManager.js` | Calculates and presents text readability metrics.                                                         |
| `public/js/features/editor/managers/SearchManager.js`      | Implements find/replace, match navigation, escaping, highlighting, and cleanup.                           |
| `public/js/features/editor/managers/SelectionManager.js`   | Tracks native/Quill selection state and restores formatting targets safely.                               |
| `public/js/features/library/LibraryManager.js`             | Loads, renders, filters, opens, creates, and deletes document-library entries.                            |
| `public/js/features/profile/profile.js`                    | Owns profile editing, avatars, verification, password updates, sessions, and preferences.                 |
| `public/js/features/theme/background.js`                   | Renders the dynamic background and reacts to theme changes.                                               |
| `public/js/features/theme/theme.js`                        | Persists and applies light/dark theme state and accent selections.                                        |
| `public/js/features/ui/ui.js`                              | Provides small shared UI renderers such as notices, collaborators, and escaped content.                   |
| `public/js/features/ui/UIManager.js`                       | Coordinates application controls, modal/view state, document-open status, and global listeners.           |
| `public/js/features/ui/ResponsiveLayoutController.js`      | Adapts editor presentation, responsive breakpoints, ribbon priority overflow, and viewport state.         |
| `public/js/features/ui/ToolbarController.js`               | Connects toolbar controls to Quill formats and editor plugins.                                            |
| `public/js/security/quillSanitizer.js`                     | Sanitizes untrusted Quill HTML/URLs and converts safe markup into Delta content.                          |
| `public/js/vendor/y-websocket.js`                          | Checked-in browser bundle of the Yjs WebSocket provider selected by the import map.                       |

## Vendored Runtime Packages

These files are runtime dependencies served directly because the project has no frontend build
step. Keep package licences and every binary referenced by the package CSS/import wrapper.

| Package path                  | Purpose and retention rule                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `public/vendor/dompurify/`    | Browser DOMPurify ES module used at Quill trust boundaries.                                       |
| `public/vendor/fontawesome/`  | Minified icon CSS, licence, and the regular/solid WOFF2 files used by application icon classes.   |
| `public/vendor/fonts/google/` | Font-face stylesheet plus 285 WOFF2 subsets backing every font exposed by the editor font picker. |
| `public/vendor/highlight.js/` | Syntax highlighter and theme used by Quill code blocks.                                           |
| `public/vendor/idb-keyval/`   | Browser ES module used for local Yjs snapshot recovery.                                           |
| `public/vendor/quill/`        | Quill runtime, Snow theme, and upstream licence notice.                                           |
| `public/vendor/yjs/`          | Yjs wrapper, browser bundle, and process shim selected by the import map.                         |
| `public/vendor/y-quill/`      | Yjs-to-Quill binding wrapper and browser bundle selected by the import map.                       |

## Test Infrastructure and Suites

| File                                                            | Purpose and ownership                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tests/env.js`                                                  | Installs deterministic environment values before Jest modules load.                                  |
| `tests/setup.js`                                                | Installs shared Jest/browser mocks and post-environment setup.                                       |
| `tests/mockD1.js`                                               | Implements the stateful D1 test double used by Worker route suites.                                  |
| `tests/mocks/emptyModule.js`                                    | Replaces browser-only packages in Jest tests that do not exercise those bundles.                     |
| `tests/unit/emailVerification.test.js`                          | Verifies verification-code generation properties.                                                    |
| `tests/unit/worker.test.js`                                     | Covers Worker API, auth, permissions, sessions, validation, and Durable Object contracts.            |
| `tests/unit/wranglerConfig.test.js`                             | Validates every `wrangler.toml` environment and keeps staging DO exports in parity with production.  |
| `tests/integration/security.test.js`                            | Exercises security headers, CORS, malformed input, and integration error behavior.                   |
| `tests/e2e/collaboration.test.js`                               | Proves two independent users share live document edits, chat, and persisted reconnect state.         |
| `tests/frontend/app/app.test.js`                                | Verifies application composition, authentication gates, navigation, and document lifecycle behavior. |
| `tests/frontend/app/assets.test.js`                             | Verifies asset references, precache entries, retired paths, and this file-reference inventory.       |
| `tests/frontend/app/document-open.test.js`                      | Verifies document-open lifecycle ordering and stale/failed open protection.                          |
| `tests/frontend/app/network.test.js`                            | Verifies API façade requests and error propagation.                                                  |
| `tests/frontend/app/sw.test.js`                                 | Verifies service-worker installation, cache versioning, activation, and fetch strategies.            |
| `tests/frontend/app/verification.test.js`                       | Verifies unverified-user dashboard and profile verification behavior.                                |
| `tests/frontend/features/auth/auth.test.js`                     | Verifies canonical user verification-state normalization.                                            |
| `tests/frontend/features/auth/authController.test.js`           | Verifies safe auth DOM rendering, validation, and signup error messages.                             |
| `tests/frontend/features/auth/syncroBot.test.js`                | Verifies mascot state priority, pointer gaze, and bounded tap reactions.                             |
| `tests/frontend/features/editor/editor.test.js`                 | Verifies editor lifecycle, synchronization resilience, and sanitized content handling.               |
| `tests/frontend/features/editor/chatManager.test.js`            | Verifies chat mounting, document-scoped sync data, safe rendering, unread state, and permissions.    |
| `tests/frontend/features/editor/quillSanitizer.test.js`         | Verifies unsafe tags, attributes, protocols, embeds, and image URLs are removed.                     |
| `tests/frontend/features/editor/virtualization.test.js`         | Verifies large-document page virtualization and bounded DOM work.                                    |
| `tests/frontend/features/editor/managers/BorderManager.test.js` | Verifies border state and control synchronization.                                                   |
| `tests/frontend/features/editor/managers/CursorManager.test.js` | Verifies remote cursor rendering and cleanup.                                                        |
| `tests/frontend/features/editor/managers/PageManager.test.js`   | Verifies page metadata, ordering, sizing, and lifecycle behavior.                                    |
| `tests/frontend/features/editor/managers/SearchManager.test.js` | Verifies find/replace matching, navigation, escaping, and replacement.                               |
| `tests/frontend/features/editor/managers/selection.test.js`     | Verifies selection capture, restoration, and formatting targets.                                     |
| `tests/frontend/features/ui/responsiveLayout.test.js`           | Verifies shared responsive breakpoint classification and contracts.                                  |
| `tests/frontend/features/profile/profile.test.js`               | Verifies profile rendering, verification, updates, and safe user content.                            |
| `tests/frontend/features/theme/background.test.js`              | Verifies dynamic-background setup, theme reaction, and cleanup.                                      |
| `tests/e2e/helpers/auth.js`                                     | Provides browser/API signup, verification, and login helpers for end-to-end suites.                  |
| `tests/e2e/auth-flow.test.js`                                   | Covers registration through collaborative document editing, save, logout, and reload behavior.       |
| `tests/e2e/auth-ui.test.js`                                     | Covers auth form behavior, mascot geometry, validation, verification, and responsive presentation.   |
| `tests/e2e/interactions.test.js`                                | Covers toolbar formatting and theme interaction in a real browser.                                   |
| `tests/e2e/responsiveness.test.js`                              | Covers login and editor layout at desktop/mobile viewports.                                          |
| `tests/e2e/loading-states.test.js`                              | Verifies branded boot loading and viewport-safe new-document loading at desktop/mobile viewports.    |
| `tests/e2e/mobile-editor.test.js`                               | Verifies the phone editor header, single-surface page, and keyboard-docked formatting bar.           |

## Intentionally Local-Only Files

These paths are ignored and are not part of the deployable repository. They are preserved because
they may contain local secrets or user-specific tool settings.

| File                          | Purpose and retention rule                                                        |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `.dev.vars`                   | Local Wrangler secrets; never commit, print, or delete during repository cleanup. |
| `AGENTS.md`                   | Workspace-local agent instructions supplied by the repository owner.              |
| `CLAUDE.md`                   | Workspace-local Claude instructions.                                              |
| `.claude/settings.local.json` | User-specific Claude settings.                                                    |
| `.codexa/providers.json`      | User-specific Codexa provider configuration.                                      |

`node_modules/` is reproducible from `package-lock.json`. `.wrangler/`, `test-results/`,
`playwright-report/`, coverage output, logs, and empty directories are disposable generated state
and should not be retained after a cleanup pass.


## Repository separation and delivery additions

| File | Purpose |
| --- | --- |
| `config/environment.json` | Repository-specific role; protected during promotion. |
| `config/promotion.json` | Explicit shared/protected paths and initial release baseline. |
| `.github/workflows/ci.yml` | Credential-free application, migration, bundling, and browser validation. |
| `.github/workflows/release-verify.yml` | Owner-gated private development provenance checks in production. |
| `scripts/ops.cjs` | Guarded development, deployment, validation, and release commands. |
| `scripts/lib/safety.cjs` | Git identity, credentials/artifact checks, and exact Cloudflare targets. |
| `scripts/lib/promotion.cjs` | Three-way source projection, receipts, and tree reconstruction. |
| `scripts/hooks/pre-push` | Local cross-environment push and main/history guards. |
| `scripts/check-migrations.py` | Fresh and upgrade-preservation checks using disposable in-memory SQL databases. |
| `tests/release/promotion.test.cjs` | Temporary-repository promotion, role-specific push, API diagnostics, and fail-closed audit tests. |
| `docs/DELIVERY.md` | Repository boundaries, bootstrap, promotion, approval, and recovery. |
| `docs/ENVIRONMENT.md` | Environment-specific resource and local-state details. |
| `releases/baseline.json` | Production-only reviewed tooling bootstrap provenance. |

The CLI/environment README supersedes older generic command examples. Production uses the live
`DocumentSyncObject` / `RateLimitObject` bindings; staging uses historical `Synchro` class names.
