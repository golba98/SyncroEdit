const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { run, git, json, sha256 } = require('./safety.cjs');

function classification(file, policy) {
  if (
    policy.protectedFiles.includes(file) ||
    policy.protectedPrefixes.some((p) => file.startsWith(p))
  )
    return 'protected';
  if (policy.sharedFiles.includes(file) || policy.sharedPrefixes.some((p) => file.startsWith(p)))
    return 'shared';
  throw new Error(`Unclassified source path requires policy review: ${file}`);
}

function ancestor(root, older, newer) {
  git(root, 'merge-base', '--is-ancestor', older, newer);
}

function patchId(root, commit, policy) {
  const patch = git(
    root,
    'show',
    '--format=',
    '--binary',
    '--no-ext-diff',
    '--no-renames',
    commit,
    '--',
    ...policy.sharedPrefixes,
    ...policy.sharedFiles
  );
  return run('git', ['patch-id', '--stable'], { input: patch + '\n' }).split(' ')[0];
}

function findBackport(root, hotfix, baseline, source, policy) {
  try {
    ancestor(root, hotfix, source);
    return { productionCommit: hotfix, developmentCommit: hotfix, method: 'ancestry' };
  } catch {
    const expected = patchId(root, hotfix, policy);
    const commits = git(
      root,
      'rev-list',
      '--no-merges',
      `${baseline}..${source}`,
      '--',
      ...policy.sharedPrefixes,
      ...policy.sharedFiles
    )
      .split('\n')
      .filter(Boolean);
    for (const commit of commits) {
      if (expected && patchId(root, commit, policy) === expected)
        return {
          productionCommit: hotfix,
          developmentCommit: commit,
          method: 'patch-equivalent',
          patchId: expected,
        };
    }
    throw new Error(
      `Backport production commit ${hotfix} in a dedicated development PR before another promotion`
    );
  }
}

function backportsFor(root, target, source, policy) {
  const previous = lastReceipt(root, target);
  if (!previous) return [];
  const releaseCommit = git(
    root,
    'log',
    '-1',
    '--format=%H',
    target,
    '--',
    `releases/${previous.sourceCommit}.json`
  );
  const hotfixes = git(
    root,
    'rev-list',
    '--no-merges',
    `${releaseCommit}..${target}`,
    '--',
    ...policy.sharedPrefixes,
    ...policy.sharedFiles
  )
    .split('\n')
    .filter(Boolean);
  return hotfixes.map((hotfix) =>
    findBackport(root, hotfix, previous.sourceCommit, source, policy)
  );
}

function lastReceipt(root, ref = 'HEAD') {
  const names = git(root, 'log', '--format=', '--name-only', ref, '--', 'releases/').split('\n');
  const file = names.find((name) => /^releases\/[a-f0-9]{40}\.json$/.test(name));
  return file ? JSON.parse(git(root, 'show', `${ref}:${file}`)) : null;
}

function reconstruct(root, baseline, source, target, policy) {
  ancestor(root, baseline, source);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'syncroedit-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
  const indexed = (...args) => run('git', ['-C', root, ...args], { env });
  indexed('read-tree', baseline);
  const changed = git(root, 'diff', '--no-renames', '--name-only', '-z', baseline, source)
    .split('\0')
    .filter(Boolean);
  const included = [];
  const excluded = [];
  for (const file of changed) {
    if (classification(file, policy) === 'protected') {
      excluded.push(file);
      continue;
    }
    const entry = git(root, 'ls-tree', source, '--', file);
    if (file.startsWith('migrations/') && git(root, 'ls-tree', baseline, '--', file))
      throw new Error(`Historical migration modification rejected: ${file}`);
    if (!entry) indexed('update-index', '--force-remove', '--', file);
    else {
      const [mode, type, oid] = entry.split(/\s+/);
      if (type !== 'blob' || !['100644', '100755'].includes(mode))
        throw new Error(`Unsupported source file type: ${file}`);
      indexed('update-index', '--add', '--cacheinfo', `${mode},${oid},${file}`);
    }
    included.push(file);
  }
  const projected = indexed('write-tree');
  const synthetic = run(
    'git',
    [
      '-C',
      root,
      '-c',
      'user.name=SyncroEdit Release',
      '-c',
      'user.email=release@syncroedit.local',
      'commit-tree',
      projected,
      '-p',
      baseline,
    ],
    { input: 'Projected shared development changes\n' }
  );
  let tree;
  try {
    tree = git(
      root,
      'merge-tree',
      '--write-tree',
      `--merge-base=${baseline}`,
      target,
      synthetic
    ).split('\n')[0];
  } catch {
    throw new Error(
      'Three-way promotion conflict: candidate retained; resolve through development/backport review, never overwrite production'
    );
  }
  const transferred = git(root, 'diff', '--name-only', '-z', `${target}^{tree}`, tree)
    .split('\0')
    .filter(Boolean);
  for (const file of transferred) {
    if (classification(file, policy) !== 'shared')
      throw new Error(`Protected production path changed: ${file}`);
  }
  return { tree, included, excluded, transferred };
}

function withReceipt(root, tree, file, receipt) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'syncroedit-receipt-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
  const contents = JSON.stringify(receipt, null, 2) + '\n';
  const blob = run('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: contents });
  run('git', ['-C', root, 'read-tree', tree], { env });
  run('git', ['-C', root, 'update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], {
    env,
  });
  return run('git', ['-C', root, 'write-tree'], { env });
}

