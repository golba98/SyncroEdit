const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  git,
  run,
  identity,
  clean,
  checkConfig,
  checkSecrets,
  repositoryName,
  sha256,
} = require('../../scripts/lib/safety.cjs');
const {
  bootstrapFor,
  classification,
  reconstruct,
  withReceipt,
  verifyReceipt,
} = require('../../scripts/lib/promotion.cjs');
const policy = require('../../config/promotion.json');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'syncroedit-safety-test-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Safety Test');
  git(root, 'config', 'user.email', 'test@syncroedit.local');
  git(root, 'remote', 'add', 'origin', 'https://github.com/golba98/SyncroEdit.git');
  function write(file, value) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), value);
  }
  function commit(message) {
    git(root, 'add', '.');
    git(root, 'commit', '-m', message);
    return git(root, 'rev-parse', 'HEAD');
  }
  write('src-worker/sample.js', 'const value = 1;\n');
  write('wrangler.toml', 'production configuration\n');
  write('config/promotion.json', JSON.stringify(policy));
  const base = commit('base');
  return { root, write, commit, base };
}

test('transfers exact changes while preserving production configuration', () => {
  const f = fixture();
  git(f.root, 'switch', '-c', 'development');
  f.write('src-worker/sample.js', 'const value = 2;\n');
  f.write('wrangler.toml', 'development configuration\n');
  const source = f.commit('development');
  git(f.root, 'switch', 'main');
  const merged = reconstruct(f.root, f.base, source, f.base, policy);
  assert.equal(git(f.root, 'show', `${merged.tree}:src-worker/sample.js`), 'const value = 2;');
  assert.equal(git(f.root, 'show', `${merged.tree}:wrangler.toml`), 'production configuration');
  assert.deepEqual(merged.excluded, ['wrangler.toml']);
});

test('preserves unrelated hotfixes and stops on overlapping changes', () => {
  const f = fixture();
  git(f.root, 'switch', '-c', 'development');
  f.write('src-worker/sample.js', 'const value = 2;\n');
  const source = f.commit('source');
  git(f.root, 'switch', 'main');
  f.write('src-worker/hotfix.js', 'const hotfix = true;\n');
  const target = f.commit('hotfix');
  const merged = reconstruct(f.root, f.base, source, target, policy);
  assert.equal(git(f.root, 'show', `${merged.tree}:src-worker/hotfix.js`), 'const hotfix = true;');
  f.write('src-worker/sample.js', 'const value = 99;\n');
  const conflict = f.commit('overlap');
  assert.throws(() => reconstruct(f.root, f.base, source, conflict, policy), /conflict/);
});

test('merges identical infrastructure additions once', () => {
  const f = fixture();
  git(f.root, 'switch', '-c', 'development');
  f.write('scripts/new.cjs', 'module.exports = true;\n');
  const source = f.commit('source tooling');
  git(f.root, 'switch', 'main');
  f.write('scripts/new.cjs', 'module.exports = true;\n');
  const target = f.commit('production tooling');
  assert.deepEqual(reconstruct(f.root, f.base, source, target, policy).transferred, []);
});

test('first release merges bootstrap tooling from its source commit, not the initial baseline', () => {
  const f = fixture();
  git(f.root, 'switch', '-c', 'development');
  f.write('scripts/tool.cjs', 'module.exports = 1;\n');
  const bootstrapSource = f.commit('development tooling');
  git(f.root, 'switch', 'main');
  f.write('scripts/tool.cjs', 'module.exports = 1;\n');
  f.write(
    'releases/baseline.json',
    JSON.stringify({
      kind: 'infrastructure-bootstrap',
      sourceCommit: bootstrapSource,
      sharedFiles: ['scripts/tool.cjs'],
    })
  );
  const target = f.commit('production bootstrap');
  git(f.root, 'switch', 'development');
  f.write('scripts/tool.cjs', 'module.exports = 2;\n');
  f.write('src-worker/sample.js', 'const value = 2;\n');
  const source = f.commit('tooling and application changes after bootstrap');
  git(f.root, 'switch', 'main');

  // Without the bootstrap both sides "add" the tool with different content.
  assert.throws(() => reconstruct(f.root, f.base, source, target, policy), /conflict/);

  const bootstrap = bootstrapFor(f.root, target);
  assert.deepEqual(bootstrap, { sourceCommit: bootstrapSource, sharedFiles: ['scripts/tool.cjs'] });
  const merged = reconstruct(f.root, f.base, source, target, policy, bootstrap);
  assert.equal(git(f.root, 'show', `${merged.tree}:scripts/tool.cjs`), 'module.exports = 2;');
  assert.equal(git(f.root, 'show', `${merged.tree}:src-worker/sample.js`), 'const value = 2;');

  // Once a release receipt exists, later releases merge from that receipt instead.
  f.write(`releases/${source}.json`, JSON.stringify({ sourceCommit: source }));
  assert.equal(bootstrapFor(f.root, f.commit('first release')), null);
});

