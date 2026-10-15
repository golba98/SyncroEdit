# Repository and delivery architecture

## Boundaries

The workspace parent has no Git repository. Development owns the original Git metadata, all local
branches/stashes, local configuration, dependencies, and Wrangler state. Production is an independent
full clone. Recovery data is stored outside the workspace. Neither checkout uses source symlinks or
shared Git objects. A workspace file defaults the terminal to development.

`config/environment.json` binds each checkout to its canonical GitHub repository. Operational scripts
validate both fetch and push URLs, reject alternate hosts, compare exact Cloudflare account/resource
identities, and prohibit environment overrides. Local development push hooks validate locally without
production API credentials. Production push hooks additionally verify provenance and disconnected
production build triggers; server rulesets are
the independent protection against direct main pushes and history rewriting. A repository owner can
still deliberately change repository settings or invoke raw Cloudflare tools; these safeguards govern
the supported workflow, rather than claiming to revoke the owner's infrastructure permissions.

| Environment            | Worker                        | D1                        | Document/rate-limit classes                       |
| ---------------------- | ----------------------------- | ------------------------- | ------------------------------------------------- |
| Development local      | `syncroedit-local`            | zero-ID emulator          | `SynchroDocumentObject`, `SynchroRateLimitObject` |
| Staging                | `syncroedit-dev`              | `synchroedit-dev-db`      | `SynchroDocumentObject`, `SynchroRateLimitObject` |
| Production local tests | `syncroedit-production-local` | separate zero-ID emulator | historical `Synchro` classes                      |
| Production             | `syncroedit`                  | `synchroedit-db`          | `DocumentSyncObject`, `RateLimitObject`           |

Both deployed Workers already have four live compatibility exports. Preserve their class names and
namespace identities. API, WebSocket, and `/health` requests reach the Worker before SPA asset fallback; release verification requires actual healthy JSON, not just HTTP 200. Do not replay historical migrations or replace these exports with a new DO
migration. Changing a DO class lifecycle requires its own reviewed infrastructure operation. No
production data is needed for development. The authentication test bypass now requires a test runtime; a public request header alone cannot disable deployed rate limits. Existing remote secret names were verified; secret values
are unavailable to the read API and have not been copied, compared, or replaced.

## One-time bootstrap and remote setup

Delivery uses explicit commands for both Workers. Production `syncroedit` and the Developer
Environment `syncroedit-dev` are separate resources, not interchangeable environment names.
Production automatic Git builds were disconnected during setup and the operator verified zero
triggers; recheck current state before production publishing/deployment. Developer Environment
automatic Git builds must also be disconnected before its first guarded deployment. The existing
Wrangler OAuth token may lack Builds Configuration access.

1. In the Cloudflare dashboard, verify Workers Builds is disconnected from production `syncroedit`,
   and disconnect the Developer Environment `syncroedit-dev` Git build integration.
   This changes delivery automation, not live Worker code. Check that no production build/deploy hook
   or in-flight build can deploy a delivery branch. Retain the original settings for recovery.
2. To let the CLI verify disconnection, provide a user-scoped token through
   `SYNCROEDIT_BUILDS_API_TOKEN` with Workers Builds Configuration access. Keep it in your process
   environment or credential manager, never source control. Existing Wrangler OAuth remains the
   deployment credential. `npm run audit:cloudflare` verifies the current checkout's Worker bindings
   and disconnected build triggers. It exits nonzero on missing access or failed safety verification. Ordinary
   development pushes require no production token. Production publishing and both remote deployment
   commands require the relevant live checks; never bypass those checks.
3. Production GitHub environment `release-source` requires owner approval and a secret named
   `SOURCE_REPOSITORY_READ_TOKEN`. Use a fine-grained token scoped to development repository contents
   read access only. Do not copy a broad personal token or any application/Cloudflare secret into it.
   Review the workflow and verifier before approving a job that receives private-source access.
4. Publish the development restructuring branch and merge its reviewed PR after `application-ci`.
   If GitHub squash/rebase changes the source SHA, run `npm run release:bootstrap-source -- --source <merged-development-sha>` in production and commit the updated receipt. Then publish the production infrastructure-bootstrap branch. Its receipt records the exact
   development tooling source; `release-provenance` verifies it after owner environment approval.
   The bootstrap must preserve production application files and migrations. Merge it only after
   review; it does not authorize a deployment.
