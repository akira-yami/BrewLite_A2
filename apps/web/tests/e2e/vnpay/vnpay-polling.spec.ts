// Kiểm tra chu kỳ tra cứu và điều kiện dừng khi có kết quả thanh toán.
import { enrichVnpayPaymentResponse } from '../helpers/vnpay-test-helper.js';
import { test, expect } from '../fixtures/vnpay-fixtures.js';
import { setupCartWithProduct, proceedToCheckout } from '../helpers/cart-helper.js';

test.describe('Tra cứu trạng thái VNPay', () => {
  test('Tra cứu trạng thái mỗi 5 giây', async ({
    page,
    testUser,
  }) => {
    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);

    const paymentPromise = page.waitForResponse(
      (response) =>
        response.url().includes('/payments') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Thanh toán / }).click();
    await paymentPromise;

    await expect(page.getByRole('heading', { name: 'Đang chờ xác nhận thanh toán' })).toBeVisible();
    // The Return page restores status, then the pending screen polls immediately.
    // Measure recurring requests after startup, without response latency skew.
    const statusRequests: number[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/payments/status')) statusRequests.push(Date.now());
    });
    await expect.poll(() => statusRequests.length, { timeout: 20000 }).toBeGreaterThanOrEqual(3);
    const interval = statusRequests.at(-1)! - statusRequests.at(-2)!;
    expect(interval).toBeGreaterThan(4000);
    expect(interval).toBeLessThan(6000);
  });

  test('Dừng tra cứu khi trạng thái SUCCEEDED', async ({
    page,
    request,
    vnpayHelper,
    testUser,
  }) => {
    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);

    const paymentPromise = page.waitForResponse(
      (response) =>
        response.url().includes('/payments') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Thanh toán / }).click();

    const paymentResponse = await paymentPromise;
    const paymentData = enrichVnpayPaymentResponse(undefined, paymentResponse);
    const { gatewayReference, amount } = paymentData.data;

    await page.waitForTimeout(2000);

    await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
    });

    await page.waitForURL(/\/orders\/confirmation/, { timeout: 15000 });

    let statusRequestsAfterSuccess = 0;
    page.on('response', (response) => {
      if (response.url().includes('/payments/status')) {
        statusRequestsAfterSuccess++;
      }
    });

    await page.waitForTimeout(10000);

    expect(statusRequestsAfterSuccess).toBe(0);
  });

  test('Dừng tra cứu khi trạng thái FAILED', async ({
    page,
    request,
    vnpayHelper,
    testUser,
  }) => {
    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);

    const paymentPromise = page.waitForResponse(
      (response) =>
        response.url().includes('/payments') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Thanh toán / }).click();

    const paymentResponse = await paymentPromise;
    const paymentData = enrichVnpayPaymentResponse(undefined, paymentResponse);
    const { gatewayReference, amount } = paymentData.data;

    await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '07',
      transactionStatus: '02',
    });

    const errorAlert = page.getByRole('main').getByRole('alert');
    await expect(errorAlert).toContainText('Thanh toán chưa thành công', { timeout: 15000 });

    let statusRequestsAfterFailure = 0;
    page.on('request', (request) => {
      if (request.url().includes('/payments/status')) statusRequestsAfterFailure += 1;
    });
    // Observe more than one polling interval after the terminal state.
    await page.waitForTimeout(6000);
    expect(statusRequestsAfterFailure).toBe(0);
  });

  test('Gửi đúng header Idempotency-Key khi tra cứu', async ({
    page,
    testUser,
  }) => {
    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);

    let paymentKey: string | null = null;
    const statusKeys: string[] = [];

    page.on('response', async (response) => {
      if (
        response.url().includes('/payments') &&
        response.request().method() === 'POST'
      ) {
        paymentKey = response.request().headers()['idempotency-key'];
      }
      if (response.url().includes('/payments/status')) {
        statusKeys.push(response.request().headers()['idempotency-key']);
      }
    });

    const paymentPromise = page.waitForResponse(
      (response) =>
        response.url().includes('/payments') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Thanh toán / }).click();
    await paymentPromise;

    await page.waitForTimeout(10000);

    expect(paymentKey).toBeTruthy();
    expect(statusKeys.length).toBeGreaterThan(0);

    for (const key of statusKeys) {
      expect(key).toBe(paymentKey);
    }
  });
});
