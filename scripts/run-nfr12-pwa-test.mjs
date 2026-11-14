import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../apps/web/node_modules/@playwright/test');

const BASE_URL = process.env.PWA_BASE_URL ?? 'http://localhost:3000';
const EVIDENCE_DIR = path.resolve('docs/evidence/pwa');
const RESULTS_FILE = path.resolve('docs/evidence/pwa/nfr-12-pwa-results.json');

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

async function main() {
  console.log('================================================================');
  console.log('  CHƯƠNG TRÌNH KIỂM THỬ PWA KHI MẤT MẠNG & PHỤC HỒI — NFR-12');
  console.log('================================================================');

  const pwaResults = {
    testRunAtUTC: new Date().toISOString(),
    manifest: {},
    serviceWorker: {},
    offlineFlow: {},
    reconnectFlow: {},
    passed: true,
  };

  // 1. Kiểm tra Manifest
  console.log('\n[1/4] Kiểm tra Web App Manifest (manifest.json)...');
  const manifestPath = path.resolve('apps/web/src/app/manifest.json');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestRaw);

  const hasName = !!manifest.name && !!manifest.short_name;
  const hasStartUrl = !!manifest.start_url;
  const hasDisplayStandalone = manifest.display === 'standalone';
  const hasIcons = Array.isArray(manifest.icons) && manifest.icons.length >= 2;

  pwaResults.manifest = {
    name: manifest.name,
    short_name: manifest.short_name,
    start_url: manifest.start_url,
    display: manifest.display,
    iconsCount: manifest.icons?.length ?? 0,
    valid: hasName && hasStartUrl && hasDisplayStandalone && hasIcons,
  };
  console.log(`  -> Manifest hợp lệ: ${pwaResults.manifest.valid ? '✅ ĐẠT' : '❌ THIẾU THÔNG TIN'}`);

  // 2. Khởi chạy browser để kiểm tra Service Worker & Offline Simulation
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, // Mobile viewport per NFR-08/12
    isMobile: true,
  });
  const page = await context.newPage();

  try {
    // 2.1 Mở trang menu online
    console.log('\n[2/4] Tải ứng dụng ở trạng thái Online và thêm món vào giỏ...');
    await page.goto(`${BASE_URL}/menu`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:has-text("Tùy chọn")', { timeout: 10000 });

    // Thêm món vào giỏ
    await page.locator('button:has-text("Tùy chọn")').first().click();
    await page.waitForSelector('button:has-text("Thêm vào giỏ")');
    await page.locator('button:has-text("Thêm vào giỏ")').click();
    await page.waitForTimeout(600);

    const cartBeforeOffline = await page.evaluate(() => {
      const raw = localStorage.getItem('brewlite_cart_storage');
      return raw ? JSON.parse(raw) : [];
    });
    console.log(`  -> Giỏ hàng trước khi mất mạng: ${cartBeforeOffline.length} món`);

    // Kiểm tra Service Worker đăng ký
    const swRegistration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? { scope: reg.scope, active: !!reg.active } : null;
    });
    console.log('  -> Trạng thái Service Worker:', swRegistration);
    pwaResults.serviceWorker = {
      registered: !!swRegistration,
      scope: swRegistration?.scope,
      active: swRegistration?.active,
    };

    // 2.2 Giả lập Mất mạng (Network Loss)
    console.log('\n[3/4] Giả lập Mất kết nối Internet (setOffline = true)...');
    await context.setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await page.waitForTimeout(600);

    // Kiểm tra Banner cảnh báo ngoại tuyến
    const offlineBanner = page.locator('aside[role="alert"]').filter({ hasText: /ngoại tuyến|Mất kết nối/ });
    const bannerVisible = await offlineBanner.isVisible();
    const bannerText = bannerVisible ? await offlineBanner.innerText() : '';
    console.log(`  -> Cảnh báo ngoại tuyến hiển thị: ${bannerVisible}`);
    console.log(`  -> Nội dung cảnh báo: "${bannerText.trim().replace(/\n/g, ' ')}"`);

    // Kiểm tra giỏ hàng vẫn giữ nguyên trong LocalStorage khi mất mạng
    const cartDuringOffline = await page.evaluate(() => {
      const raw = localStorage.getItem('brewlite_cart_storage');
      return raw ? JSON.parse(raw) : [];
    });
    const cartSafeOffline = cartDuringOffline.length === cartBeforeOffline.length && cartBeforeOffline.length > 0;
    console.log(`  -> Giỏ hàng bảo toàn trong LocalStorage: ${cartSafeOffline ? '✅ NGUYÊN VẸN' : '❌ BỊ MẤT'}`);

    // Chụp ảnh màn hình trạng thái Offline
    const ssOffline = path.join(EVIDENCE_DIR, 'nfr-12-offline-banner.png');
    await page.screenshot({ path: ssOffline });
    console.log(`  -> Đã lưu ảnh chụp offline tại: ${ssOffline}`);

    pwaResults.offlineFlow = {
      bannerDisplayed: bannerVisible,
      bannerText: bannerText.trim(),
      cartItemsCount: cartDuringOffline.length,
      cartPreserved: cartSafeOffline,
      screenshot: ssOffline,
      passed: bannerVisible && cartSafeOffline,
    };

    // 2.3 Giả lập Có mạng trở lại (Reconnect)
    console.log('\n[4/4] Giả lập Phục hồi kết nối Internet (setOffline = false)...');
    await context.setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForTimeout(800);

    // Kiểm tra Banner thông báo phục hồi kết nối thành công (màu xanh lá)
    const reconnectBanner = page.locator('aside[role="status"]').filter({ hasText: /Đã khôi phục kết nối/ });
    const reconnectVisible = await reconnectBanner.isVisible();
    const reconnectText = reconnectVisible ? await reconnectBanner.innerText() : '';
    console.log(`  -> Thông báo phục hồi kết nối hiển thị: ${reconnectVisible ? '✅ ĐẠT' : '❌ CHƯA THẤY'}`);
    if (reconnectVisible) {
      console.log(`  -> Nội dung phục hồi: "${reconnectText.trim().replace(/\n/g, ' ')}"`);
    }

    // Chụp ảnh màn hình trạng thái Reconnect
    const ssReconnect = path.join(EVIDENCE_DIR, 'nfr-12-reconnect-banner.png');
    await page.screenshot({ path: ssReconnect });
    console.log(`  -> Đã lưu ảnh chụp reconnect tại: ${ssReconnect}`);

    // Kiểm tra dữ liệu giỏ sau khi online trở lại
    const cartAfterReconnect = await page.evaluate(() => {
      const raw = localStorage.getItem('brewlite_cart_storage');
      return raw ? JSON.parse(raw) : [];
    });
    const cartSafeAfterReconnect = cartAfterReconnect.length === cartBeforeOffline.length;

    pwaResults.reconnectFlow = {
      reconnectBannerDisplayed: reconnectVisible,
      cartItemsCount: cartAfterReconnect.length,
      cartPreserved: cartSafeAfterReconnect,
      screenshot: ssReconnect,
      passed: reconnectVisible && cartSafeAfterReconnect,
    };

    pwaResults.passed = pwaResults.manifest.valid &&
      pwaResults.offlineFlow.passed &&
      pwaResults.reconnectFlow.passed;

  } catch (err) {
    console.error('Lỗi kiểm thử PWA:', err.message);
    pwaResults.passed = false;
    pwaResults.error = err.message;
  } finally {
    await browser.close();
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(pwaResults, null, 2), 'utf-8');
  console.log('\n================================================================');
  console.log(`  KẾT LUẬN KIỂM THỬ NFR-12: ${pwaResults.passed ? '✅ ĐẠT 100%' : '❌ KHÔNG ĐẠT'}`);
  console.log(`  Đã lưu kết quả chi tiết vào: ${RESULTS_FILE}`);
  console.log('================================================================');
}

main().catch(err => {
  console.error('Lỗi:', err);
  process.exit(1);
});
