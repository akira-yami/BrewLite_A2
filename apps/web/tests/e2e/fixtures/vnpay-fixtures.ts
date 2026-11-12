import { test as base } from '@playwright/test';
import { VnpayTestHelper, captureVnpayPaymentResponse, testVnpayCredentials } from '../helpers/vnpay-test-helper.js';
import { createTestUser, type TestUser } from '../helpers/auth-helper.js';

interface VnpayFixtures {
  vnpayHelper: VnpayTestHelper;
  testUser: TestUser;
  apiUrl: string;
}

export const test = base.extend<VnpayFixtures>({
  // Simulate the hosted payment gateway's browser round-trip. IPN is sent
  // separately through the signed test-only callback endpoint. Never navigate
  // to an external merchant in deterministic CI tests.
  page: async ({ page }, use) => {
    if (!process.env.E2E_EXTERNAL_BASE_URL) {
      // Record the real payment response before checkout navigates to VNPay.
      // Otherwise Chromium discards response.json() after leaving the page.
      await page.route('**/api/v1/payments', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
          await route.continue();
          return;
        }
        const upstream = await route.fetch();
        if (upstream.ok()) {
          try {
            captureVnpayPaymentResponse(
              request.headers()['idempotency-key'],
              await upstream.json(),
            );
          } catch {
            // Non-JSON responses must still be forwarded intact to the app.
          }
        }
        await route.fulfill({ response: upstream });
      });
      const baseUrl = 'http://localhost:' + (process.env.E2E_WEB_PORT ?? '3100');
      await page.route(/^https:\/\/sandbox\.vnpayment\.vn\/paymentv2\/vpcpay\.html(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 302,
          headers: { location: new URL('/checkout?paymentReturn=1', baseUrl).toString() },
          body: '',
        });
      });
    }
    await use(page);
  },
  apiUrl: async ({}, use) => {
    const port = process.env.E2E_API_PORT ?? '3101';
    const url = process.env.E2E_API_URL ?? `http://localhost:${port}/api/v1`;
    await use(url);
  },

  vnpayHelper: async ({ apiUrl }, use) => {
    // Load VNPAY credentials from env
    const local = !process.env.E2E_EXTERNAL_BASE_URL;
    const hashSecret = process.env.VNPAY_HASH_SECRET ?? (local ? testVnpayCredentials.hashSecret : undefined);
    const tmnCode = process.env.VNPAY_TMN_CODE ?? (local ? testVnpayCredentials.tmnCode : undefined);

    // Skip tests gracefully when sandbox credentials are not configured
    if (!hashSecret || !tmnCode) {
      test.skip(true, 'VNPAY credentials not configured — set VNPAY_TMN_CODE and VNPAY_HASH_SECRET secrets');
      return;
    }

    // Create helper instance
    const helper = new VnpayTestHelper(apiUrl, hashSecret, tmnCode);
    await use(helper);
  },

  testUser: async ({ request, apiUrl }, use) => {
    // Create test user for this test
    const user = await createTestUser(request, apiUrl);
    await use(user);
    // No cleanup - preserve audit trail
  },
});

export { expect } from '@playwright/test';
