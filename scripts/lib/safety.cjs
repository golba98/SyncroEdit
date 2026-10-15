const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ACCOUNT = '3c616f4db02149046562a2fa51a6440b';
const TARGETS = {
  development: {
    repository: 'golba98/SyncroEdit_dev',
    worker: 'syncroedit-dev',
    database: '11ebe7c6-b238-43bd-906a-6a1fc651156f',
    classes: ['SynchroDocumentObject', 'SynchroRateLimitObject'],
    namespaces: ['d62c707c6fff48a886bd50df0ed74706', '52894ac44a4d48f29cdc416cd1d93594'],
    url: 'https://syncroedit-dev.jordanvorster404.workers.dev',
  },
  production: {
    repository: 'golba98/SyncroEdit',
    worker: 'syncroedit',
    database: '22d0142f-5997-4622-bd2d-33eab48beeea',
    classes: ['DocumentSyncObject', 'RateLimitObject'],
    namespaces: ['8024819bf13646499aeb775b52b47f0f', '7d8353634e794e4d876e336231e7ff7d'],
    url: 'https://syncroedit.online',
  },
};
const LIVE_EXPORTS = [
  'DocumentSyncObject',
  'RateLimitObject',
  'SynchroDocumentObject',
  'SynchroRateLimitObject',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? 'unavailable'}): ${result.stderr || result.error?.message || 'see output'}`
    );
  }
  return (result.stdout || '').trim();
}

function git(root, ...args) {
  return run('git', ['-C', root, ...args]);
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function repositoryName(remote) {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)(golba98\/SyncroEdit(?:_dev)?)(?:\.git)?$/.exec(
      remote
    );
  if (!match)
    throw new Error('Unexpected GitHub remote; credentials and alternate hosts are rejected');
  return match[1];
}

function identity(root, expectedRole) {
  const config = json(path.join(root, 'config/environment.json'));
  if (!TARGETS[config.role] || (expectedRole && config.role !== expectedRole)) {
    throw new Error(`This command requires the ${expectedRole || 'configured'} repository`);
  }
  const expected = TARGETS[config.role].repository;
  if (
    config.repository !== expected ||
    repositoryName(git(root, 'remote', 'get-url', 'origin')) !== expected
  ) {
    throw new Error('Environment marker and origin repository do not agree');
  }
  if (repositoryName(git(root, 'remote', 'get-url', '--push', 'origin')) !== expected) {
    throw new Error('Origin push URL does not match this environment');
  }
  return config;
}

function clean(root) {
  if (git(root, 'status', '--porcelain'))
    throw new Error('Commit or preserve all tracked and untracked changes first');
}

function localState(root, name) {
  return path.resolve(root, git(root, 'rev-parse', '--git-path', `syncroedit/${name}`));
}

function readConfig(root, env) {
  return require('wrangler').unstable_readConfig(
    { config: path.join(root, 'wrangler.toml'), env },
    { hideWarnings: true }
  );
}

function checkConfig(root) {
  const { role } = identity(root);
  const target = TARGETS[role];
  const environments =
    role === 'development' ? [undefined, 'staging', 'local'] : [undefined, 'local'];
  for (const env of environments) {
    const c = readConfig(root, env);
    if (c.account_id !== ACCOUNT) throw new Error('Unexpected Cloudflare account');
    const local = env === 'local';
    const databases = c.d1_databases || [];
    if (databases.length !== 1 || databases[0].binding !== 'DB' || databases[0].remote) {
      throw new Error('D1 must have exactly one explicit DB binding with no remote local proxy');
    }
    const expectedDb = local ? '00000000-0000-0000-0000-000000000000' : target.database;
    if (databases[0].database_id !== expectedDb) throw new Error('Wrong D1 target');
    if (
      c.name !==
      (local
        ? role === 'development'
          ? 'syncroedit-local'
          : 'syncroedit-production-local'
        : target.worker)
    )
      throw new Error('Wrong Worker target');
    if (Object.keys(c.services || {}).length || c.routes?.length || c.route)
      throw new Error('Unexpected service or route override');
    const classes = (c.durable_objects?.bindings || []).map((b) => b.class_name).sort();
    const expectedClasses = local ? TARGETS.development.classes : target.classes;
    for (const [index, name] of ['DOCUMENT_SYNC_OBJECT', 'RATE_LIMIT_OBJECT'].entries()) {
      if (
        c.durable_objects.bindings.find((binding) => binding.name === name)?.class_name !==
        expectedClasses[index]
      )
        throw new Error('Wrong Durable Object binding name/class mapping');
    }
    if (JSON.stringify(classes) !== JSON.stringify([...expectedClasses].sort()))
      throw new Error('Durable Object class drift');
    if (c.durable_objects.bindings.some((b) => b.script_name || b.environment || b.remote))
      throw new Error('Cross-Worker Durable Object binding rejected');
    const exported = Object.keys(c.exports || {}).sort();
    const expectedExports = local ? TARGETS.development.classes : LIVE_EXPORTS;
    if (
      JSON.stringify(exported) !== JSON.stringify([...expectedExports].sort()) ||
      c.migrations?.length ||
      exported.some(
        (name) => c.exports[name].type !== 'durable-object' || c.exports[name].storage !== 'sqlite'
      )
    ) {
      throw new Error('Durable Object lifecycle changed; requires separate infrastructure review');
    }
    const url = local ? `http://localhost:${role === 'production' ? 8788 : 8787}` : target.url;
    if (c.vars?.APP_URL !== url) throw new Error('Wrong application URL');
    if (
      Object.keys(c.vars || {}).some((name) =>
        ['JWT_SECRET', 'RESEND_API_KEY', 'EMAIL_CODE_PEPPER'].includes(name)
      )
    )
      throw new Error('Secrets must not be stored as Wrangler plaintext variables');
    if (c.vars?.NODE_ENV === 'test' && !local) throw new Error('Test bypass cannot be deployed');
  }
  return role;
}

