// Kiểm tra checkout khôi phục đơn đã thanh toán khi trạng thái trả về chậm hoặc khóa đã cũ.
import { expect, test } from '@playwright/test';

const orderId = 'paid-recovery-order';
const savedKey = 'previous-payment-key';

test.beforeEach(async ({ page }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  await page.addInitScript(({ token, orderId, savedKey }) => {
    localStorage.setItem('brewlite_token', token);
    if (location.pathname === '/checkout') {
      sessionStorage.setItem('brewlite_pending_checkout', JSON.stringify({
        orderId, idempotencyKey: savedKey, method: 'VNPAY', cartFingerprint: '[]', cartItemsRemoved: true,
      }));
    }
  }, { token: `e30.${payload}.test`, orderId, savedKey });
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { data: {
    id: 'customer', username: 'customer', isActive: true, role: 'CUSTOMER',
  } } }));
});

test('Khôi phục đơn đã hoàn tất dù khóa lưu trên máy đã cũ', async ({ page }) => {
  let paymentPosts = 0;
  await page.route('**/api/v1/payments', async route => {
    paymentPosts++;
    await route.abort();
  });
  await page.route(`**/api/v1/orders/${orderId}`, route => route.fulfill({ json: order('COMPLETED') }));

  await page.goto('/checkout');
  await expectConfirmation(page);
  expect(paymentPosts).toBe(0);
});

test('Xác nhận đơn đã trả tiền trong lúc thử lại với cùng khóa', async ({ page }) => {
  let status = 'PENDING';
  await page.route(`**/api/v1/orders/${orderId}`, route => route.fulfill({ json: order(status) }));
  await page.route('**/api/v1/payments/status', route => route.fulfill({
    status: 404, json: { code: 'PAYMENT_NOT_FOUND' },
  }));
  const replayKeys: string[] = [];
  await page.route('**/api/v1/payments', async route => {
    replayKeys.push(route.request().headers()['idempotency-key']);
    status = 'PAID';
    await route.fulfill({ status: 409, json: { code: 'ORDER_ALREADY_PAID' } });
  });

  await page.goto('/checkout');
  await page.getByRole('button', { name: 'Kiểm tra trạng thái giao dịch' }).click();
  await expectConfirmation(page);
  expect(replayKeys).toEqual([savedKey]);
});

test('Tiếp tục tra cứu đơn khi VNPay trả về nhưng trạng thái thanh toán chưa có', async ({ page }) => {
  let status = 'PENDING';
  let paymentPosts = 0;
  await page.route('**/api/v1/payments', async route => {
    paymentPosts++;
    await route.abort();
  });
  await page.route(`**/api/v1/orders/${orderId}`, route => route.fulfill({ json: order(status) }));
  await page.route('**/api/v1/payments/status', route => route.fulfill({ status: 503, json: {} }));

  await page.goto('/checkout?paymentReturn=1');
  await expect(page.getByRole('heading', { name: 'Đang chờ xác nhận thanh toán' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('brewlite_pending_checkout'))).toContain(savedKey);
  await page.getByRole('button', { name: 'Kiểm tra trạng thái giao dịch' }).click();
  await expect(page.getByText('Chưa xác định được kết quả thanh toán.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('brewlite_pending_checkout'))).toContain(savedKey);

  status = 'PREPARING';
  await expectConfirmation(page);
  expect(paymentPosts).toBe(0);
});

function order(status: string) {
  return { data: {
    id: orderId, orderNumber: 'ORD-RECOVERY', status, subtotal: 40_000, total: 40_000,
    discountAmount: 0, currency: 'VND', createdAt: '2026-11-01T00:00:00Z', items: [],
  } };
}

async function expectConfirmation(page: import('@playwright/test').Page) {
  await expect(page).toHaveURL(new RegExp(`/orders/confirmation\\?orderId=${orderId}$`), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'ORD-RECOVERY' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('brewlite_pending_checkout'))).toBeNull();
}