test('rejects historical migration rewrites and unclassified files', () => {
  const f = fixture();
  f.write('migrations/0001.sql', 'CREATE TABLE t(id INTEGER);');
  const base = f.commit('schema');
  f.write('migrations/0001.sql', 'DROP TABLE t;');
  const source = f.commit('rewrite');
  assert.throws(() => reconstruct(f.root, base, source, base, policy), /Historical migration/);
  assert.throws(() => classification('unexpected.secret', policy), /Unclassified/);
});

test('rejects source symlinks', () => {
  const f = fixture();
  fs.symlinkSync('/etc/passwd', path.join(f.root, 'src-worker/link'));
  const source = f.commit('symlink');
  assert.throws(() => reconstruct(f.root, f.base, source, f.base, policy), /Unsupported source/);
});

test('verifies exact receipt trees and rejects tampering and rehearsal deployment', () => {
  const f = fixture();
  git(f.root, 'switch', '-c', 'development');
  f.write('src-worker/sample.js', 'const value = 2;\n');
  const source = f.commit('source');
  git(f.root, 'switch', 'main');
  const merged = reconstruct(f.root, f.base, source, f.base, policy);
  const receipt = {
    schema: 1,
    sourceRepository: 'golba98/SyncroEdit_dev',
    targetRepository: 'golba98/SyncroEdit',
    sourceCommit: source,
    sourceTree: git(f.root, 'rev-parse', `${source}^{tree}`),
    baselineDevelopment: f.base,
    targetBase: f.base,
    mergedTree: merged.tree,
    changesHash: sha256(JSON.stringify(merged.transferred)),
    validation: { commit: source, tree: git(f.root, 'rev-parse', `${source}^{tree}`) },
    rehearsal: true,
  };
  const tree = withReceipt(f.root, merged.tree, `releases/${source}.json`, receipt);
  const candidate = run('git', ['-C', f.root, 'commit-tree', tree, '-p', f.base], {
    input: 'candidate\n',
  });
  git(f.root, 'switch', '-c', 'candidate', candidate);
  assert.equal(
    verifyReceipt(f.root, { allowRehearsal: true, fetchSource: false }).sourceCommit,
    source
  );
  assert.throws(() => verifyReceipt(f.root, { fetchSource: false }), /Rehearsal/);
  f.write('src-worker/extra.js', 'unexpected');
  f.commit('tamper');
  assert.throws(
    () => verifyReceipt(f.root, { allowRehearsal: true, fetchSource: false }),
    /Unexpected candidate/
  );
});

test('rejects mismatched identities, alternate push URLs, and dirty trees', () => {
  const f = fixture();
  f.write(
    'config/environment.json',
    JSON.stringify({ role: 'production', repository: 'golba98/SyncroEdit' })
  );
  f.commit('identity');
  assert.equal(identity(f.root).role, 'production');
  assert.throws(() => identity(f.root, 'development'), /requires/);
  git(
    f.root,
    'remote',
    'set-url',
    '--push',
    'origin',
    'https://github.com/golba98/SyncroEdit_dev.git'
  );
  assert.throws(() => identity(f.root), /push URL/);
  f.write('untracked.txt', 'preserve me');
  assert.throws(() => clean(f.root), /preserve/);
  assert.throws(
    () => repositoryName('https://token@github.com/golba98/SyncroEdit.git'),
    /Unexpected/
  );
});

