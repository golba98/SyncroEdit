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
