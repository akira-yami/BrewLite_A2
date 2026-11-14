import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import pg from '../apps/api/node_modules/pg/lib/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// Load env
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(resolve(rootDir, 'apps/api/.env'));
  } catch {}
}

const dbUrl = process.env.DATABASE_URL || 'postgresql://brewlite:123456@localhost:5432/brewlite?schema=public';
const pool = new pg.Pool({ connectionString: dbUrl });

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const ordersOnly = process.env.PERF_ORDERS_ONLY === '1';
const database = new URL(dbUrl);
const api = new URL(BASE_URL);
const loopback = ['localhost', '127.0.0.1', '[::1]'];
if (!loopback.includes(database.hostname) || !loopback.includes(api.hostname) ||
    !/^(?:brewlite_(?:test|perf|foundation_smoke)(?:_|$)|[a-z0-9_]+_e2e$)/.test(database.pathname.slice(1))) {
  throw new Error('Phép đo ghi đơn yêu cầu API local và DATABASE_URL trỏ đến PostgreSQL test riêng.');
}
const CONCURRENCY = 20; // 20 client đồng thời theo SRS NFR-01
// 30 giây warm-up theo SRS NFR-01. PERF_WARMUP_MS chỉ dùng để chạy thử nhanh, không dùng khi lấy số liệu nghiệm thu.
const WARMUP_DURATION_MS = process.env.PERF_WARMUP_MS ? Number(process.env.PERF_WARMUP_MS) : 30 * 1000;
// Thời lượng đo chính thức cho từng endpoint
const MEASURE_DURATION_MS = process.env.PERF_DURATION_MS ? Number(process.env.PERF_DURATION_MS) : 60 * 1000;

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function newStats() {
  return {
    latencies: [],
    successLatencies: [],
    statusCodes: {},
    successCount: 0,
    errors4xx: 0,
    errors5xx: 0,
    timeouts: 0,
    errorSamples: {},
  };
}

// Lưu nội dung phản hồi lỗi đầu tiên của mỗi mã HTTP để chẩn đoán nguyên nhân 4xx/5xx.
async function captureErrorSample(res, bucket) {
  if (res.status < 400 || bucket[res.status] !== undefined) return;
  bucket[res.status] = '';
  try {
    bucket[res.status] = (await res.text()).slice(0, 500);
  } catch {}
}

async function login(username, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.data?.accessToken ?? null;
}

function calculatePercentiles(latencies) {
  if (latencies.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const getP = (p) => {
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return Number(sorted[idx].toFixed(2));
  };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: Number(sorted[0].toFixed(2)),
    avg: Number((sum / sorted.length).toFixed(2)),
    p50: getP(50),
    p90: getP(90),
    p95: getP(95),
    p99: getP(99),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

function getSystemMetrics() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    cpuModel: cpus[0]?.model || 'Unknown CPU',
    cpuCores: cpus.length,
    totalMemMB: Math.round(totalMem / (1024 * 1024)),
    usedMemMB: Math.round(usedMem / (1024 * 1024)),
    memUsagePercent: Number(((usedMem / totalMem) * 100).toFixed(1)),
    nodeVersion: process.version,
    platform: os.platform(),
    release: os.release(),
  };
}

async function runWorker(requestFn, durationMs, stats, stopSignal) {
  while (!stopSignal.stop) {
    const start = performance.now();
    try {
      const res = await requestFn();
      const elapsed = performance.now() - start;
      stats.latencies.push(elapsed);
      const code = res.status;
      await captureErrorSample(res, stats.errorSamples);
      stats.statusCodes[code] = (stats.statusCodes[code] || 0) + 1;
      if (code >= 200 && code < 300) {
        stats.successLatencies.push(elapsed);
      }
      if (code >= 500) {
        stats.errors5xx += 1;
      } else if (code >= 400) {
        stats.errors4xx += 1;
      } else if (code >= 200 && code < 300) {
        stats.successCount += 1;
      }
    } catch (err) {
      const elapsed = performance.now() - start;
      stats.latencies.push(elapsed);
      stats.timeouts += 1;
    }
  }
}