test('rejects tracked local configuration without printing credentials', () => {
  const f = fixture();
  f.write('.dev.vars', 'JWT_SECRET=' + 'local-test-value');
  git(f.root, 'add', '.dev.vars');
  assert.throws(() => checkSecrets(f.root), /Forbidden tracked/);
});

test('rejects production D1 contamination in development configuration', () => {
  const f = fixture();
  f.write(
    'config/environment.json',
    JSON.stringify({ role: 'development', repository: 'golba98/SyncroEdit_dev' })
  );
  git(f.root, 'remote', 'set-url', 'origin', 'https://github.com/golba98/SyncroEdit_dev.git');
  const actual = fs.readFileSync(path.resolve(__dirname, '../../wrangler.toml'), 'utf8');
  f.write(
    'wrangler.toml',
    actual.replaceAll(
      '11ebe7c6-b238-43bd-906a-6a1fc651156f',
      '22d0142f-5997-4622-bd2d-33eab48beeea'
    )
  );
  assert.throws(() => checkConfig(f.root), /Wrong D1/);
});

test('rejects rehearsal and environment overrides on deployment commands before remote access', () => {
  const { spawnSync } = require('node:child_process');
  const cli = path.resolve(__dirname, '../../scripts/ops.cjs');
  const result = spawnSync(process.execPath, [cli, 'deploy-production', '--rehearsal'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not supported/);
  const override = spawnSync(process.execPath, [cli, 'deploy', '--env', 'production'], {
    encoding: 'utf8',
  });
  assert.notEqual(override.status, 0);
  assert.match(override.stderr, /Unknown option/);
});

test('health verification rejects an HTTP-200 SPA fallback', async () => {
  const { checkHealth } = require('../../scripts/lib/safety.cjs');
  const original = global.fetch;
  try {
    global.fetch = async () =>
      new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } });
    await assert.rejects(
      () => checkHealth('http://localhost', { attempts: 3, delayMs: 0 }),
      /Worker JSON, received HTTP 200 after 3 attempts/
    );
    global.fetch = async () => Response.json({ status: 'healthy' });
    assert.equal((await checkHealth('http://localhost')).status, 'healthy');
  } finally {
    global.fetch = original;
  }
});

test('health verification waits for a new deployment to reach the edge', async () => {
  const { checkHealth } = require('../../scripts/lib/safety.cjs');
  const original = global.fetch;
  let calls = 0;
  try {
    global.fetch = async () =>
      ++calls < 3
        ? new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } })
        : Response.json({ status: 'healthy' });
    assert.equal(
      (await checkHealth('http://localhost', { attempts: 5, delayMs: 0 })).status,
      'healthy'
    );
    assert.equal(calls, 3);
    calls = 0;
    global.fetch = async () => (++calls, Response.json({ status: 'degraded' }));
    await assert.rejects(
      () => checkHealth('http://localhost', { attempts: 2, delayMs: 0 }),
      /unhealthy status after 2 attempts/
    );
    assert.equal(calls, 2);
  } finally {
    global.fetch = original;
  }
});

test('recognizes dedicated cherry-pick and squash backports without requiring merge ancestry', () => {
  const { findBackport } = require('../../scripts/lib/promotion.cjs');
  const f = fixture();
  git(f.root, 'switch', '-c', 'development');
  f.write('src-worker/feature.js', 'const feature = true;\n');
  const before = f.commit('development feature');
  git(f.root, 'switch', 'main');
  f.write('src-worker/sample.js', 'const value = 99;\n');
  const hotfix = f.commit('urgent production fix');
  assert.throws(
    () => findBackport(f.root, hotfix, f.base, before, policy),
    /dedicated development PR/
  );
  git(f.root, 'switch', 'development');
  git(f.root, 'cherry-pick', '--no-commit', hotfix);
  const backport = f.commit('squashed dedicated backport PR');
  assert.notEqual(backport, hotfix);
  const proof = findBackport(f.root, hotfix, f.base, backport, policy);
  assert.equal(proof.method, 'patch-equivalent');
  assert.equal(proof.developmentCommit, backport);
});

