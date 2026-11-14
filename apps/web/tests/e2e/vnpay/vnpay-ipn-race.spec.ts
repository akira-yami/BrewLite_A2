// Kiểm tra callback đến sớm, trùng hoặc đồng thời với tra cứu.
import { enrichVnpayPaymentResponse } from '../helpers/vnpay-test-helper.js';
import { test, expect } from '../fixtures/vnpay-fixtures.js';
import { setupCartWithProduct, proceedToCheckout } from '../helpers/cart-helper.js';

test.describe('Callback IPN đến đồng thời hoặc trùng', () => {
  test('IPN đến trước khi khách quay lại và hiển thị thành công ngay', async ({
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

    const ipnResponse = await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
    });
    expect(ipnResponse.RspCode).toBe('00');

    await page.waitForURL(/\/orders\/confirmation\?orderId=/, {
      timeout: 15000,
    });

    await expect(
      page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn BrewLite' }),
    ).toBeVisible();

    const orderResponse = await request.get(apiUrl + '/orders/' + orderId, {
      headers: { Authorization: 'Bearer ' + testUser.accessToken },
    });
    const orderData = await orderResponse.json();
    expect(orderData.data.status).toBe('PAID');
  });

  test('Xử lý đúng khi nhận IPN trùng', async ({
    request,
    vnpayHelper,
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
    const paymentData = enrichVnpayPaymentResponse(undefined, paymentResponse);
    const { gatewayReference, amount } = paymentData.data;

    const firstIpn = await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
      transactionNo: 'VNPAY_DUPLICATE_TEST',
    });
    expect(firstIpn.RspCode).toBe('00');

    const secondIpn = await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
      transactionNo: 'VNPAY_DUPLICATE_TEST',
    });

    expect(secondIpn.RspCode).toBe('02');
  });

  test('Trạng thái thanh toán phản ánh cập nhật IPN trước khi tra cứu', async ({
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
    const { gatewayReference, amount } = paymentData.data;
    const idempotencyKey = paymentResponse.request().headers()['idempotency-key'];

    await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
    });

    await page.waitForTimeout(1000);

    const statusResponse = await request.get(apiUrl + '/payments/status', {
      headers: {
        Authorization: 'Bearer ' + testUser.accessToken,
        'Idempotency-Key': idempotencyKey,
      },
    });

    const statusData = await statusResponse.json();
    expect(statusData.data.status).toBe('SUCCEEDED');
  });
});