function verifyReceipt(root, { allowRehearsal = false, fetchSource = true } = {}) {
  const receipt = lastReceipt(root);
  if (!receipt)
    throw new Error(
      'No promoted release receipt; this is the infrastructure bootstrap, not a deployable application release'
    );
  if (
    receipt.schema !== 1 ||
    receipt.sourceRepository !== 'golba98/SyncroEdit_dev' ||
    receipt.targetRepository !== 'golba98/SyncroEdit'
  )
    throw new Error('Invalid release provenance');
  for (const key of [
    'sourceCommit',
    'sourceTree',
    'baselineDevelopment',
    'targetBase',
    'mergedTree',
  ]) {
    if (!/^[a-f0-9]{40}$/.test(receipt[key])) throw new Error(`Invalid release field: ${key}`);
  }
  if (receipt.rehearsal && !allowRehearsal)
    throw new Error('Rehearsal releases cannot be published or deployed');
  if (
    typeof receipt.rehearsal !== 'boolean' ||
    receipt.validation?.commit !== receipt.sourceCommit ||
    receipt.validation?.tree !== receipt.sourceTree
  )
    throw new Error('Missing exact-source validation evidence');
  if (
    !receipt.rehearsal &&
    (receipt.staging?.commit !== receipt.sourceCommit ||
      receipt.staging?.tree !== receipt.sourceTree ||
      !receipt.staging?.deployment?.id)
  )
    throw new Error('Missing exact-source staging evidence');
  if (fetchSource) {
    git(
      root,
      'fetch',
      '--no-tags',
      'https://github.com/golba98/SyncroEdit_dev.git',
      'refs/heads/main'
    );
    ancestor(root, receipt.sourceCommit, 'FETCH_HEAD');
  }
  if (git(root, 'rev-parse', `${receipt.sourceCommit}^{tree}`) !== receipt.sourceTree)
    throw new Error('Source tree mismatch');
  ancestor(root, receipt.targetBase, 'HEAD');
  const policy = JSON.parse(git(root, 'show', `${receipt.targetBase}:config/promotion.json`));
  const backports = backportsFor(root, receipt.targetBase, receipt.sourceCommit, policy);
  if (JSON.stringify(backports) !== JSON.stringify(receipt.backports || []))
    throw new Error('Hotfix backport provenance mismatch');
  const merged = reconstruct(
    root,
    receipt.baselineDevelopment,
    receipt.sourceCommit,
    receipt.targetBase,
    policy
  );
  if (
    merged.tree !== receipt.mergedTree ||
    sha256(JSON.stringify(merged.transferred)) !== receipt.changesHash
  )
    throw new Error('Release reconstruction differs from the receipt');
  const expected = withReceipt(root, merged.tree, `releases/${receipt.sourceCommit}.json`, receipt);
  if (git(root, 'rev-parse', 'HEAD^{tree}') !== expected)
    throw new Error('Unexpected candidate changes or production drift; prepare a new candidate');
  return receipt;
}

function verifyBootstrap(root) {
  const baseline = json(path.join(root, 'releases/baseline.json'));
  if (baseline.kind !== 'infrastructure-bootstrap') throw new Error('Unknown bootstrap');
  ancestor(root, baseline.productionBase, 'HEAD');
  if (
    git(
      root,
      'diff',
      '--name-only',
      baseline.productionBase,
      'HEAD',
      '--',
      'src-worker',
      'public',
      'migrations'
    )
  )
    throw new Error('Bootstrap must preserve all production application source and migrations');
  git(
    root,
    'fetch',
    '--no-tags',
    'https://github.com/golba98/SyncroEdit_dev.git',
    'refs/heads/main'
  );
  ancestor(root, baseline.sourceCommit, 'FETCH_HEAD');
  const policy = json(path.join(root, 'config/promotion.json'));
  const changed = git(root, 'diff', '--name-only', baseline.productionBase, 'HEAD')
    .split('\n')
    .filter(Boolean);
  for (const file of changed) {
    const kind = classification(file, policy);
    if (kind === 'shared' && file !== 'package.json' && !baseline.sharedFiles.includes(file))
      throw new Error(`Unaccounted bootstrap file: ${file}`);
    if (file.startsWith('releases/') && file !== 'releases/baseline.json')
      throw new Error('Unexpected bootstrap release record');
  }
  const pkg = JSON.parse(git(root, 'show', 'HEAD:package.json'));
  const original = JSON.parse(git(root, 'show', `${baseline.productionBase}:package.json`));
  const source = JSON.parse(git(root, 'show', `${baseline.sourceCommit}:package.json`));
  if (JSON.stringify(pkg.scripts) !== JSON.stringify(source.scripts))
    throw new Error('Bootstrap command interfaces differ from development');
  delete pkg.scripts;
  delete original.scripts;
  if (JSON.stringify(pkg) !== JSON.stringify(original))
    throw new Error('Bootstrap must preserve production dependencies and package metadata');
  for (const file of baseline.sharedFiles) {
    if (
      git(root, 'ls-tree', 'HEAD', '--', file) !==
      git(root, 'ls-tree', baseline.sourceCommit, '--', file)
    )
      throw new Error(`Bootstrap source mismatch: ${file}`);
  }
  return baseline;
}

module.exports = {
  findBackport,
  backportsFor,
  classification,
  ancestor,
  lastReceipt,
  reconstruct,
  withReceipt,
  verifyReceipt,
  verifyBootstrap,
};
