// Kiểm tra checkout VNPay thành công và xác nhận sau callback.
import { enrichVnpayPaymentResponse } from '../helpers/vnpay-test-helper.js';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/vnpay-fixtures.js';
import { setupCartWithProduct, proceedToCheckout } from '../helpers/cart-helper.js';

test('Luồng VNPay thành công: đặt món → thanh toán → xác nhận', async ({
  page,
  request,
  vnpayHelper,
  testUser,
  apiUrl,
}) => {
  // Step 1 & 2: Test user already created by fixture, setup cart
  await setupCartWithProduct(page, testUser.accessToken);
  await proceedToCheckout(page);

  // Step 3: Select VNPAY payment method
  await expect(page).toHaveURL(/\/checkout/);

  // Step 4: Click thanh toán and capture POST /payments response
  const paymentPromise = page.waitForResponse(
    (response) =>
      response.url().includes('/payments') &&
      response.request().method() === 'POST',
  );

  await page.getByRole('button', { name: /^Thanh toán / }).click();

  const paymentResponse = await paymentPromise;
  expect(paymentResponse.ok()).toBeTruthy();

  const paymentData = enrichVnpayPaymentResponse(undefined, paymentResponse);
  const { gatewayReference, orderId, amount } = paymentData.data;

  // Step 5: Verify payment URL has valid signature
  expect(paymentData.data.status).toBe('PROCESSING');

  const paymentUrl = paymentData.data.paymentUrl;
  expect(paymentUrl).toBeTruthy();
  expect(paymentUrl).toContain('sandbox.vnpayment.vn');

  const signatureValid = vnpayHelper.verifyPaymentUrl(paymentUrl);
  expect(signatureValid, 'Payment URL signature should be valid').toBe(true);

  // Step 6: Simulate successful IPN callback
  const ipnResponse = await vnpayHelper.simulateIpn(request, {
    gatewayReference,
    amount: BigInt(amount),
    responseCode: '00',
    transactionStatus: '00',
  });

  expect(ipnResponse.RspCode).toBe('00');
  expect(ipnResponse.Message).toBe('Confirm Success');

  // Step 7: Wait for polling to detect success → redirect
  await page.waitForURL(/\/orders\/confirmation\?orderId=/, {
    timeout: 15000,
  });

  const confirmationUrl = page.url();
  const urlParams = new URL(confirmationUrl).searchParams;
  const confirmedOrderId = urlParams.get('orderId');
  expect(confirmedOrderId).toBe(orderId);

  // Step 8: Verify order status PAID and cart cleared
  await expect(
    page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn BrewLite' }),
  ).toBeVisible();

  const orderResponse = await request.get(apiUrl + '/orders/' + orderId, {
    headers: { Authorization: 'Bearer ' + testUser.accessToken },
  });
  expect(orderResponse.ok()).toBeTruthy();

  const orderData = await orderResponse.json();
  expect(orderData.data.status).toBe('PAID');

  // Verify cart is cleared
  await page.goto('/checkout');
  await expect(
    page.getByRole('heading', { name: 'Giỏ hàng đang trống' }),
  ).toBeVisible();
});

test('Callback Sandbox có chữ ký xác nhận đơn ở lần tra cứu đầu', async ({ page, testUser, vnpayHelper }) => {
  test.skip(Boolean(process.env.E2E_EXTERNAL_BASE_URL), 'Uses the isolated Sandbox configuration');
  await page.route(/^https:\/\/sandbox\.vnpayment\.vn\/paymentv2\/vpcpay\.html\?/, async route => {
    const gateway = new URL(route.request().url()).searchParams;
    const destination = new URL(gateway.get('vnp_ReturnUrl')!);
    const result = {
      vnp_TmnCode: gateway.get('vnp_TmnCode')!,
      vnp_TxnRef: gateway.get('vnp_TxnRef')!,
      vnp_Amount: gateway.get('vnp_Amount')!,
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: randomUUID().replaceAll('-', ''),
    };
    destination.search = new URLSearchParams({ ...result, vnp_SecureHash: vnpayHelper.computeSignature(result) }).toString();
    await route.fulfill({ status: 302, headers: { location: destination.toString() }, body: '' });
  });

  await setupCartWithProduct(page, testUser.accessToken);
  await proceedToCheckout(page);
  const firstStatus = page.waitForResponse(response => response.url().endsWith('/payments/status'));
  await page.getByRole('button', { name: /^Thanh toán / }).click();

  const statusResponse = await firstStatus;
  expect((await statusResponse.json()).data).toMatchObject({ status: 'SUCCEEDED', success: true });
  await expect(page).toHaveURL(/\/orders\/confirmation\?orderId=/);
});