function pushFixture(role) {
  const { TARGETS, ACCOUNT, LIVE_EXPORTS } = require('../../scripts/lib/safety.cjs');
  const f = fixture();
  const target = TARGETS[role];
  git(f.root, 'remote', 'set-url', 'origin', `https://github.com/${target.repository}.git`);
  f.write('config/environment.json', JSON.stringify({ role, repository: target.repository }));
  function environment(name, local = false) {
    const prefix = name ? `env.${name}.` : '';
    const classes = local ? TARGETS.development.classes : target.classes;
    const exported = local ? classes : LIVE_EXPORTS;
    return `${name ? `[env.${name}]\n` : ''}name = "${local ? (role === 'production' ? 'syncroedit-production-local' : 'syncroedit-local') : target.worker}"
account_id = "${ACCOUNT}"
[${prefix}assets]
directory = "./public"
run_worker_first = ["/api/*", "/ws/*", "/health"]
[[${prefix}d1_databases]]
binding = "DB"
database_name = "test-db"
database_id = "${local ? '00000000-0000-0000-0000-000000000000' : target.database}"
${classes.map((className, i) => `[[${prefix}durable_objects.bindings]]\nname = "${i === 0 ? 'DOCUMENT_SYNC_OBJECT' : 'RATE_LIMIT_OBJECT'}"\nclass_name = "${className}"`).join('\n')}
${exported.map((className) => `[${prefix}exports.${className}]\ntype = "durable-object"\nstorage = "sqlite"`).join('\n')}
[${prefix}vars]
APP_URL = "${local ? `http://localhost:${role === 'production' ? 8788 : 8787}` : target.url}"
`;
  }
  f.write(
    'wrangler.toml',
    environment('') +
      environment('local', true) +
      (role === 'development' ? environment('staging') : '')
  );
  const head = f.commit('push-ready environment');
  return {
    ...f,
    head,
    destination: `https://github.com/${target.repository}.git`,
    update: `refs/heads/feature ${head} refs/heads/feature ${'0'.repeat(40)}`,
  };
}

test('development push validates locally without production API credentials', async () => {
  const { checkPush } = require('../../scripts/ops.cjs');
  const f = pushFixture('development');
  const forbidden = () => {
    throw new Error('Production checks must not run for a development push');
  };
  const checks = {
    lastReceipt: forbidden,
    verifyReceipt: forbidden,
    verifyBootstrap: forbidden,
    requireSafeBuilds: forbidden,
  };
  await checkPush(f.root, f.destination, f.update, checks);
  await assert.rejects(
    () => checkPush(f.root, 'https://github.com/golba98/SyncroEdit.git', f.update, checks),
    /Cross-environment/
  );
  await assert.rejects(
    () =>
      checkPush(
        f.root,
        f.destination,
        f.update.replace('refs/heads/feature 000', 'refs/heads/main 000'),
        checks
      ),
    /Direct main/
  );
  await assert.rejects(
    () =>
      checkPush(
        f.root,
        f.destination,
        `refs/heads/feature ${'0'.repeat(40)} refs/heads/feature ${f.head}`,
        checks
      ),
    /ref deletion/
  );
  await assert.rejects(
    () =>
      checkPush(
        f.root,
        f.destination,
        `refs/heads/feature ${f.base} refs/heads/feature ${f.head}`,
        checks
      ),
    /git failed/
  );
  f.write('.dev.vars', 'JWT_SECRET=local-test-value');
  git(f.root, 'add', '.dev.vars');
  await assert.rejects(
    () => checkPush(f.root, f.destination, f.update, checks),
    /Forbidden tracked/
  );
});

test('production push still requires provenance and verified disconnected production builds', async () => {
  const { checkPush } = require('../../scripts/ops.cjs');
  const f = pushFixture('production');
  const calls = [];
  const checks = {
    lastReceipt: () => null,
    verifyBootstrap: () => calls.push('bootstrap'),
    verifyReceipt: () => calls.push('receipt'),
    requireSafeBuilds: async (role) => {
      calls.push(role);
      throw new Error('Builds API unavailable');
    },
  };
  await assert.rejects(
    () => checkPush(f.root, f.destination, f.update, checks),
    /Builds API unavailable/
  );
  assert.deepEqual(calls, ['bootstrap', 'production']);
  calls.length = 0;
  checks.lastReceipt = () => ({});
  checks.requireSafeBuilds = async (role) => calls.push(role);
  await checkPush(f.root, f.destination, f.update, checks);
  assert.deepEqual(calls, ['receipt', 'production']);
});