function checkSecrets(root) {
  const forbidden =
    /(^|\/)(?:\.dev\.vars(?:\..*)?|\.env(?:\..*)?|node_modules|\.wrangler|\.claude|coverage|test-results|playwright-report|dist|tmp|AGENTS\.md|CLAUDE\.md)(?:\/|$)|\.(?:pem|key)$/i;
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
    /\bre_[A-Za-z0-9]{25,}\b/,
  ];
  for (const file of git(root, 'ls-files', '-z').split('\0').filter(Boolean)) {
    if (file !== '.env.example' && forbidden.test(file))
      throw new Error(`Forbidden tracked environment/artifact path: ${file}`);
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    if (fs.lstatSync(full).isSymbolicLink())
      throw new Error(`Tracked symlink requires review: ${file}`);
    const data = fs.readFileSync(full);
    if (data.includes(0)) continue;
    if (patterns.some((p) => p.test(data.toString('utf8'))))
      throw new Error(`Potential credential in tracked file: ${file}`);
  }
}

function cloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const file = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    '.wrangler/config/default.toml'
  );
  const match = /^oauth_token\s*=\s*("[^"\n]+")/m.exec(fs.readFileSync(file, 'utf8'));
  if (!match) throw new Error('Use wrangler login or a scoped CLOUDFLARE_API_TOKEN');
  return JSON.parse(match[1]);
}

async function cloudflare(endpoint) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${endpoint.startsWith('/builds/') && process.env.SYNCROEDIT_BUILDS_API_TOKEN ? process.env.SYNCROEDIT_BUILDS_API_TOKEN : cloudflareToken()}`,
    },
  });
  const body = await res.json();
  if (!res.ok || !body.success)
    throw new Error(
      `Cloudflare read failed (${res.status}); requested API permission may be missing`
    );
  return body.result;
}

async function remoteTarget(role) {
  const target = TARGETS[role];
  const settings = await cloudflare(`/workers/scripts/${target.worker}/settings`);
  const bindings = settings.bindings;
  if (bindings.find((b) => b.name === 'DB')?.id !== target.database)
    throw new Error('Live D1 binding drift');
  for (const [i, name] of ['DOCUMENT_SYNC_OBJECT', 'RATE_LIMIT_OBJECT'].entries()) {
    const binding = bindings.find((b) => b.name === name);
    if (binding?.class_name !== target.classes[i] || binding?.namespace_id !== target.namespaces[i])
      throw new Error('Live Durable Object namespace drift');
  }
  for (const name of ['JWT_SECRET', 'EMAIL_CODE_PEPPER', 'RESEND_API_KEY']) {
    if (!bindings.some((b) => b.name === name && b.type === 'secret_text'))
      throw new Error(`Missing live secret binding: ${name}`);
  }
  if (
    bindings.find((binding) => binding.name === 'APP_URL')?.text !== target.url ||
    bindings.find((binding) => binding.name === 'NODE_ENV')?.text === 'test'
  )
    throw new Error('Live URL or test-mode drift');
  const deployments = await cloudflare(`/workers/scripts/${target.worker}/deployments`);
  const deployment = deployments.deployments[0];
  if (deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100)
    throw new Error('Partial rollout requires separate release review');
  const version = await cloudflare(
    `/workers/scripts/${target.worker}/versions/${deployment.versions[0].version_id}`
  );
  if (role === 'production') {
    const domains = await cloudflare('/workers/domains');
    if (
      !domains.some(
        (domain) =>
          domain.hostname === 'syncroedit.online' &&
          domain.service === 'syncroedit' &&
          domain.environment === 'production' &&
          domain.enabled
      )
    )
      throw new Error('Production custom domain drift');
  }
  return {
    worker: target.worker,
    database: target.database,
    namespaces: target.namespaces,
    deployment,
    tag: version.annotations?.['workers/tag'] || null,
  };
}

async function requireSafeBuilds() {
  const workers = await cloudflare('/workers/scripts');
  const worker = workers.find((w) => w.id === TARGETS.production.worker);
  const triggers = await cloudflare(`/builds/workers/${worker.tag}/triggers`);
  // No production build triggers is the unambiguous safe state. A build-only
  // trigger must be reviewed separately; arbitrary shell commands are not parsed.
  if (triggers.length)
    throw new Error('Disconnect production Workers Builds before publishing release branches');
}

module.exports = {
  ACCOUNT,
  TARGETS,
  LIVE_EXPORTS,
  run,
  git,
  json,
  writeJson,
  sha256,
  identity,
  clean,
  localState,
  readConfig,
  checkConfig,
  checkSecrets,
  repositoryName,
  cloudflare,
  remoteTarget,
  requireSafeBuilds,
};
