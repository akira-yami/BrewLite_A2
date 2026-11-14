// Kiểm tra luồng thanh toán VNPay giả lập và chống gửi lại khi bấm đúp hoặc tải lại.
import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures/vnpay-fixtures';
import { setupCartWithProduct, proceedToCheckout } from './helpers/cart-helper';
import { enrichVnpayPaymentResponse } from './helpers/vnpay-test-helper';

const api = process.env.E2E_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? '3101'}/api/v1`;

test('Menu → giỏ hàng → VNPay → xác nhận đơn', async ({ page, request, testUser, vnpayHelper }) => {
  await setupCartWithProduct(page, testUser.accessToken);
  await proceedToCheckout(page);
  const attempt = page.waitForResponse(r => r.url() === api + '/payments' && r.request().method() === 'POST');
  await page.getByRole('button', { name: /^Thanh toán / }).click();
  const { data: { orderId, gatewayReference, amount } } = enrichVnpayPaymentResponse(undefined, await attempt);
  const ipn = await vnpayHelper.simulateIpn(request, {
    gatewayReference, amount: BigInt(amount), responseCode: '00', transactionStatus: '00',
  });
  expect(ipn.RspCode).toBe('00');
  await expect(page).toHaveURL(new RegExp('/orders/confirmation\\?orderId=' + orderId));
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Giỏ hàng đang trống' })).toBeVisible();
});

test('Bấm đúp và tải lại tra cứu thanh toán, chỉ gửi lại POST khi chưa có bản ghi', async ({ page, request }) => {
  const registration = await request.post(`${api}/auth/register`, {
    data: {
      username: `e2e_pending_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
      password: 'E2e-password-123',
    },
  });
  expect(registration.ok()).toBeTruthy();
  const { data: { accessToken } } = await registration.json();

  await page.goto('/menu');
  await page.evaluate(token => localStorage.setItem('brewlite_token', token), accessToken);
  await page.reload();
  // ProductCard now opens ProductDetailModal through the "Tùy chọn" action;
  // the legacy "+ Thêm" button no longer exists on the menu cards.
  await page.locator('button:not(:disabled)')
    .filter({ hasText: 'Tùy chọn' })
    .first()
    .click();

  const addToCartButton = page.getByRole('button', { name: /Thêm vào giỏ/ });
  await expect(addToCartButton).toBeVisible();
  await expect(addToCartButton).toBeEnabled();
  await addToCartButton.click(); // onAddedToCart opens CartDrawer.
  await page.getByRole('button', { name: 'Tiến hành đặt & thanh toán' }).click();
  await expect(page).toHaveURL(/checkout/);

  const attempts: Array<{ orderId: string; key: string }> = [];
  let postCount = 0;
  await page.route(`${api}/payments`, async (route) => {
    const payload = route.request().postDataJSON();
    attempts.push({
      orderId: payload.orderId,
      key: route.request().headers()['idempotency-key'],
    });
    postCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (postCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            success: false,
            isRetried: false,
            status: 'PROCESSING',
            gatewayTransactionId: null,
            errorCode: null,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'PAYMENT_IN_PROGRESS', message: 'Giao dịch đang được xử lý.' },
      }),
    });
  });

  const statusKeys: string[] = [];
  let statusCount = 0;
  await page.route(`${api}/payments/status`, async (route) => {
    statusCount += 1;
    statusKeys.push(route.request().headers()['idempotency-key']);
    if (statusCount === 1) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'PAYMENT_NOT_FOUND', message: 'Chưa có bản ghi Payment.' },
        }),
      });
      return;
    }
    const status = statusCount === 2 ? 'PROCESSING' : 'SUCCEEDED';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          success: status === 'SUCCEEDED',
          isRetried: true,
          status,
          gatewayTransactionId: status === 'SUCCEEDED' ? 'MOCK_E2E_RECOVERED' : null,
          errorCode: null,
        },
      }),
    });
  });

  const payButton = page.getByRole('button', { name: /^Thanh toán / });
  await payButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await page.waitForResponse(response => response.url() === `${api}/payments` && response.request().method() === 'POST');
  await expect(page.getByRole('button', { name: 'Kiểm tra trạng thái giao dịch' })).toBeVisible();
  expect(attempts).toHaveLength(1);

  await page.reload();
  const checkButton = page.getByRole('button', { name: 'Kiểm tra trạng thái giao dịch' });
  await expect(checkButton).toBeVisible();

  const missingStatus = page.waitForResponse(response =>
    response.url() === `${api}/payments/status` && response.status() === 404,
  );
  const sameKeyReplay = page.waitForResponse(response =>
    response.url() === `${api}/payments` && response.request().method() === 'POST' && response.status() === 409,
  );
  await checkButton.click();
  await Promise.all([missingStatus, sameKeyReplay]);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);

  const processingStatus = page.waitForResponse(response =>
    response.url() === `${api}/payments/status` && response.status() === 200,
  );
  await checkButton.click();
  await processingStatus;
  expect(attempts).toHaveLength(2);

  const succeededStatus = page.waitForResponse(response =>
    response.url() === `${api}/payments/status` && response.status() === 200,
  );
  await checkButton.click();
  await succeededStatus;
  await expect(page).toHaveURL(/\/orders\/confirmation\?orderId=/);
  expect(attempts).toHaveLength(2);
  expect(statusKeys).toHaveLength(3);
  expect(statusKeys.every(key => key === attempts[0]?.key)).toBe(true);
});