test('Cloudflare errors identify credential source and status without disclosing credentials', async () => {
  const { cloudflare } = require('../../scripts/lib/safety.cjs');
  const original = global.fetch;
  const previous = {
    api: process.env.CLOUDFLARE_API_TOKEN,
    builds: process.env.SYNCROEDIT_BUILDS_API_TOKEN,
  };
  process.env.CLOUDFLARE_API_TOKEN = 'test-only-api-credential';
  delete process.env.SYNCROEDIT_BUILDS_API_TOKEN;
  try {
    global.fetch = async () =>
      Response.json(
        { success: false, errors: [{ code: 10000, message: process.env.CLOUDFLARE_API_TOKEN }] },
        { status: 403 }
      );
    await assert.rejects(
      () => cloudflare('/builds/example'),
      (error) => {
        assert.match(error.message, /HTTP 403 using CLOUDFLARE_API_TOKEN/);
        assert.match(error.message, /not exported in this process/);
        assert.match(error.message, /10000/);
        assert.ok(!error.message.includes(process.env.CLOUDFLARE_API_TOKEN));
        return true;
      }
    );
    process.env.SYNCROEDIT_BUILDS_API_TOKEN = 'test-only-builds-credential';
    global.fetch = async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer test-only-builds-credential');
      return Response.json({ success: false, errors: [] }, { status: 401 });
    };
    await assert.rejects(
      () => cloudflare('/builds/example'),
      /HTTP 401 using SYNCROEDIT_BUILDS_API_TOKEN.*invalid or expired/
    );
    global.fetch = async () => {
      throw new Error('test-only-builds-credential');
    };
    await assert.rejects(() => cloudflare('/builds/example'), /could not connect or timed out/);
    global.fetch = async () => new Response('<html>blocked</html>', { status: 403 });
    await assert.rejects(() => cloudflare('/builds/example'), /HTTP 403 without JSON/);
  } finally {
    global.fetch = original;
    for (const [key, value] of [
      ['CLOUDFLARE_API_TOKEN', previous.api],
      ['SYNCROEDIT_BUILDS_API_TOKEN', previous.builds],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('build verification selects the requested Worker and rejects connected or malformed triggers', async () => {
  const { requireSafeBuilds } = require('../../scripts/lib/safety.cjs');
  const original = global.fetch;
  const previous = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN = 'test-only-api-credential';
  let result = [];
  const requested = [];
  global.fetch = async (url) => {
    requested.push(url);
    return Response.json({
      success: true,
      result: url.endsWith('/workers/scripts')
        ? [
            { id: 'syncroedit', tag: 'prod-tag' },
            { id: 'syncroedit-dev', tag: 'dev-tag' },
          ]
        : result,
    });
  };
  try {
    assert.deepEqual(await requireSafeBuilds('development'), {
      worker: 'syncroedit-dev',
      triggerCount: 0,
    });
    assert.ok(requested[1].endsWith('/builds/workers/dev-tag/triggers'));
    requested.length = 0;
    await requireSafeBuilds();
    assert.ok(requested[1].endsWith('/builds/workers/prod-tag/triggers'));
    result = [{ id: 'trigger' }];
    await assert.rejects(() => requireSafeBuilds('development'), /syncroedit-dev has 1 connected/);
    result = {};
    await assert.rejects(() => requireSafeBuilds(), /Unexpected build-trigger response/);
  } finally {
    global.fetch = original;
    if (previous === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = previous;
  }
});

test('remote audit fails closed instead of accepting an unverified Builds check', async () => {
  const { auditRemote } = require('../../scripts/ops.cjs');
  const original = console.log;
  console.log = () => {};
  const roles = [];
  try {
    await assert.rejects(
      () =>
        auditRemote('development', {
          remoteTarget: async (role) => {
            roles.push(role);
            return {};
          },
          requireSafeBuilds: async (role) => {
            roles.push(role);
            throw new Error('HTTP 403');
          },
        }),
      /HTTP 403/
    );
    assert.deepEqual(roles, ['development', 'development']);
  } finally {
    console.log = original;
  }
});
