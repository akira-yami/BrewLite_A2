import { test, expect } from '../../apps/web/tests/e2e/fixtures/vnpay-fixtures';
import { addFirstAvailableProduct, proceedToCheckout } from '../../apps/web/tests/e2e/helpers/cart-helper';
import { enrichVnpayPaymentResponse } from '../../apps/web/tests/e2e/helpers/vnpay-test-helper';

test.skip(() => Boolean(process.env.E2E_EXTERNAL_BASE_URL), 'Ca này mô phỏng VNPay trong môi trường kiểm thử local');

test('khách đăng nhập từ menu, thanh toán và nhận mã xác nhận đơn', async ({
  page, request, testUser, apiUrl, vnpayHelper,
}) => {
  await page.goto('/menu');
  await page.getByRole('link', { name: 'Đăng nhập', exact: true }).first().click();
  await page.getByLabel('Tên đăng nhập').fill(testUser.username);
  await page.getByLabel('Mật khẩu').fill(testUser.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/menu$/);

  await addFirstAvailableProduct(page);
  await proceedToCheckout(page);
  const payment = page.waitForResponse(response =>
    response.url() === `${apiUrl}/payments` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Thanh toán / }).click();
  const paymentResponse = await payment;
  expect(paymentResponse.ok()).toBe(true);
  const { orderId, gatewayReference, amount } = enrichVnpayPaymentResponse(undefined, paymentResponse).data;
  const ipn = await vnpayHelper.simulateIpn(request, {
    gatewayReference,
    amount: BigInt(amount),
    responseCode: '00',
    transactionStatus: '00',
  });
  expect(ipn.RspCode).toBe('00');

  await expect(page).toHaveURL(url =>
    url.pathname === '/orders/confirmation' && url.searchParams.get('orderId') === orderId,
  );
  const orderResponse = await request.get(`${apiUrl}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${testUser.accessToken}` },
  });
  expect(orderResponse.ok()).toBe(true);
  const { data: order } = await orderResponse.json();
  expect(order.status).toBe('PAID');
  await expect(page.getByRole('heading', { name: 'Cảm ơn bạn đã chọn BrewLite' })).toBeVisible();
  await expect(page.getByRole('heading', { name: order.orderNumber, exact: true })).toBeVisible();
  await expect(page.getByText('Đã thanh toán', { exact: true })).toBeVisible();
});
