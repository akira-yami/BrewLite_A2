import { defineConfig, devices } from '@playwright/test';
import { testVnpayCredentials } from './tests/e2e/helpers/vnpay-test-helper';

const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const apiPort = Number(process.env.E2E_API_PORT ?? 3101);
const webUrl = `http://localhost:${webPort}`;
const apiUrl = `http://localhost:${apiPort}`;
const mobileChromium = { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } };

// Dùng port riêng; không vô tình kiểm tra server dev đang chạy trên 3000/3001.
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.E2E_EXTERNAL_BASE_URL ?? webUrl, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['vnpay/**', 'delivery/**'],
      use: mobileChromium,
    },
    {
      name: 'delivery',
      testDir: './tests/e2e/delivery',
      use: mobileChromium,
    },
    {
      name: 'vnpay',
      testMatch: ['vnpay/**'],
      use: mobileChromium,
    },
  ],
  webServer: process.env.E2E_EXTERNAL_BASE_URL ? undefined : [
    {
      command: 'npm --prefix ../api run start:dev',
      url: `${apiUrl}/api/v1/health`,
      env: {
        NODE_ENV: 'test',
        PORT: String(apiPort),
        WEB_ORIGIN: webUrl,
        MOCK_PAYMENT_MODE: 'deterministic',
        VNPAY_ENABLED: 'true',
        VNPAY_PAYMENT_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
        VNPAY_TMN_CODE: process.env.VNPAY_TMN_CODE ?? testVnpayCredentials.tmnCode,
        VNPAY_HASH_SECRET: process.env.VNPAY_HASH_SECRET ?? testVnpayCredentials.hashSecret,
        VNPAY_RETURN_URL: `${apiUrl}/api/v1/payments/vnpay/return`,
        VNPAY_IPN_URL: 'https://e2e.invalid/api/v1/payments/vnpay/ipn',
      },
      reuseExistingServer: false,
    },
    {
      command: `npx next dev -p ${webPort}`,
      url: `${webUrl}/menu`,
      env: {
        NEXT_PUBLIC_API_URL: `${apiUrl}/api/v1`,
        NEXT_PUBLIC_API_BASE_URL: `${apiUrl}/api/v1`,
      },
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