async function benchmarkEndpoint(name, requestFn, warmupMs, measureMs) {
  console.log(`\n======================================================`);
  console.log(` ĐO TẢI: ${name}`);
  console.log(` Điều kiện: 20 clients đồng thời | Warm-up: ${warmupMs / 1000}s | Đo: ${measureMs / 1000}s`);
  console.log(`======================================================`);

  // 1. Warm-up
  console.log(`[1/2] Đang warm-up ${warmupMs / 1000} giây với 20 clients...`);
  const warmupStats = newStats();
  const warmupSignal = { stop: false };
  const warmupWorkers = Array.from({ length: CONCURRENCY }, () => runWorker(requestFn, warmupMs, warmupStats, warmupSignal));
  await new Promise((r) => setTimeout(r, warmupMs));
  warmupSignal.stop = true;
  await Promise.all(warmupWorkers);
  console.log(`  Warm-up hoàn tất: ${warmupStats.latencies.length} requests đã gửi.`);

  // 2. Measure
  console.log(`[2/2] Bắt đầu đo chính thức ${measureMs / 1000} giây với 20 clients...`);
  const measureStats = newStats();
  const measureSignal = { stop: false };
  const startTime = new Date();
  const t0 = performance.now();

  const measureWorkers = Array.from({ length: CONCURRENCY }, () => runWorker(requestFn, measureMs, measureStats, measureSignal));
  await new Promise((r) => setTimeout(r, measureMs));
  measureSignal.stop = true;
  await Promise.all(measureWorkers);
  const totalDurationSec = (performance.now() - t0) / 1000;
  const endTime = new Date();

  const totalReqs = measureStats.latencies.length;
  const rps = Number((totalReqs / totalDurationSec).toFixed(1));
  const percentiles = calculatePercentiles(measureStats.latencies);
  const rawErrorRate = (measureStats.errors5xx + measureStats.timeouts) / (totalReqs || 1) * 100;
  const errorRate5xx = Number(rawErrorRate.toFixed(2));
  const successPercentiles = measureStats.successCount ? calculatePercentiles(measureStats.successLatencies) : null;
  const passLatency = successPercentiles !== null && successPercentiles.p95 < 500;
  const passErrorRate = rawErrorRate < 1.0;
  const passed = passLatency && passErrorRate && totalReqs > 0 && measureStats.successCount === totalReqs;

  const result = {
    endpoint: name,
    startTimeUTC: startTime.toISOString(),
    endTimeUTC: endTime.toISOString(),
    durationSeconds: Number(totalDurationSec.toFixed(2)),
    concurrency: CONCURRENCY,
    totalRequests: totalReqs,
    requestsPerSecond: rps,
    percentiles,
    successPercentiles,
    successCount: measureStats.successCount,
    statusCodes: measureStats.statusCodes,
    errorSamples: measureStats.errorSamples,
    errors5xx: measureStats.errors5xx,
    errors4xx: measureStats.errors4xx,
    timeouts: measureStats.timeouts,
    errorRate5xxPercent: errorRate5xx,
    thresholdP95: 500,
    thresholdErrorRate: 1.0,
    passLatency,
    passErrorRate,
    passed,
  };

  console.log(`----------------- KẾT QUẢ ĐO -----------------`);
  console.log(` Tổng số mẫu   : ${totalReqs} requests`);
  console.log(` Thông lượng    : ${rps} req/sec`);
  console.log(` Latency p50    : ${percentiles.p50} ms`);
  console.log(` Latency p90    : ${percentiles.p90} ms`);
  console.log(` p95 gộp        : ${percentiles.p95} ms`);
  console.log(` p95 2xx        : ${successPercentiles?.p95 ?? 'không có mẫu'} ms (Ngưỡng SRS: < 500 ms) -> ${passLatency ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(` Latency p99    : ${percentiles.p99} ms`);
  console.log(` Min / Max      : ${percentiles.min} ms / ${percentiles.max} ms`);
  console.log(` Mã phản hồi    :`, measureStats.statusCodes);
  if (Object.keys(measureStats.errorSamples).length) {
    console.log(` Mẫu phản hồi lỗi:`, measureStats.errorSamples);
  }
  console.log(` Lỗi 5xx/Timeout: ${measureStats.errors5xx + measureStats.timeouts} (${errorRate5xx}%, Ngưỡng SRS: < 1%) -> ${passErrorRate ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  console.log(` KẾT LUẬN       : ${passed ? '✅ ĐẠT MỤC TIÊU NFR-01' : '❌ CHƯA ĐẠT'}`);

  return result;
}

async function main() {
  console.log('================================================================');
  console.log('   CHƯƠNG TRÌNH ĐO TẢI HIỆU NĂNG API BREWLITE — SRS NFR-01');
  console.log('================================================================');
  const sysInfo = getSystemMetrics();
  console.log(`Hệ điều hành: ${sysInfo.platform} ${sysInfo.release}`);
  console.log(`CPU         : ${sysInfo.cpuModel} (${sysInfo.cpuCores} cores)`);
  console.log(`Bộ nhớ RAM  : ${sysInfo.usedMemMB} MB / ${sysInfo.totalMemMB} MB (${sysInfo.memUsagePercent}%)`);
  console.log(`Node.js     : ${sysInfo.nodeVersion}`);
  console.log(`API Host    : ${BASE_URL}`);

  const client = await pool.connect();
  let validProductId = '';
  let variantIds = [];
  let customerToken = '';
  const writerTokens = [];

  try {
    // Lấy 1 product ID thật
    const pRes = await client.query('SELECT id FROM products WHERE is_active = true ORDER BY id LIMIT 1');
    validProductId = pRes.rows[0]?.id;
    if (!validProductId) {
      throw new Error('DB test chưa có sản phẩm đang bán. Hãy chạy migration và seed trước.');
    }
    const detail = await fetch(`${BASE_URL}/products/${validProductId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!detail.ok) {
      throw new Error(`Kiểm tra trước khi đo: API trả HTTP ${detail.status} cho sản phẩm ${validProductId} lấy từ DB test. Kiểm tra API và script có dùng cùng DATABASE_URL và dữ liệu đã seed chưa.`);
    }
    await detail.body?.cancel();

    // Lấy các variant đang bán và có công thức để phân tải ngẫu nhiên, tránh 20 client cùng giành một món.
    // API coi variant không có công thức là OUT_OF_STOCK (409), nên chỉ dùng variant có công thức.
    const vRes = await client.query(`
      SELECT pv.id FROM product_variants pv
      WHERE pv.is_active = true
        AND EXISTS (SELECT 1 FROM recipe_items r WHERE r.product_variant_id = pv.id)
    `);
    variantIds = vRes.rows.map((r) => r.id);
    if (variantIds.length === 0) {
      throw new Error('Không có product_variants nào có công thức. Hãy chạy scripts/seed-perf-nfr01.mjs trước.');
    }
    const totalVariantsRes = await client.query('SELECT count(*)::int AS n FROM product_variants WHERE is_active = true');
    if (variantIds.length < totalVariantsRes.rows[0].n) {
      console.warn(`  ! Chỉ ${variantIds.length}/${totalVariantsRes.rows[0].n} variant có công thức. Hãy chạy lại seed để dữ liệu đo đủ 300 variant.`);
    }

    console.log(`- Valid Product ID: ${validProductId}`);
    console.log(`- Số variant có công thức (dùng để tạo đơn chuẩn bị cho đo thanh toán): ${variantIds.length}`);

    // Đăng nhập customer01 (đọc dữ liệu) và các perf_user_* (ghi đơn) để lấy JWT token.
    console.log('- Đang đăng nhập test users để lấy JWT token...');
    customerToken = await login('customer01', 'Customer@123');
    if (!customerToken) {
      throw new Error('Đăng nhập customer01 thất bại hoặc không nhận được accessToken!');
    }
    const writerUsers = ['customer01', 'perf_user_01', 'perf_user_02', 'perf_user_03', 'perf_user_04', 'perf_user_05'];
    for (const u of writerUsers) {
      const token = u === 'customer01' ? customerToken : await login(u, 'Customer@123');
      if (token) writerTokens.push(token);
      else console.warn(`  ! Không đăng nhập được ${u}, bỏ qua.`);
    }
    console.log(`  -> Lấy JWT token thành công cho ${writerTokens.length} tài khoản ghi đơn.`);

    // Ghi nhận trạng thái DB trước khi đo
    const [preProducts, preOrders, preStock] = await Promise.all([
      client.query('SELECT count(*) FROM products'),
      client.query('SELECT count(*) FROM orders'),
      client.query('SELECT sum(stock_quantity) as total_stock FROM ingredients'),
    ]);
    const preDbSnapshot = {
      productCount: parseInt(preProducts.rows[0].count, 10),
      orderCount: parseInt(preOrders.rows[0].count, 10),
      totalStock: preStock.rows[0].total_stock,
    };
    console.log('Trạng thái DB trước đo:', preDbSnapshot);

    const results = [];

    if (!ordersOnly) {
      // ROUTE 1: GET /products
      results.push(await benchmarkEndpoint(
        'GET /api/v1/products',
        () => fetch(`${BASE_URL}/products`),
        WARMUP_DURATION_MS,
        MEASURE_DURATION_MS,
      ));

      // ROUTE 2: GET /products/:id
      results.push(await benchmarkEndpoint(
        `GET /api/v1/products/${validProductId}`,
        () => fetch(`${BASE_URL}/products/${validProductId}`),
        WARMUP_DURATION_MS,
        MEASURE_DURATION_MS,
      ));

      // ROUTE 3: GET /orders/me (với JWT)
      results.push(await benchmarkEndpoint(
        'GET /api/v1/orders/me',
        () => fetch(`${BASE_URL}/orders/me`, {
          headers: { Authorization: `Bearer ${customerToken}` },
        }),
        WARMUP_DURATION_MS,
        MEASURE_DURATION_MS,
      ));

    }
    const createOrder = (token) => fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: [{ productVariantId: pickRandom(variantIds), quantity: 1, sugarLevel: 100, iceLevel: 100, toppingIds: [] }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    results.push(await benchmarkEndpoint(
      'POST /api/v1/orders',
      () => createOrder(pickRandom(writerTokens)),
      WARMUP_DURATION_MS,
      MEASURE_DURATION_MS,
    ));

    if (!ordersOnly) {
      // ROUTE 5: POST /payments (đo riêng bước khởi tạo VNPay).
      console.log(`\n======================================================`);
      console.log(` ĐO RIÊNG ROUTE PAYMENT: POST /api/v1/payments (VNPAY)`);
      console.log(`======================================================`);
      const paymentLatencies = [];
      const paymentStatuses = {};
      const paymentErrorSamples = {};
      const orderSetupErrorSamples = {};
      let orderSetupFailures = 0;
      let payment5xx = 0;
      const paymentSampleCount = 100;
      console.log(`Thực hiện chuỗi ${paymentSampleCount} giao dịch thanh toán (tạo order -> gọi payment)...`);

      // Chạy tuần tự (1 client): đo độ trễ thanh toán riêng, không để tranh chấp tồn kho làm nhiễu.
      for (let p = 0; p < paymentSampleCount; p++) {
        // Đơn và thanh toán phải cùng một tài khoản vì API kiểm tra quyền sở hữu đơn.
        const token = pickRandom(writerTokens);

        // 1. Tạo order (không tính vào số đo thanh toán)
        const ordRes = await createOrder(token);
        if (!ordRes.ok) {
          orderSetupFailures += 1;
          await captureErrorSample(ordRes, orderSetupErrorSamples);
          continue;
        }
        const ordData = await ordRes.json();
        const orderId = ordData.data?.id;
        if (!orderId) {
          orderSetupFailures += 1;
          continue;
        }

        // 2. Đo thanh toán. CreatePaymentDto dùng trường `method` (không phải `paymentMethod`).
        // Ngoài môi trường NODE_ENV=test, API chỉ chấp nhận VNPAY (PAYMENT_METHOD_UNSUPPORTED với phương thức khác).
        const tStart = performance.now();
        const payRes = await fetch(`${BASE_URL}/payments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `perf-${randomUUID()}`,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            orderId,
            method: 'VNPAY',
          }),
        });
        const tElapsed = performance.now() - tStart;
        paymentLatencies.push(tElapsed);
        const s = payRes.status;
        paymentStatuses[s] = (paymentStatuses[s] || 0) + 1;
        await captureErrorSample(payRes, paymentErrorSamples);
        if (s >= 500) payment5xx += 1;
      }
      if (orderSetupFailures > 0) {
        console.warn(`  ! ${orderSetupFailures}/${paymentSampleCount} lần tạo đơn chuẩn bị cho thanh toán thất bại:`, orderSetupErrorSamples);
      }
      if (Object.keys(paymentErrorSamples).length) {
        console.log('  Mẫu phản hồi lỗi thanh toán:', paymentErrorSamples);
      }

      const payPercentiles = calculatePercentiles(paymentLatencies);
      const paymentResult = {
        endpoint: 'POST /api/v1/payments (VNPay: tạo liên kết thanh toán)',
        note: 'Đo riêng theo yêu cầu SRS mục 2: tách biệt latency thanh toán khỏi API thông thường. Phương thức VNPAY; đo thời gian API tạo payment PROCESSING và liên kết thanh toán, không gồm bước khách thanh toán trên VNPay.',
        samples: paymentLatencies.length,
        orderSetupFailures,
        orderSetupErrorSamples,
        percentiles: payPercentiles,
        statusCodes: paymentStatuses,
        errorSamples: paymentErrorSamples,
        errors5xx: payment5xx,
        // Đạt khi có mẫu, mọi mẫu trả 2xx, không có lần tạo đơn chuẩn bị nào lỗi và không có 5xx.
        passed:
          paymentLatencies.length > 0 &&
          orderSetupFailures === 0 &&
          payment5xx === 0 &&
          Object.keys(paymentStatuses).every((status) => Number(status) >= 200 && Number(status) < 300),
      };
      results.push(paymentResult);
    }

    // Ghi nhận trạng thái DB sau khi đo
    const [postProducts, postOrders, postStock] = await Promise.all([
      client.query('SELECT count(*) FROM products'),
      client.query('SELECT count(*) FROM orders'),
      client.query('SELECT sum(stock_quantity) as total_stock FROM ingredients'),
    ]);
    const postDbSnapshot = {
      productCount: parseInt(postProducts.rows[0].count, 10),
      orderCount: parseInt(postOrders.rows[0].count, 10),
      totalStock: postStock.rows[0].total_stock,
    };
    console.log('\nTrạng thái DB sau đo:', postDbSnapshot);
    console.log(`Số đơn hàng mới tạo ra trong lượt đo: ${postDbSnapshot.orderCount - preDbSnapshot.orderCount}`);

    // Lưu kết quả JSON
    const evidenceDir = resolve(rootDir, 'docs/evidence/perf');
    mkdirSync(evidenceDir, { recursive: true });
    const fullReport = {
      testRunAtUTC: new Date().toISOString(),
      system: sysInfo,
      databaseBefore: preDbSnapshot,
      databaseAfter: postDbSnapshot,
      routes: results,
      allPassed: results.every((r) => r.passed),
    };
    // PERF_RESULTS_FILE cho phép chạy thử mà không ghi đè file bằng chứng chính thức.
    const resultsFile = process.env.PERF_RESULTS_FILE || (ordersOnly ? 'nfr-01-orders-20-clients.json' : 'nfr-01-results.json');
    writeFileSync(resolve(evidenceDir, resultsFile), JSON.stringify(fullReport, null, 2), 'utf-8');
    console.log(`\nĐã lưu kết quả đo thô vào: docs/evidence/perf/${resultsFile}`);

    return fullReport;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Lỗi khi chạy benchmark NFR-01:', err);
  process.exit(1);
});
