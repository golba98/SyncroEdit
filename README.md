# SyncroEdit production

Repository: <https://github.com/golba98/SyncroEdit>. Live application: <https://syncroedit.online>.
This checkout is for reviewing and deploying deliberately promoted releases. Use the sibling
development repository for everyday work.

The initial restructuring branch adds delivery tooling and documentation while retaining production
application source, assets, and migrations from the original production main. It is an infrastructure
bootstrap, not an application release or authorization to deploy.

## Review a release

Prepare releases from the development repository with `npm run release:prepare`. The command
creates an independent production candidate with exact development provenance, applies only shared
changes through a three-way merge, preserves production configuration, and runs validation.
Review the full diff, receipt, migration additions, excluded paths, and CI results before merging.
Production CI needs the read-only private-source credential described in [delivery architecture](docs/DELIVERY.md).

```bash
npm ci
npm run validate
npm run test:e2e
npm run release:verify
```

For the infrastructure bootstrap only, use `npm run release:verify-bootstrap` after its development
source commit has reached development main. Neither verification command deploys anything.

## Deliberate deployment

Disable and verify production Workers Builds triggers before publishing or merging delivery branches.
Merging a PR and deploying are separate owner decisions. After merging an approved release:

```bash
git switch main
git pull --ff-only origin main
npm ci
npm run deploy:production -- --approve <full-production-main-sha>
```

The deploy command checks origin identity, the exact approved SHA, current main, a merged PR,
application/provenance CI, reconstructed release contents, live resource bindings, and production
build-trigger safety. It reruns local validation and browser tests, records owner approval and the
previous Worker version, then creates an auditable GitHub deployment record. It does not run D1
migrations. Rehearsals and the infrastructure bootstrap cannot be deployed through this command.

There is deliberately no automatic production D1 migration command. Review pending migrations and
backward compatibility separately, validate them against staging, and obtain explicit authorization
for the exact production database operation before executing it. Never edit applied migrations.

`npm run deploy`, `npm run dev`, staging deployment, and staging remote migration commands reject
this repository. Local tests use a separate emulator; no production secrets or database contents
are copied into it. `npm run db:migrate:local` operates only on that local emulator.

## Failures and rollback

A failed release preparation retains its isolated clone and leaves this checkout untouched. A failed
live deployment or health check records a failed GitHub deployment and stops; it does not try another
version or change database state automatically. Approval/deployment logs live in `.git/syncroedit/`.

Inspect the saved previous Worker version and live bindings before deciding recovery. With explicit
owner authorization, use `npx wrangler rollback <previous-version-id> --env=` from this production
checkout. Rollback changes the live Worker and can interrupt WebSockets; it does not undo D1 schema
or data changes, and Durable Object lifecycle compatibility must be reviewed first. Prefer a tested
forward fix if database compatibility is uncertain. After recovery, verify health, authentication,
sharing permissions, collaboration, and reconnection. Do not run write-based probes on live users' data.

See [delivery architecture](docs/DELIVERY.md) and [environment details](docs/ENVIRONMENT.md).
