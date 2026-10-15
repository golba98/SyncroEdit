#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const {
  TARGETS,
  run,
  git,
  json,
  writeJson,
  sha256,
  identity,
  clean,
  localState,
  checkConfig,
  checkSecrets,
  remoteTarget,
  requireSafeBuilds,
  checkHealth,
  repositoryName,
} = require('./lib/safety.cjs');
const {
  ancestor,
  backportsFor,
  lastReceipt,
  reconstruct,
  withReceipt,
  verifyReceipt,
  verifyBootstrap,
} = require('./lib/promotion.cjs');
const root = path.resolve(__dirname, '..');
const command = process.argv[2];

function npm(script, cwd = root) {
  run('npm', ['run', script], { cwd, stdio: 'inherit' });
}

function wrangler(args, cwd = root) {
  run(process.execPath, [path.join(cwd, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

function evidence(root, sha, stage) {
  const data = json(localState(root, `${stage}/${sha}.json`));
  if (data.commit !== sha || data.tree !== git(root, 'rev-parse', `${sha}^{tree}`))
    throw new Error('Validation evidence does not match the source');
  return data;
}

async function prepare(options) {
  identity(root, 'development');
  clean(root);
  const sha = git(root, 'rev-parse', '--verify', `${options.source || 'HEAD'}^{commit}`);
  if (sha !== git(root, 'rev-parse', 'HEAD'))
    throw new Error('Check out the exact source commit before preparing a release');
  const validation = evidence(root, sha, 'validation');
  let staging = null;
  if (!options.rehearsal) {
    git(root, 'fetch', 'origin', 'main');
    ancestor(root, sha, 'origin/main');
    staging = evidence(root, sha, 'staging');
    const live = await remoteTarget('development');
    if (live.deployment.id !== staging.deployment.id || live.tag !== sha)
      throw new Error('Staging changed since validation; validate this source on staging again');
  }
  if (options.rehearsal && options.publish) throw new Error('Rehearsals cannot be published');
  if (options.publish) await requireSafeBuilds();
  const directory = path.join(
    root,
    '..',
    '.release-candidates',
    `${sha.slice(0, 12)}-${Date.now()}`
  );
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const localTarget = options.target || path.join(root, '..', '1-SyncroEdit Production');
  if (options.target && !options.rehearsal)
    throw new Error('--target is only supported for local rehearsals');
  if (options.rehearsal) {
    identity(localTarget, 'production');
    clean(localTarget);
    const branch = git(localTarget, 'branch', '--show-current');
    if (!branch) throw new Error('Rehearsal target must be on a branch');
    run('git', [
      'clone',
      '--no-local',
      '--no-hardlinks',
      '--single-branch',
      '--branch',
      branch,
      localTarget,
      directory,
    ]);
    git(directory, 'remote', 'set-url', 'origin', 'https://github.com/golba98/SyncroEdit.git');
  } else {
    run('git', ['clone', '--no-local', 'https://github.com/golba98/SyncroEdit.git', directory]);
  }
  console.log(`Candidate retained at: ${directory}`);
  identity(directory, 'production');
  git(directory, 'config', 'core.hooksPath', 'scripts/hooks');
  git(directory, 'fetch', '--no-tags', root, sha);
  const target = git(directory, 'rev-parse', 'HEAD');
  const policy = json(path.join(directory, 'config/promotion.json'));
  const previous = lastReceipt(directory);
  if (fs.existsSync(path.join(directory, `releases/${sha}.json`)))
    throw new Error('This source has already been promoted');
  const baseline = previous?.sourceCommit || policy.initialBaseline;
  const backports = backportsFor(directory, target, sha, policy);
  const merged = reconstruct(directory, baseline, sha, target, policy);
  if (!merged.transferred.length) throw new Error('No unapplied shared changes to promote');
  const receipt = {
    schema: 1,
    sourceRepository: TARGETS.development.repository,
    sourceCommit: sha,
    sourceTree: git(root, 'rev-parse', 'HEAD^{tree}'),
    baselineDevelopment: baseline,
    targetRepository: TARGETS.production.repository,
    targetBase: target,
    mergedTree: merged.tree,
    changesHash: sha256(JSON.stringify(merged.transferred)),
    included: merged.included,
    excluded: merged.excluded,
    validation,
    staging,
    backports,
    rehearsal: !!options.rehearsal,
    preparedAt: new Date().toISOString(),
  };
  const tree = withReceipt(directory, merged.tree, `releases/${sha}.json`, receipt);
  const commit = run(
    'git',
    [
      '-C',
      directory,
      '-c',
      'user.name=SyncroEdit Release',
      '-c',
      'user.email=release@syncroedit.local',
      'commit-tree',
      tree,
      '-p',
      target,
    ],
    { input: `release: promote development ${sha}\n\nDevelopment-Source: ${sha}\n` }
  );
  const branch = `release/dev-${sha.slice(0, 12)}`;
  git(directory, 'switch', '-c', branch, commit);
  run('npm', ['ci'], { cwd: directory, stdio: 'inherit' });
  npm('validate', directory);
  npm('test:e2e', directory);
  verifyReceipt(directory, {
    allowRehearsal: !!options.rehearsal,
    fetchSource: !options.rehearsal,
  });
  clean(directory);
  console.log(git(directory, 'diff', '--stat', target, 'HEAD'));
  console.log(`Excluded environment paths: ${merged.excluded.join(', ') || '(none)'}`);
  console.log(
    `Validated ${options.rehearsal ? 'REHEARSAL' : 'release candidate'} ${commit}; no merge, deployment, or production migration performed.`
  );
  if (options.publish) {
    git(directory, 'push', '-u', 'origin', branch);
    const body = localState(directory, 'pr-body.md');
    fs.writeFileSync(
      body,
      `Promotes development commit \`${sha}\` onto production base \`${target}\`.\n\nValidation: lint, Jest, release safety tests, SQL migrations, Wrangler dry runs, and Playwright passed.\n\nReview the committed release receipt and excluded configuration paths. Merging does not authorize deployment; deployment requires an explicit approved production SHA.\n`
    );
    console.log(
      run(
        'gh',
        [
          'pr',
          'create',
          '--repo',
          TARGETS.production.repository,
          '--base',
          'main',
          '--head',
          branch,
          '--draft',
          '--title',
          `Release development ${sha.slice(0, 12)}`,
          '--body-file',
          body,
        ],
        { cwd: directory }
      )
    );
  }
}

async function deploy(role, options) {
  identity(root, role);
  clean(root);
  checkConfig(root);
  const sha = git(root, 'rev-parse', 'HEAD');
  const before = await remoteTarget(role);
  if (role === 'development') {
    await requireSafeBuilds('development');
    git(root, 'fetch', 'origin', 'main');
    ancestor(root, sha, 'origin/main');
    evidence(root, sha, 'validation');
    wrangler([
      'deploy',
      '--strict',
      '--keep-vars',
      '--no-autoconfig',
      '--env',
      'staging',
      '--tag',
      sha,
      '--message',
      `Development validation ${sha}`,
    ]);
    await checkHealth(TARGETS.development.url);
    const after = await remoteTarget(role);
    if (after.tag !== sha)
      throw new Error('Active staging version does not match the validated source');
    writeJson(localState(root, `staging/${sha}.json`), {
      commit: sha,
      tree: git(root, 'rev-parse', 'HEAD^{tree}'),
      deployment: after.deployment,
      checkedAt: new Date().toISOString(),
    });
    console.log('Staging evidence recorded; production was not deployed.');
    return;
  }
  if (options.approve !== sha)
    throw new Error('Explicit --approve must match the full production HEAD SHA');
  await requireSafeBuilds();
  git(root, 'fetch', 'origin', 'main');
  if (
    git(root, 'rev-parse', 'origin/main') !== sha ||
    git(root, 'branch', '--show-current') !== 'main'
  )
    throw new Error('Deploy only clean, current production main');
  const receipt = verifyReceipt(root);
  const checks = JSON.parse(
    run('gh', ['api', `repos/${TARGETS.production.repository}/commits/${sha}/check-runs`])
  );
  for (const name of ['application-ci', 'release-provenance']) {
    const latest = checks.check_runs
      .filter((check) => check.name === name && check.app.slug === 'github-actions')
      .sort((a, b) => b.id - a.id)[0];
    if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success')
      throw new Error(`Required successful GitHub check missing: ${name}`);
  }
  const prs = JSON.parse(
    run('gh', ['api', `repos/${TARGETS.production.repository}/commits/${sha}/pulls`])
  );
  if (
    !prs.some(
      (pr) =>
        pr.merged_at &&
        pr.base.ref === 'main' &&
        pr.base.repo.full_name === TARGETS.production.repository
    )
  )
    throw new Error('An explicitly merged production PR is required');
  const owner = run('gh', ['api', 'user', '--jq', '.login']);
  if (owner !== 'golba98')
    throw new Error('Only the repository owner can approve this local deployment');
  npm('validate');
  npm('test:e2e');
  const approval = {
    commit: sha,
    development: receipt.sourceCommit,
    approvedBy: owner,
    approvedAt: new Date().toISOString(),
    previousDeployment: before.deployment,
  };
  writeJson(localState(root, `approvals/${sha}-${Date.now()}.json`), approval);
  const deployment = JSON.parse(
    run(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${TARGETS.production.repository}/deployments`,
        '--input',
        '-',
      ],
      {
        input: JSON.stringify({
          ref: sha,
          environment: 'production',
          auto_merge: false,
          required_contexts: [],
          description: `Owner approved development ${receipt.sourceCommit}`,
        }),
      }
    )
  );
  const status = (state, description) =>
    run(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${TARGETS.production.repository}/deployments/${deployment.id}/statuses`,
        '--input',
        '-',
      ],
      { input: JSON.stringify({ state, description, environment_url: TARGETS.production.url }) }
    );
  try {
    status('in_progress', 'Owner explicitly approved exact production commit');
    wrangler([
      'deploy',
      '--strict',
      '--keep-vars',
      '--no-autoconfig',
      '--env=',
      '--tag',
      sha,
      '--message',
      `Approved release ${sha}`,
    ]);
    await checkHealth(TARGETS.production.url);
    const after = await remoteTarget(role);
    writeJson(localState(root, `deployments/${sha}.json`), {
      ...approval,
      deployment: after.deployment,
    });
    status('success', 'Deployment and read-only health check passed');
  } catch (error) {
    status(
      'failure',
      'Deployment or post-deployment verification failed; manual recovery required'
    );
    throw error;
  }
}

async function checkPush(
  checkout,
  destination,
  updates,
  checks = { lastReceipt, verifyReceipt, verifyBootstrap, requireSafeBuilds }
) {
  const { role } = identity(checkout);
  if (repositoryName(destination) !== TARGETS[role].repository)
    throw new Error('Cross-environment push blocked');
  if (process.env.CLOUDFLARE_ENV || process.env.WRANGLER_ENV)
    throw new Error('Unset ambient Cloudflare environment overrides');
  checkConfig(checkout);
  checkSecrets(checkout);
  for (const update of updates.trim().split('\n').filter(Boolean)) {
    const [, local, remote, old] = update.split(/\s+/);
    if (remote === 'refs/heads/main' || /^0+$/.test(local))
      throw new Error('Direct main pushes and ref deletion are blocked');
    if (!/^0+$/.test(old)) ancestor(checkout, old, local);
  }
  if (role === 'production') {
    if (checks.lastReceipt(checkout)) checks.verifyReceipt(checkout);
    else checks.verifyBootstrap(checkout);
    await checks.requireSafeBuilds('production');
  }
}

async function auditRemote(role, checks = { remoteTarget, requireSafeBuilds }) {
  const target = await checks.remoteTarget(role);
  console.log(JSON.stringify(target, null, 2));
  const builds = await checks.requireSafeBuilds(role);
  console.log(`${builds.worker}: automatic Git build triggers disconnected, verified`);
  return { target, builds };
}

async function main() {
  if (command === 'check-push') {
    const [, destination] = process.argv.slice(3);
    await checkPush(root, destination, fs.readFileSync(0, 'utf8'));
    return;
  }
  const { values: options, positionals } = parseArgs({
    args: process.argv.slice(3),
    strict: true,
    allowPositionals: false,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      rehearsal: { type: 'boolean' },
      publish: { type: 'boolean' },
      approve: { type: 'string' },
    },
  });
  if (positionals.length) throw new Error('Unexpected positional arguments');
  const allowed =
    {
      prepare: ['source', 'target', 'rehearsal', 'publish'],
      verify: ['rehearsal'],
      'deploy-production': ['approve'],
      'bootstrap-source': ['source'],
    }[command] || [];
  for (const option of Object.keys(options)) {
    if (!allowed.includes(option)) throw new Error(`--${option} is not supported for ${command}`);
  }
  if (process.env.CLOUDFLARE_ENV || process.env.WRANGLER_ENV)
    throw new Error('Unset ambient Cloudflare environment overrides');
  const role = checkConfig(root);
  switch (command) {
    case 'check':
      checkSecrets(root);
      console.log(`Environment and tracked-file checks passed: ${role}`);
      break;
    case 'validate':
      checkSecrets(root);
      npm('lint');
      npm('test');
      npm('test:release');
      run('python3', ['scripts/check-migrations.py'], { cwd: root, stdio: 'inherit' });
      wrangler(['deploy', '--dry-run', '--env=']);
      wrangler(['deploy', '--dry-run', '--env', 'local']);
      break;
    case 'release-validate': {
      identity(root, 'development');
      clean(root);
      const sha = git(root, 'rev-parse', 'HEAD');
      npm('validate');
      npm('test:e2e');
      clean(root);
      writeJson(localState(root, `validation/${sha}.json`), {
        commit: sha,
        tree: git(root, 'rev-parse', 'HEAD^{tree}'),
        checkedAt: new Date().toISOString(),
        suites: ['lint', 'jest', 'release-safety', 'migrations', 'wrangler', 'playwright'],
      });
      break;
    }
    case 'dev':
      identity(root, 'development');
      wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--env', 'local']);
      run(process.execPath, ['scripts/seed-dev-user.mjs'], { cwd: root, stdio: 'inherit' });
      wrangler(['dev', '--env', 'local', '--port', '8787', '--live-reload']);
      break;
    case 'migrate-local':
      wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--env', 'local']);
      break;
    case 'migrate-staging':
      identity(root, 'development');
      await remoteTarget('development');
      wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--env', 'staging']);
      break;
    case 'deploy':
      if (role === 'production')
        throw new Error('Production requires deploy:production -- --approve <full merged SHA>');
      await deploy('development', options);
      break;
    case 'deploy-production':
      await deploy('production', options);
      break;
    case 'prepare':
      await prepare(options);
      break;
    case 'verify':
      identity(root, 'production');
      console.log(
        verifyReceipt(root, {
          allowRehearsal: !!options.rehearsal,
          fetchSource: !options.rehearsal,
        })
      );
      break;
    case 'verify-bootstrap':
      identity(root, 'production');
      console.log(verifyBootstrap(root));
      break;
    case 'bootstrap-source': {
      identity(root, 'production');
      clean(root);
      if (lastReceipt(root))
        throw new Error('Bootstrap source cannot change after application promotion');
      if (!/^[a-f0-9]{40}$/.test(options.source || ''))
        throw new Error('Specify the full merged development SHA');
      git(
        root,
        'fetch',
        '--no-tags',
        'https://github.com/golba98/SyncroEdit_dev.git',
        'refs/heads/main'
      );
      ancestor(root, options.source, 'FETCH_HEAD');
      const file = path.join(root, 'releases/baseline.json');
      const baseline = json(file);
      for (const shared of baseline.sharedFiles) {
        if (
          git(root, 'rev-parse', `HEAD:${shared}`) !==
          git(root, 'rev-parse', `${options.source}:${shared}`)
        )
          throw new Error(`Merged development tooling differs: ${shared}`);
      }
      baseline.sourceCommit = options.source;
      writeJson(file, baseline);
      console.log(
        'Bootstrap provenance updated locally; review and commit the receipt before publishing.'
      );
      break;
    }
    case 'audit-remote':
      await auditRemote(role);
      break;
    default:
      throw new Error(`Unknown operation: ${command || '(missing)'}`);
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(`Safety check failed: ${error.message}`);
    process.exitCode = 1;
  });

module.exports = { checkPush, auditRemote };
