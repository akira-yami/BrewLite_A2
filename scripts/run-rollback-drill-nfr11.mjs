import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Client } = require('../apps/api/node_modules/pg');

const source = process.env.NFR11_SOURCE_DATABASE_URL;
const target = process.env.NFR11_RESTORE_DATABASE_URL;
if (!source || !target) throw new Error('Set NFR11_SOURCE_DATABASE_URL and NFR11_RESTORE_DATABASE_URL to disposable local test databases.');
const sourceUrl = new URL(source);
const targetUrl = new URL(target);
for (const url of [sourceUrl, targetUrl]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/brewlite_test_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error('Use local databases named brewlite_test_*.');
  }
}
if (sourceUrl.pathname === targetUrl.pathname) throw new Error('Use distinct source and restore database names.');

async function queryStats(dbUrl) {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const orderRes = await client.query('SELECT count(*)::int as count FROM orders;');
  const orders = await client.query('SELECT id, order_number, status, total, created_at FROM orders ORDER BY id;');
  const productRes = await client.query('SELECT count(*)::int as count FROM products;');
  await client.end();
  return {
    orderCount: orderRes.rows[0].count,
    orders: orders.rows,
    productCount: productRes.rows[0].count,
  };
}

async function main() {
  const restoreClient = new Client({ connectionString: target });
  await restoreClient.connect();
  try {
    const { rows: [{ count }] } = await restoreClient.query(
      "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'",
    );
    if (count !== 0) throw new Error('Restore database must be empty.');
  } finally {
    await restoreClient.end();
  }

  const { mkdtempSync, rmSync } = fs;
  const { tmpdir } = await import('node:os');
  const temp = mkdtempSync(path.join(tmpdir(), 'brewlite-drill-'));
  try {
    const dump = path.join(temp, 'backup.dump');
    const before = await queryStats(source);
    execFileSync('pg_dump', ['--format=custom', '--file', dump, '--dbname', source]);
    execFileSync('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname', target, dump]);
    const after = await queryStats(target);
    const match = JSON.stringify(before) === JSON.stringify(after);
    console.log(JSON.stringify({ kind: 'database-restore', orderCountBefore: before.orderCount, orderCountAfter: after.orderCount, match }, null, 2));
    if (!match) process.exitCode = 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

await main();
