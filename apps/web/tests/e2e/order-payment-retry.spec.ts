// Kiểm tra thử thanh toán lại trên đúng đơn cũ.
import { expect, test } from '@playwright/test';

const orderId = 'retry-order';
const gatewayUrl = 'https://vnpay.example.test/retry';
const order = {
  id: orderId,
  orderNumber: 'ORD-RETRY',
  subtotal: 40000,
  total: 40000,
  discountAmount: 0,
  currency: 'VND',
  createdAt: '2026-11-01T00:00:00Z',
  items: [],
};

for (const { path, confirmedImmediately } of [
  { path: '/orders', confirmedImmediately: false },
  { path: `/orders/${orderId}`, confirmedImmediately: false },
  { path: `/orders/${orderId}`, confirmedImmediately: true },
]) {
  test(`Thử lại từ ${path} xác nhận đúng đơn gốc ${confirmedImmediately ? 'ngay lập tức' : 'sau khi quay lại từ VNPay'}`, async ({ page, baseURL }) => {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    await page.addInitScript((token) => localStorage.setItem('brewlite_token', token), `e30.${payload}.test`);
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { data: {
      id: 'customer', username: 'customer', isActive: true, role: 'CUSTOMER',
    } } }));

    let paid = false;
    const orderResponse = () => ({ ...order, status: paid ? 'PAID' : 'PAYMENT_FAILED' });
    await page.route('**/api/v1/orders/me', route => route.fulfill({ json: { data: [orderResponse()] } }));
    await page.route(`**/api/v1/orders/${orderId}`, route => route.fulfill({ json: { data: orderResponse() } }));

    let attemptKey: string | undefined;
    let paymentPosts = 0;
    await page.route('**/api/v1/payments', async route => {
      paymentPosts++;
      expect(route.request().postDataJSON()).toEqual({ orderId, method: 'VNPAY' });
      attemptKey = route.request().headers()['idempotency-key'];
      expect(attemptKey).toBeTruthy();
      paid = confirmedImmediately;
      await route.fulfill({ json: { data: {
        status: paid ? 'SUCCEEDED' : 'PROCESSING', success: paid, paymentUrl: gatewayUrl,
      } } });
    });
    await page.route(gatewayUrl, route => route.fulfill({
      status: 302,
      headers: { location: new URL('/checkout?paymentReturn=1', baseURL).toString() },
    }));
    await page.route('**/api/v1/payments/status', async route => {
      expect(route.request().headers()['idempotency-key']).toBe(attemptKey);
      await route.fulfill({ json: { data: {
        status: paid ? 'SUCCEEDED' : 'PROCESSING', success: paid, paymentUrl: gatewayUrl,
      } } });
    });

    await page.goto(path);
    await page.getByRole('button', { name: /^Thanh toán lại/ }).click();
    if (!confirmedImmediately) {
      await expect(page.getByText('Đang chờ xác nhận thanh toán')).toBeVisible();
      paid = true;
    }
    await expect(page).toHaveURL(new RegExp(`/orders/confirmation\\?orderId=${orderId}$`), { timeout: 15_000 });
    await expect(page.getByText('Đặt hàng thành công')).toBeVisible();
    await expect(page.getByRole('heading', { name: order.orderNumber })).toBeVisible();
    expect(paymentPosts).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem('brewlite_pending_checkout'))).toBeNull();
  });
}
