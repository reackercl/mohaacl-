const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const token = 'sample-only-administrator-bootstrap-token-12345';

function restore(env) {
  return spawnSync(process.execPath, ['restaurar.js'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
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
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_ALIAS: 'Owner', ADMIN_SETUP_TOKEN: token, REQUIRE_VERIFY: '0' },
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break;
    try { const res = await fetch(url); if (res.ok) { ready = true; break; } } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(ready, true, 'server started');
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
