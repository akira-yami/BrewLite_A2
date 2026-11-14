// Kiểm tra khôi phục thanh toán sau mất mạng hoặc quay lại checkout.
import { enrichVnpayPaymentResponse } from '../helpers/vnpay-test-helper.js';
import { test, expect } from '../fixtures/vnpay-fixtures.js';
import { setupCartWithProduct, proceedToCheckout } from '../helpers/cart-helper.js';

test.describe('Khôi phục VNPay sau mất mạng', () => {
  test('Khách quay lại sau nhiều giờ và khôi phục thanh toán', async ({
    page,
    request,
    vnpayHelper,
    testUser,
    apiUrl,
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
    const { gatewayReference, orderId, amount } = paymentData.data;

    await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
    });

    await page.waitForTimeout(2000);

    const recoveryButton = page.getByRole('button', {
      name: /Kiểm tra/,
    });

    if (await recoveryButton.isVisible({ timeout: 5000 })) {
      await recoveryButton.click();
    }

    await page.waitForURL(/\/orders\/confirmation/, { timeout: 15000 });

    const orderResponse = await request.get(apiUrl + '/orders/' + orderId, {
      headers: { Authorization: 'Bearer ' + testUser.accessToken },
    });
    const orderData = await orderResponse.json();
    expect(orderData.data.status).toBe('PAID');
  });

  test('Giữ trạng thái PROCESSING khi quay lại checkout', async ({
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
    const paymentResponse = await paymentPromise;
    const idempotencyKey = paymentResponse.request().headers()['idempotency-key'];
    await page.waitForURL(/\/checkout\?paymentReturn=1/, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Đang chờ xác nhận thanh toán' })).toBeVisible();
    const currentUrl = page.url();

    await page.goto('/menu');

    let replayPosts = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/payments') && request.method() === 'POST') replayPosts += 1;
    });
    const restoredStatusPromise = page.waitForResponse((response) =>
      response.url().includes('/payments/status') &&
      response.request().headers()['idempotency-key'] === idempotencyKey,
    );
    await page.goto(currentUrl);

    const restoredStatus = await restoredStatusPromise;
    expect(restoredStatus.ok()).toBeTruthy();
    expect((await restoredStatus.json()).data.status).toBe('PROCESSING');
    await expect(page.getByRole('heading', { name: 'Đang chờ xác nhận thanh toán' })).toBeVisible();
    expect(replayPosts, 'Restoring checkout must reuse the existing payment').toBe(0);
  });

  test('Tra cứu phát hiện thanh toán thành công đến muộn', async ({
    page,
    request,
    vnpayHelper,
    testUser,
    apiUrl,
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
    const { gatewayReference, orderId, amount } = paymentData.data;

    await page.waitForTimeout(3000);

    await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
    });

    const recoveryButton = page.getByRole('button', {
      name: /Kiểm tra/,
    });

    if (await recoveryButton.isVisible({ timeout: 5000 })) {
      await recoveryButton.click();
      await page.waitForURL(/\/orders\/confirmation/, { timeout: 15000 });
    }

    const orderResponse = await request.get(apiUrl + '/orders/' + orderId, {
      headers: { Authorization: 'Bearer ' + testUser.accessToken },
    });
    const orderData = await orderResponse.json();
    expect(orderData.data.status).toBe('PAID');
  });
});