5. Confirm GitHub main rulesets require PRs, forbid deletion/non-fast-forward updates, and require
   application CI (plus production provenance). There is no ordinary administrator bypass. With a
   sole maintainer, the owner explicitly reviews and merges the PR; an unavailable second reviewer
   is not required. Deployment remains a separate exact-SHA owner decision.

The source-verification job deliberately fails if its private-source credential is unavailable.
There is no automatic production deployment workflow. Do not install a CI deployment token merely
to satisfy source verification. Cloudflare's independent build trigger must be disabled separately.

## Deterministic promotion

`npm run release:validate` requires a clean development commit, runs all local checks including
Playwright, and writes exact-SHA/tree evidence under `.git/syncroedit/validation/`. After the commit
has reached development main, migrate staging if needed and run `npm run deploy:staging`. It verifies
the existing remote database/namespaces and disconnected Developer Environment build triggers,
deploys the exact source, checks health, and records the
active staging deployment. A failed health probe records no staging approval.

`npm run release:prepare -- --source <full-sha>` requires both forms of evidence and confirms staging
has not changed. It clones current production main into `.release-candidates/`, imports development
Git objects without merging its history, and derives the source delta from the last accepted receipt.
The first baseline is the verified common ancestor `b40a89306afa94a3c9010dbac9623f02159c0f81`.

`config/promotion.json` classifies shared, protected, and unknown paths. Unknown paths stop promotion.
Production Wrangler config, environment role, README, environment documentation, Dependabot policy,
and release records are protected. Application source, public assets, tests, append-only migrations,
and shared delivery tooling are transferred. No working-directory copying, ignored files, local
secrets, dependency directories, or build output are part of the transfer.

A temporary Git index projects only shared changes onto the baseline. Git's three-way tree merge
then combines that projection with the pinned production tree. Identical additions merge once,
independent hotfixes survive, and overlapping conflicts stop. Historical migration edits and source
symlinks are rejected. Source commits cannot be promoted twice. After a recorded release, production
commits touching shared paths must be backported into development before another promotion. A
dedicated cherry-pick/squash PR is accepted when its stable Git patch ID matches the production
change; original merge ancestry is also accepted. Receipts record both commit identities and the
proof, and production CI independently recomputes it. Keep each hotfix in a dedicated backport PR;
modified or combined patches require separate conflict review and are blocked by the automated path.

The candidate is a single production-parented commit, with a receipt naming source repository/commit,
source tree, previous development baseline, production base, reconstructed tree, included/excluded
paths, and validation evidence. Candidate validation installs its own lockfile dependencies and runs
all checks and browser tests. `release:verify` reconstructs the exact tree and rejects extra changes.
Private development history is not added as a parent of the production release commit.

Preparation leaves the ordinary production checkout unchanged. Failed candidates are retained.
`--publish` explicitly requests pushing the candidate and opening a draft PR; it first requires safe
production build triggers. `--rehearsal` instead targets the local production bootstrap and marks its
receipt non-deployable. It still requires exact committed local validation and tests the candidate.

## Approval, deployment, and recovery

Review the diff and receipt, pass CI, approve private-source access, and merge the production PR.
Then the owner checks out current clean production main and explicitly invokes:

```bash
npm run deploy:production -- --approve <full-production-main-sha>
```

The command independently checks the source receipt, merged PR, successful application/provenance
checks, owner identity, production build disconnection, and live resource bindings. It reruns local
validation, records the previous Worker version and approval, and creates a GitHub deployment record.
It never applies production migrations. Deployment failure or failed read-only health verification
stops and records failure; rollback is a separate authorized decision. See the production README.

SQL migrations are immutable history: test a fresh database locally, validate upgrade behavior on
staging, review compatibility with old and new Worker code, and approve exact production SQL changes
separately. Worker rollback does not restore D1 data or reverse schemas. Never reset production to
make a migration pass. The restructuring itself executes no production SQL or deployment.

## Verification limits

Local mock/Miniflare tests do not establish real outbound email delivery, Cloudflare edge behavior,
or live user collaboration. HTTP probes from this execution environment returned 403 for both live
health URLs. Do not mistake these responses for a passed smoke test or alter zone security to make
tests green. Run staging verification from an allowed network and synthetic accounts before a real
release. Preserve evidence of any manual checks with the release review.
