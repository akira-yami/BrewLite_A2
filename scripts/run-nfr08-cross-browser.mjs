import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require('../apps/web/node_modules/@playwright/test');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.resolve('docs/evidence/cross-browser/screenshots');
const RESULTS_FILE = path.resolve('docs/evidence/cross-browser/nfr-08-results.json');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const MATRIX = [
  {
    id: 'chrome_desktop',
    browserName: 'Google Chrome',
    channel: 'chrome',
    type: 'chromium',
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    label: 'Chrome Desktop (1440x900)',
  },
  {
    id: 'chrome_mobile',
    browserName: 'Google Chrome',
    channel: 'chrome',
    type: 'chromium',
    viewport: { width: 375, height: 812 },
    isMobile: true,
    label: 'Chrome Mobile (375x812)',
  },
  {
    id: 'edge_desktop',
    browserName: 'Microsoft Edge',
    channel: 'msedge',
    type: 'chromium',
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    label: 'Edge Desktop (1440x900)',
  },
  {
    id: 'edge_mobile',
    browserName: 'Microsoft Edge',
    channel: 'msedge',
    type: 'chromium',
    viewport: { width: 375, height: 812 },
    isMobile: true,
    label: 'Edge Mobile (375x812)',
  },
  {
    id: 'firefox_desktop',
    browserName: 'Mozilla Firefox',
    channel: null,
    type: 'firefox',
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    label: 'Firefox Desktop (1440x900)',
  },
  {
    id: 'firefox_mobile',
    browserName: 'Mozilla Firefox',
    channel: null,
    type: 'firefox',
    viewport: { width: 375, height: 812 },
    isMobile: true,
    label: 'Firefox Mobile (375x812)',
  },
];

async function checkNoHorizontalOverflow(page) {
  return await page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const innerWidth = window.innerWidth;
    return scrollWidth <= innerWidth + 2; // Allow subpixel rounding
  });
}

