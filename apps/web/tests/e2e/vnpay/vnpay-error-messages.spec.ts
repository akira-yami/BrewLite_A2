// Kiểm tra tiếng Việt và cách hiển thị lỗi, số tiền, hướng dẫn thanh toán.
import { enrichVnpayPaymentResponse } from '../helpers/vnpay-test-helper.js';
import { test, expect } from '../fixtures/vnpay-fixtures.js';
import { setupCartWithProduct, proceedToCheckout } from '../helpers/cart-helper.js';

test.describe('Thông báo lỗi bằng tiếng Việt', () => {
  test('Báo không đủ số dư bằng tiếng Việt', async ({
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
      responseCode: '51',
      transactionStatus: '02',
    });

    await page.waitForTimeout(2000);

    const errorMessage = page.getByText(/số dư|hạn mức/i);
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
  });

  test('Liên kết VNPay hết hạn hiển thị lời nhắc thử lại bằng tiếng Việt', async ({
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
    const { data: { gatewayReference, amount } } = enrichVnpayPaymentResponse(undefined, await paymentPromise);
    await vnpayHelper.simulateIpn(request, {
      gatewayReference,
      amount: BigInt(amount),
      responseCode: '11',
      transactionStatus: '02',
    });
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Liên kết thanh toán VNPay đã hết hạn.');
    await expect(page.getByRole('button', { name: 'Thanh toán lại' })).toBeEnabled();
  });

  test('Định dạng số tiền có dấu phân cách hàng nghìn', async ({
    page,
    testUser,
  }) => {
    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);

    const amountText = await page
      .getByText(/\d{1,3}(\.\d{3})+/)
      .first()
      .textContent();

    expect(amountText).toMatch(/\d{1,3}(\.\d{3})+/);
  });

  test('Hiển thị hướng dẫn thanh toán bằng tiếng Việt', async ({
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

    // The payment POST redirects the browser; assertions must wait for the
    // Vietnamese waiting screen rather than inspecting the outgoing page.
    await page.waitForURL(/\/checkout\?paymentReturn=1/, { timeout: 15000 });
    await expect(
      page.getByRole('heading', { name: 'Đang chờ xác nhận thanh toán' }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText('Trang sẽ tự cập nhật khi BrewLite nhận được kết quả từ VNPay.'),
    ).toBeVisible();
  });

  test('Hiển thị nhãn nút bằng tiếng Việt', async ({
    page,
    testUser,
  }) => {
    await setupCartWithProduct(page, testUser.accessToken);
    await proceedToCheckout(page);

    await expect(page.getByRole('heading', { name: 'Thanh toán qua VNPay' })).toBeVisible();

    const payButton = page.getByRole('button', { name: /^Thanh toán / });
    await expect(payButton).toBeVisible();

    const buttonText = await payButton.textContent();
    expect(buttonText).toMatch(/Thanh toán/);
  });
});
