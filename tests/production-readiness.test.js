const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { gzipSync } = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const http = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const token = 'sample-only-administrator-bootstrap-token-12345';

// Los procesos de tests jamas reciben credenciales de respaldos del entorno padre.
// Los tests que necesiten S3 deben inyectar explicitamente credenciales FICTICIAS.
function isolatedEnv(overrides = {}, parent = process.env) {
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (key.startsWith('BACKUP_S3_')) delete env[key];
  }
  return { ...env, ...overrides };
}

function restore(env) {
  return spawnSync(process.execPath, ['restaurar.js'], { cwd: root, env: isolatedEnv(env), encoding: 'utf8' });
}

function restoreAsync(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['restaurar.js'], { cwd: root, env: isolatedEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function waitUntilReady(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try { const res = await fetch(url); if (res.ok) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('server did not become ready');
}

test('restoration fails closed when no database or backup exists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ladder-restore-'));
  try {
    const denied = restore({ DATA_DIR: dir, ALLOW_EMPTY_DB: '0' });
    assert.equal(denied.status, 1);
    assert.equal(existsSync(path.join(dir, 'ladder.db')), false);
    const allowed = restore({ DATA_DIR: dir, ALLOW_EMPTY_DB: '1' });
    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /base-nueva-autorizada/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reserved admin alias rejects public signup and accepts bootstrap token', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ladder-auth-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: isolatedEnv({ DATA_DIR: dir, PORT: String(port), ADMIN_ALIAS: 'Owner', ADMIN_SETUP_TOKEN: token, REQUIRE_VERIFY: '0' }),
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  const url = `http://127.0.0.1:${port}`;
  await waitUntilReady(url, child);
  const register = async (alias, adminSetupToken, email) => {
    const res = await fetch(`${url}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, adminSetupToken, email, password: 'a-long-password-123', age13: true }),
    });
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await register('Owner', '', 'a@example.org')).status, 403);
  assert.equal((await register('Owner', 'wrong', 'a@example.org')).status, 403);
  assert.equal((await register('normal', '', 'normal@example.org')).status, 201);
  assert.equal((await register('Owner', token, 'owner@example.org')).status, 201);
  assert.equal((await register('Owner', token, 'other@example.org')).status, 409);
});


test('test environment removes inherited external-backup settings', () => {
  const polluted = {
    ...process.env,
    BACKUP_S3_ENDPOINT: 'http://127.0.0.1:1',
    BACKUP_S3_BUCKET: 'production-looking-bucket',
    BACKUP_S3_KEY_ID: 'fake-id',
    BACKUP_S3_SECRET: 'fake-secret',
    BACKUP_S3_PREFIX: 'ladder/',
  };
  const safe = isolatedEnv({ DATA_DIR: '/tmp/isolated-fixture' }, polluted);
  assert.equal(Object.keys(safe).some((key) => key.startsWith('BACKUP_S3_')), false);
  assert.equal(safe.DATA_DIR, '/tmp/isolated-fixture');
});

test('a stale restore temporary file never blocks recovery from an isolated mock S3', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ladder-restore-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'fixture.db');
  const seed = new DatabaseSync(source);
  seed.exec('CREATE TABLE recovery_test (id INTEGER PRIMARY KEY, value TEXT)');
  seed.prepare('INSERT INTO recovery_test (value) VALUES (?)').run('test-data');
  seed.close();
  const archive = gzipSync(readFileSync(source));

  const mock = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.endsWith('/ladder-latest.sqlite.gz')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(archive);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const port = await listen(mock);
  t.after(() => new Promise((resolve) => mock.close(resolve)));

  // Simula un proceso anterior interrumpido antes de renombrar su temporal.
  writeFileSync(path.join(dir, 'ladder.db.restore-tmp'), 'abandoned-attempt');
  const result = await restoreAsync({
    DATA_DIR: dir, ALLOW_EMPTY_DB: '0',
    BACKUP_S3_ENDPOINT: 'http://127.0.0.1:' + port,
    BACKUP_S3_BUCKET: 'fake-bucket',
    BACKUP_S3_KEY_ID: 'fake-key',
    BACKUP_S3_SECRET: 'fake-secret',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /restaurada/);
  assert.deepEqual(readFileSync(path.join(dir, 'ladder.db')), readFileSync(source));
  assert.equal(readFileSync(path.join(dir, 'ladder.db.restore-tmp'), 'utf8'), 'abandoned-attempt');
});

test('shutdown of a test server cannot upload to inherited mock S3', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ladder-shutdown-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const writes = [];
  const mock = http.createServer((req, res) => {
    if (req.method === 'PUT') writes.push(req.url);
    res.writeHead(200);
    res.end();
  });
  const mockPort = await listen(mock);
  t.after(() => new Promise((resolve) => mock.close(resolve)));

  const polluted = {
    ...process.env,
    BACKUP_S3_ENDPOINT: 'http://127.0.0.1:' + mockPort,
    BACKUP_S3_BUCKET: 'fake-bucket',
    BACKUP_S3_KEY_ID: 'fake-key',
    BACKUP_S3_SECRET: 'fake-secret',
  };
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: isolatedEnv({ DATA_DIR: dir, PORT: String(port), ADMIN_ALIAS: 'Owner', ADMIN_SETUP_TOKEN: token, REQUIRE_VERIFY: '0' }, polluted),
    stdio: 'ignore',
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  await waitUntilReady('http://127.0.0.1:' + port, child);
  const stopped = new Promise((resolve) => child.once('close', resolve));
  child.kill('SIGTERM');
  await stopped;
  assert.deepEqual(writes, [], 'no external PUT to the mock backup endpoint');
});
