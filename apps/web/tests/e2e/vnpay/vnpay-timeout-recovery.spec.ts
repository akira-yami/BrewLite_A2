// Kiểm tra khôi phục hoặc hủy đơn khi cổng thanh toán phản hồi chậm.
import { enrichVnpayPaymentResponse } from '../helpers/vnpay-test-helper.js';
import { test, expect } from '../fixtures/vnpay-fixtures.js';
import { setupCartWithProduct, proceedToCheckout } from '../helpers/cart-helper.js';

test.describe('Khôi phục VNPay sau khi quá thời gian chờ', () => {
  test('Checkout vẫn cho thao tác trên đơn khi đang chờ VNPay', async ({
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
    await expect(page.getByRole('button', { name: 'Hủy đơn đang chờ' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Kiểm tra trạng thái giao dịch' })).toBeEnabled();
  });

  test('Khôi phục thủ công khi thanh toán hoàn tất muộn', async ({
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
    }

    await page.waitForURL(/\/orders\/confirmation\?orderId=/, {
      timeout: 20000,
    });

    const orderResponse = await request.get(apiUrl + '/orders/' + orderId, {
      headers: { Authorization: 'Bearer ' + testUser.accessToken },
    });
    const orderData = await orderResponse.json();
    expect(orderData.data.status).toBe('PAID');
  });

  test('Hiện lỗi khi khôi phục thanh toán thất bại', async ({
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
  });

  test('Có thể hủy đơn đang chờ sau khi tải lại checkout', async ({
    page,
    request,
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
    const { data: { orderId } } = enrichVnpayPaymentResponse(undefined, await paymentPromise);
    await expect(page.getByRole('heading', { name: 'Đang chờ xác nhận thanh toán' })).toBeVisible();
    await page.reload();

    await page.getByRole('button', { name: 'Hủy đơn đang chờ' }).click();
    await expect(page.getByRole('heading', { name: 'Giỏ hàng đang trống' })).toBeVisible();
    const order = await request.get(`${apiUrl}/orders/${orderId}`, {
      headers: { Authorization: 'Bearer ' + testUser.accessToken },
    });
    expect((await order.json()).data.status).toBe('CANCELLED');
  });

  test('Thay đơn VNPay đang chờ và chỉ trả tiền các món còn lại', async ({ page, request, testUser, apiUrl, vnpayHelper }) => {
    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);
    const firstPayment = page.waitForResponse(response =>
      response.url().endsWith('/payments') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Thanh toán / }).click();
    const { data: { orderId, amount } } = enrichVnpayPaymentResponse(undefined, await firstPayment);
    await expect(page.getByRole('heading', { name: 'Đang chờ xác nhận thanh toán' })).toBeVisible();

    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);
    const nextAttempt = page.waitForResponse(response =>
      response.url().endsWith('/payments') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Thanh toán giỏ mới/ }).click();
    const { data: replacement } = enrichVnpayPaymentResponse(undefined, await nextAttempt);
    expect(replacement.amount).toBe(amount);
    await vnpayHelper.simulateIpn(request, {
      gatewayReference: replacement.gatewayReference, amount: BigInt(replacement.amount),
      responseCode: '00', transactionStatus: '00',
    });
    await page.waitForURL(/\/orders\/confirmation\?orderId=/);
    expect(new URL(page.url()).searchParams.get('orderId')).not.toBe(orderId);
    const previousOrder = await request.get(`${apiUrl}/orders/${orderId}`, {
      headers: { Authorization: 'Bearer ' + testUser.accessToken },
    });
    expect((await previousOrder.json()).data.status).toBe('CANCELLED');
  });
});
