// Kiểm tra callback VNPay hợp lệ, sai chữ ký hoặc bị sửa tham số.
import { enrichVnpayPaymentResponse } from '../helpers/vnpay-test-helper.js';
import { test, expect } from '../fixtures/vnpay-fixtures.js';
import { setupCartWithProduct, proceedToCheckout } from '../helpers/cart-helper.js';

test.describe('Xác minh chữ ký VNPay', () => {
  test('Chấp nhận chữ ký hợp lệ và hoàn tất thanh toán', async ({
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
    const { gatewayReference, paymentUrl, amount } = paymentData.data;

    expect(paymentUrl).toContain('sandbox.vnpayment.vn');
    expect(paymentUrl).toContain('vnp_SecureHash');

    const isValid = vnpayHelper.verifyPaymentUrl(paymentUrl);
    expect(isValid, 'Payment URL signature must be valid').toBe(true);

    const ipnResponse = await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '00',
      transactionStatus: '00',
    });

    expect(ipnResponse.RspCode).toBe('00');
    expect(ipnResponse.Message).toBe('Confirm Success');
  });

  test('Từ chối chữ ký sai tại IPN', async ({
    request,
    apiUrl,
  }) => {
    const invalidParams = new URLSearchParams({
      vnp_TxnRef: 'test-invalid-sig',
      vnp_Amount: '10000000',
      vnp_TmnCode: process.env.VNPAY_TMN_CODE || 'TEST',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: 'VNPAY_INVALID_' + Date.now(),
      vnp_BankCode: 'NCB',
      vnp_PayDate: new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14),
      vnp_OrderInfo: 'Invalid signature test',
      vnp_CurrCode: 'VND',
      vnp_SecureHash: 'invalid_signature_hash_123456789abcdef',
    });

    const ipnResponse = await request.post(
      apiUrl + '/payments/test/vnpay/simulate-ipn?' + invalidParams.toString()
    );

    const responseData = await ipnResponse.json();
    expect(responseData.RspCode).toBe('97');
    expect(responseData.Message).toMatch(/invalid signature/i);
  });

  test('Từ chối tham số bị chỉnh sửa khi xác minh chữ ký', async ({
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
    const paymentUrl = paymentData.data.paymentUrl;

    const url = new URL(paymentUrl);
    url.searchParams.set('vnp_Amount', '999999999');

    const tamperedUrl = url.toString();
    const isValid = vnpayHelper.verifyPaymentUrl(tamperedUrl);
    expect(isValid, 'Tampered URL signature must be invalid').toBe(false);

    expect(vnpayHelper.verifyPaymentUrl(paymentUrl)).toBe(true);
  });
});