async function runScenario(config) {
  console.log(`\n======================================================`);
  console.log(`Đang chạy kiểm thử: ${config.label}`);
  console.log(`======================================================`);

  const launcher = config.type === 'chromium'
    ? () => chromium.launch({ channel: config.channel, headless: true })
    : () => firefox.launch({ headless: true });

  const browser = await launcher();
  const contextOptions = {
    viewport: config.viewport,
  };
  if (config.isMobile && config.type === 'chromium') {
    contextOptions.isMobile = true;
    contextOptions.hasTouch = true;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const results = {
    id: config.id,
    label: config.label,
    browser: config.browserName,
    browserVersion: browser.version(),
    viewport: `${config.viewport.width}x${config.viewport.height}`,
    steps: {},
    passed: true,
  };

  try {
    // -------------------------------------------------------------------------
    // BƯỚC 1: MENU (/menu)
    // -------------------------------------------------------------------------
    console.log(`[1/7] Kiểm tra trang Menu...`);
    await page.goto(`${BASE_URL}/menu`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:has-text("Tùy chọn")', { timeout: 15000 });
    const noOverflowMenu = await checkNoHorizontalOverflow(page);
    const menuButtons = await page.locator('button:has-text("Tùy chọn")').count();

    const ssMenu = path.join(SCREENSHOT_DIR, `${config.id}_01_menu.png`);
    await page.screenshot({ path: ssMenu });

    results.steps.menu = {
      passed: noOverflowMenu && menuButtons > 0,
      noHorizontalOverflow: noOverflowMenu,
      catalogItemsFound: menuButtons,
      screenshot: ssMenu,
    };
    console.log(`  -> Menu items: ${menuButtons}, Không tràn ngang: ${noOverflowMenu}`);

    // -------------------------------------------------------------------------
    // BƯỚC 2: PRODUCT DETAIL MODAL
    // -------------------------------------------------------------------------
    console.log(`[2/7] Mở modal Chi tiết sản phẩm...`);
    await page.locator('button:has-text("Tùy chọn")').first().click();
    await page.waitForSelector('button:has-text("Thêm vào giỏ")', { timeout: 8000 });
    const modalVisible = await page.locator('button:has-text("Thêm vào giỏ")').isVisible();
    const noOverflowDetail = await checkNoHorizontalOverflow(page);

    const ssDetail = path.join(SCREENSHOT_DIR, `${config.id}_02_detail_modal.png`);
    await page.screenshot({ path: ssDetail });

    results.steps.detailModal = {
      passed: modalVisible && noOverflowDetail,
      modalOpened: modalVisible,
      noHorizontalOverflow: noOverflowDetail,
      screenshot: ssDetail,
    };
    console.log(`  -> Modal hiển thị: ${modalVisible}, Không tràn ngang: ${noOverflowDetail}`);

    // -------------------------------------------------------------------------
    // BƯỚC 3: CART & RELOAD PERSISTENCE
    // -------------------------------------------------------------------------
    console.log(`[3/7] Thêm vào giỏ và kiểm tra lưu trữ sau khi Reload...`);
    await page.locator('button:has-text("Thêm vào giỏ")').click();
    await page.waitForTimeout(600);

    const cartBeforeReload = await page.evaluate(() => {
      const raw = localStorage.getItem('brewlite_cart_storage');
      return raw ? JSON.parse(raw) : [];
    });

    const ssCart = path.join(SCREENSHOT_DIR, `${config.id}_03_cart.png`);
    await page.screenshot({ path: ssCart });

    // Reload page to test state persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    const cartAfterReload = await page.evaluate(() => {
      const raw = localStorage.getItem('brewlite_cart_storage');
      return raw ? JSON.parse(raw) : [];
    });

    const itemsCountBefore = Array.isArray(cartBeforeReload) ? cartBeforeReload.length : 0;
    const itemsCountAfter = Array.isArray(cartAfterReload) ? cartAfterReload.length : 0;
    const cartPersisted = itemsCountBefore > 0 && itemsCountAfter === itemsCountBefore;

    results.steps.cart = {
      passed: cartPersisted,
      itemsBeforeReload: itemsCountBefore,
      itemsAfterReload: itemsCountAfter,
      persistedAfterReload: cartPersisted,
      screenshot: ssCart,
    };
    console.log(`  -> Giỏ hàng trước reload: ${itemsCountBefore} món, sau reload: ${itemsCountAfter} món (Giữ nguyên: ${cartPersisted})`);

    // -------------------------------------------------------------------------
    // BƯỚC 4: AUTH FLOW & ACCESSIBILITY (/login)
    // -------------------------------------------------------------------------
    console.log(`[4/7] Kiểm tra Form Labels, Keyboard Accessibility và Đăng nhập...`);
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#username');

    // 4.1 Label associations
    const usernameLabel = await page.locator('label[for="username"]').innerText();
    const passwordLabel = await page.locator('label[for="password"]').innerText();
    const hasProperLabels = !!usernameLabel && !!passwordLabel;

    // 4.2 Keyboard navigation
    await page.focus('#username');
    await page.keyboard.press('Tab');
    const focusedAfterFirstTab = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Tab');
    const focusedAfterSecondTab = await page.evaluate(() => document.activeElement?.getAttribute('type'));
    const keyboardNavPass = focusedAfterFirstTab === 'password' && focusedAfterSecondTab === 'submit';

    // 4.3 Fill credentials & Login
    await page.fill('#username', 'customer01');
    await page.fill('#password', 'Customer@123');

    const ssLogin = path.join(SCREENSHOT_DIR, `${config.id}_04_login.png`);
    await page.screenshot({ path: ssLogin });

    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 10000 });
    await page.waitForTimeout(500);

    const tokenExists = await page.evaluate(() => !!localStorage.getItem('brewlite_token'));

    results.steps.auth = {
      passed: hasProperLabels && keyboardNavPass && tokenExists,
      hasProperLabels,
      keyboardNavPass,
      focusedAfterFirstTab,
      focusedAfterSecondTab,
      loginSucceeded: tokenExists,
      screenshot: ssLogin,
    };
    console.log(`  -> Labels hợp lệ: ${hasProperLabels}, Tab Navigation: ${keyboardNavPass}, Login OK: ${tokenExists}`);

    // -------------------------------------------------------------------------
    // BƯỚC 5: CHECKOUT (/checkout)
    // -------------------------------------------------------------------------
    console.log(`[5/7] Kiểm tra trang Checkout, Tràn ngang và Nút CTA...`);
    // Ensure cart has item
    const currentCart = await page.evaluate(() => localStorage.getItem('brewlite_cart_storage'));
    if (!currentCart || currentCart === '[]') {
      await page.goto(`${BASE_URL}/menu`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('button:has-text("Tùy chọn")');
      await page.locator('button:has-text("Tùy chọn")').first().click();
      await page.waitForSelector('button:has-text("Thêm vào giỏ")');
      await page.locator('button:has-text("Thêm vào giỏ")').click();
      await page.waitForTimeout(500);
    }

    await page.goto(`${BASE_URL}/checkout`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const noOverflowCheckout = await checkNoHorizontalOverflow(page);
    const ctaButton = page.locator('button').filter({ hasText: /Thanh toán/ }).first();
    const ctaVisible = await ctaButton.isVisible();
    const ctaBox = ctaVisible ? await ctaButton.boundingBox() : null;
    const ctaValid = ctaBox ? (ctaBox.width > 50 && ctaBox.height > 20) : false;

    const ssCheckout = path.join(SCREENSHOT_DIR, `${config.id}_05_checkout.png`);
    await page.screenshot({ path: ssCheckout });

    results.steps.checkout = {
      passed: noOverflowCheckout && ctaVisible && ctaValid,
      noHorizontalOverflow: noOverflowCheckout,
      ctaVisible,
      ctaValid,
      ctaBox,
      screenshot: ssCheckout,
    };
    console.log(`  -> Checkout không tràn ngang: ${noOverflowCheckout}, Nút CTA rõ ràng: ${ctaVisible && ctaValid}`);

    // -------------------------------------------------------------------------
    // BƯỚC 6: CONFIRMATION
    // -------------------------------------------------------------------------
    console.log(`[6/7] Kiểm tra trang Xác nhận đơn hàng...`);
    await page.goto(`${BASE_URL}/orders/confirmation`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const noOverflowConfirmation = await checkNoHorizontalOverflow(page);

    const ssConfirmation = path.join(SCREENSHOT_DIR, `${config.id}_06_confirmation.png`);
    await page.screenshot({ path: ssConfirmation });

    results.steps.confirmation = {
      passed: noOverflowConfirmation,
      noHorizontalOverflow: noOverflowConfirmation,
      screenshot: ssConfirmation,
    };
    console.log(`  -> Confirmation không tràn ngang: ${noOverflowConfirmation}`);

    // -------------------------------------------------------------------------
    // BƯỚC 7: ORDER HISTORY (/orders)
    // -------------------------------------------------------------------------
    console.log(`[7/7] Kiểm tra Lịch sử đơn hàng (/orders)...`);
    await page.goto(`${BASE_URL}/orders`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const noOverflowHistory = await checkNoHorizontalOverflow(page);

    const ssHistory = path.join(SCREENSHOT_DIR, `${config.id}_07_history.png`);
    await page.screenshot({ path: ssHistory });

    results.steps.history = {
      passed: noOverflowHistory,
      noHorizontalOverflow: noOverflowHistory,
      screenshot: ssHistory,
    };
    console.log(`  -> History không tràn ngang: ${noOverflowHistory}`);

    // Aggregate overall result
    results.passed = Object.values(results.steps).every(s => s.passed);
  } catch (err) {
    console.error(`  [LỖI] Kịch bản ${config.label} gặp lỗi:`, err.message);
    results.passed = false;
    results.error = err.message;
  } finally {
    await browser.close();
  }

  console.log(`Kết quả ${config.label}: ${results.passed ? '✅ ĐẠT' : '❌ KHÔNG ĐẠT'}`);
  return results;
}

async function main() {
  console.log('================================================================');
  console.log('  CHƯƠNG TRÌNH KIỂM THỬ CROSS-BROWSER & RESPONSIVE — NFR-08');
  console.log('  Browsers: Chrome, Edge, Firefox | Viewports: 375x812 & 1440x900');
  console.log('================================================================');

  const allResults = [];
  for (const config of MATRIX) {
    const res = await runScenario(config);
    allResults.push(res);
  }

  const overallPassed = allResults.every(r => r.passed);
  const summary = {
    testRunAtUTC: new Date().toISOString(),
    overallPassed,
    totalScenarios: allResults.length,
    passedScenarios: allResults.filter(r => r.passed).length,
    matrixResults: allResults,
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n================================================================`);
  console.log(`  TỔNG KẾT: ${summary.passedScenarios}/${summary.totalScenarios} KỊCH BẢN ĐẠT CHUẨN NFR-08`);
  console.log(`  Đã lưu kết quả chi tiết vào: ${RESULTS_FILE}`);
  console.log(`  Đã lưu screenshots vào: ${SCREENSHOT_DIR}`);
  console.log('================================================================');
}

main().catch(err => {
  console.error('Lỗi thực thi:', err);
  process.exit(1);
});
