import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const [workspace, postgresBin, worktreeSuffix = ''] = process.argv.slice(2);
assert(workspace && postgresBin, 'Pass the temporary worktree root and PostgreSQL bin directory.');
const root = resolve(workspace);
const api = 'http://127.0.0.1:55491';
const web = 'http://127.0.0.1:55492';
const db = 'postgresql://drill@127.0.0.1:55489/brewlite_test_rollback';
const restored = db.replace('test_rollback', 'test_restore');
const stable = join(root, 'stable' + worktreeSuffix);
const candidate = join(root, 'candidate' + worktreeSuffix);
const revision = cwd => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const evidence = { startedAt: new Date().toISOString(), environment: 'local isolated PostgreSQL and Node processes', stable: revision(stable), candidate: revision(candidate), phases: {} };
assert.equal(evidence.stable, execFileSync('git', ['rev-parse', 'v1.0.1^{commit}'], { encoding: 'utf8' }).trim());
assert.equal(evidence.candidate, execFileSync('git', ['rev-parse', 'v1.0.2^{commit}'], { encoding: 'utf8' }).trim());
assert.notEqual(evidence.stable, evidence.candidate);
const children = new Set();
const env = { ...process.env, DATABASE_URL: db, JWT_SECRET: randomUUID() + randomUUID(), WEB_ORIGIN: web, MOCK_PAYMENT_MODE: 'deterministic', VNPAY_ENABLED: 'false', HOSTNAME: '127.0.0.1' };

function run(cwd, ...args) {
  return execFileSync(process.execPath, args, { cwd, env, encoding: 'utf8' }).trim();
}
function postgres(binary, ...args) {
  return execFileSync(join(postgresBin, binary), args, { encoding: 'utf8' }).trim();
}
function sql(url, query) {
  return postgres('psql.exe', '-XAt', '-v', 'ON_ERROR_STOP=1', url, '-c', query);
}
function start(cwd, script, port) {
  const child = spawn(process.execPath, [script], { cwd, env: { ...env, PORT: String(port) }, stdio: 'ignore' });
  children.add(child);
  return child;
}
function startWeb(worktree) {
  const cwd = join(worktree, 'apps/web');
  cpSync(join(cwd, 'public'), join(cwd, '.next/standalone/public'), { recursive: true });
  cpSync(join(cwd, '.next/static'), join(cwd, '.next/standalone/.next/static'), { recursive: true });
  return start(cwd, '.next/standalone/server.js', 55492);
}
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  children.delete(child);
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    assert(child.exitCode === null && child.signalCode === null, 'Server exited before readiness: ' + url);
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.ok) return response.status;
    await setTimeout(500);
  }
  throw new Error('Readiness timed out: ' + url);
}
async function request(path, data, headers = {}) {
  const response = await fetch(api + '/api/v1' + path, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: data && JSON.stringify(data),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert(response.ok, path + ' returned ' + response.status + ': ' + JSON.stringify(result));
  return result.data;
}

const candidateApi = join(candidate, 'apps/api');
const stableApi = join(stable, 'apps/api');
try {
  run(candidateApi, 'node_modules/prisma/build/index.js', 'migrate', 'deploy');
  run(candidateApi, '--import=tsx', 'prisma/seed.ts');
  let apiProcess = start(candidateApi, 'dist/main.js', 55491);
  await ready(api + '/api/v1/health', apiProcess);
  const customer = await request('/auth/register', { username: 'drill_' + randomUUID().slice(0, 8), password: randomUUID() });
  const auth = { Authorization: 'Bearer ' + customer.accessToken };
  const variant = (await request('/products')).flatMap(product => product.variants).find(item => item.available);
  assert(variant, 'No available product variant.');
  const order = await request('/orders', { items: [{ productVariantId: variant.id, quantity: 1 }] }, auth);
  assert.equal((await request('/orders/' + order.id, undefined, auth)).status, 'PENDING');

  let started = Date.now();
  await stop(apiProcess);
  apiProcess = start(stableApi, 'dist/main.js', 55491);
  const health = await ready(api + '/api/v1/health', apiProcess);
  const smoke = run(process.cwd(), 'apps/api/scripts/smoke.mjs', api);
  assert.equal((await request('/orders/' + order.id, undefined, auth)).status, 'PENDING');
  evidence.phases.api = { from: evidence.candidate, to: evidence.stable, health, elapsedMs: Date.now() - started, orderId: order.id, orderStatus: 'PENDING', smoke };
  evidence.phases.gitTag = { fromTag: 'v1.0.2', toTag: 'v1.0.1', toSha: revision(stable), bootedFromTaggedBuild: true };

  const snapshot = url => sql(url, 'SELECT id, status FROM orders ORDER BY id');
  const before = snapshot(db);
  assert(before.includes(order.id));
  const dump = join(root, 'drill.backup');
  postgres('pg_dump.exe', '-Fc', '-f', dump, db);
  const migrations = join(candidateApi, 'prisma/migrations');
  const apply = (name, statement) => {
    const dir = join(migrations, name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'migration.sql'), statement + '\n');
    return run(candidateApi, 'node_modules/prisma/build/index.js', 'migrate', 'deploy');
  };
  const forwards = '20261114235900_drill_add_probe';
  const correction = '20261114235901_drill_remove_probe';
  const hasProbe = () => sql(db, "SELECT to_regclass('public.rollback_probe') IS NOT NULL");
  apply(forwards, 'CREATE TABLE rollback_probe (id integer PRIMARY KEY);');
  assert.equal(hasProbe(), 't');
  apply(correction, 'DROP TABLE rollback_probe;');
  assert.equal(hasProbe(), 'f');
  assert.equal(snapshot(db), before);
  postgres('pg_restore.exe', '--exit-on-error', '--single-transaction', '--no-owner', '-d', restored, dump);
  assert.equal(snapshot(restored), before);
  evidence.phases.database = { applied: forwards, compensatedBy: correction, probeRemoved: true, restoredOrderIdsAndStatusesMatch: true, ordersCompared: before.split('\n').length };

  if (process.env.ROLLBACK_API_DB_ONLY !== '1') {
    let webProcess = startWeb(candidate);
    await ready(web + '/menu', webProcess);
    started = Date.now();
    await stop(webProcess);
    webProcess = startWeb(resolve(process.env.ROLLBACK_STABLE_WEB ?? stable));
    evidence.phases.web = { from: evidence.candidate, to: evidence.stable, health: await ready(web + '/health', webProcess), menu: await ready(web + '/menu', webProcess), elapsedMs: Date.now() - started };
  }
  evidence.passed = true;
} finally {
  for (const child of children) await stop(child);
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(root, 'rollback-results.json'), JSON.stringify(evidence, null, 2) + '\n');
}
