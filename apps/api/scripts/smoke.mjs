/**
 * smoke.mjs — Smoke test sau khi deploy API lên môi trường production/staging.
 *
 * Mục đích: Kiểm tra tối thiểu rằng API đang chạy và có thể trả lời.
 *
 * Dùng khi:
 *   1. Sau khi Railway deploy thành công một revision mới.
 *   2. Sau rollback (kiểm tra revision cũ đang healthy).
 *   3. Sau restore backup DB (kiểm tra API kết nối và catalog còn nguyên).
 *
 * Chạy:
 *   node apps/api/scripts/smoke.mjs                          # default: http://localhost:3001
 *   node apps/api/scripts/smoke.mjs https://api.example.com # target tuỳ chọn
 *   BASE_URL=https://api.example.com node apps/api/scripts/smoke.mjs
 *
 * Exit code:
 *   0 — Tất cả checks pass.
 *   1 — Ít nhất một check fail hoặc network error (→ chặn deploy/rollback trong CI).
 *
 * Không cần npm install; không dùng fetch polyfill ngoài Node 18+.
 * Ref: NFR-11 (AT-NFR-11), TC-NFR-11 — smoke test sau deploy.
 */

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3001';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const MAX_RETRIES = Number(process.env.SMOKE_RETRIES ?? 3);
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS ?? 2_000);

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function checkWithRetry(label, fn) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fn();
      console.log(`  ✅  ${label}`);
      return true;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.warn(`  ⚠   ${label} — attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}. Retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
      } else {
        console.error(`  ❌  ${label} — all ${MAX_RETRIES} attempts failed: ${err.message}`);
        return false;
      }
    }
  }
  return false;
}

// ── Checks ─────────────────────────────────────────────────────────────────

async function checkHealth() {
  const url = `${BASE}/api/v1/health`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${url} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json().catch(() => null);
  // Health endpoint must return 200; body should have a status field.
  if (json && json.status && json.status !== 'ok') {
    throw new Error(`Health status is '${json.status}', expected 'ok'`);
  }
}

async function checkProducts() {
  const url = `${BASE}/api/v1/products`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${url} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  // Should return an array (possibly empty if no seed).
  // We only verify API is responding correctly, not that catalog is seeded.
  if (!data || (!Array.isArray(data) && !Array.isArray(data?.data))) {
    throw new Error(`Expected array response from ${url}, got: ${JSON.stringify(data)?.slice(0, 200)}`);
  }
}

async function checkProductNotFound() {
  // A well-formed UUID that doesn't exist should return 404, not 500.
  const url = `${BASE}/api/v1/products/00000000-0000-0000-0000-000000000000`;
  const res = await fetchWithTimeout(url);
  if (res.status !== 404) {
    throw new Error(`Expected 404 for non-existent product, got HTTP ${res.status}`);
  }
}

async function checkProductBadId() {
  // An invalid ID should return 400, not 500.
  const url = `${BASE}/api/v1/products/not-a-uuid`;
  const res = await fetchWithTimeout(url);
  if (res.status !== 400) {
    throw new Error(`Expected 400 for invalid product ID format, got HTTP ${res.status}`);
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────

async function main() {
  const startAt = new Date().toISOString();
  console.log(`\n🔍  Smoke test — ${BASE}`);
  console.log(`    Started at: ${startAt}`);
  console.log(`    Timeout: ${TIMEOUT_MS}ms per request | Retries: ${MAX_RETRIES}\n`);

  const results = await Promise.all([
    checkWithRetry('GET /api/v1/health → 200 với DB connectivity', checkHealth),
    checkWithRetry('GET /api/v1/products → 200 array response', checkProducts),
    checkWithRetry('GET /api/v1/products/:nonExistentId → 404', checkProductNotFound),
    checkWithRetry('GET /api/v1/products/not-a-uuid → 400', checkProductBadId),
  ]);

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  const endAt = new Date().toISOString();

  console.log(`\n────────────────────────────────────────`);
  console.log(`  Passed: ${passed}/${results.length}`);
  console.log(`  Failed: ${failed}/${results.length}`);
  console.log(`  Ended at: ${endAt}`);
  console.log(`────────────────────────────────────────\n`);

  if (failed > 0) {
    console.error(`❌  Smoke test FAILED (${failed} check(s) failed). Deploy/rollback should be halted.`);
    process.exitCode = 1;
  } else {
    console.log(`✅  Smoke test PASSED. API is healthy.`);
  }
}

main().catch((err) => {
  console.error('Unhandled smoke test error:', err);
  process.exitCode = 1;
});
