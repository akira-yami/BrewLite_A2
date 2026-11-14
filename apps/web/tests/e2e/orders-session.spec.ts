import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const api = process.env.E2E_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? '3101'}/api/v1`;
const order = {
  id: 'order-a', orderNumber: 'ORD-SESSION-A', status: 'PAID', total: 40000,
  currency: 'VND', createdAt: '2026-11-01T00:00:00Z', items: [], subtotal: 40000, discountAmount: 0,
};

async function register(request: APIRequestContext) {
  const response = await request.post(`${api}/auth/register`, {
    data: { username: `session_${randomUUID().replaceAll('-', '').slice(0, 20)}`, password: 'E2e-password-123' },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data.accessToken as string;
}

async function persist(page: Page, token: string) {
  await page.goto('/login');
  await page.evaluate(value => localStorage.setItem('brewlite_token', value), token);
}

for (const path of ['/orders', '/orders/order-a', '/orders/confirmation?orderId=order-a']) {
  test(`restores the real session before loading ${path}`, async ({ page, request }) => {
    const token = await register(request);
    await persist(page, token);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let restoring = false;
    let requests = 0;
    await page.route(`${api}/auth/me`, async route => {
      restoring = true;
      await gate;
      await route.continue();
    });
    await page.route(`${api}/orders/**`, async route => {
      requests++;
      expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
      await route.fulfill({ json: { data: route.request().url().endsWith('/me') ? [order] : order } });
    });
    try {
      await page.goto(path);
      await expect.poll(() => restoring).toBe(true);
      expect(requests).toBe(0);
      await expect(page.getByText(/Vui lòng đăng nhập để xem/)).toHaveCount(0);
    } finally {
      release();
    }
    await expect(page.getByText(order.orderNumber, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(order.orderNumber, { exact: true })).toBeVisible();
    expect(requests).toBeGreaterThanOrEqual(2);
  });
}

for (const status of [401, 403]) {
  test(`orders ${status} ${status === 401 ? 'invalidates' : 'preserves'} the restored session`, async ({ page, request }) => {
    const token = await register(request);
    await persist(page, token);
    await page.route(`${api}/orders/**`, route => route.fulfill({ status, json: {
      error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN_RESOURCE', message: 'Session test error' },
    } }));
    await page.goto('/orders/order-a');
    if (status === 401) {
      await expect(page).toHaveURL(/\/login/);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('brewlite_token'))).toBeNull();
    } else {
      await expect(page.getByText('Không tìm thấy đơn hàng hoặc bạn không có quyền xem đơn này.')).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('brewlite_token'))).toBe(token);
      await expect(page).toHaveURL(/\/orders\/order-a/);
    }
  });
}

for (const oldStatus of [200, 401]) {
  test(`ignores a late ${oldStatus} response after switching sessions`, async ({ page, request }) => {
    const oldToken = await register(request);
    const newToken = await register(request);
    await persist(page, oldToken);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let oldRequested = false;
    let oldCompleted = false;
    await page.route(`${api}/orders/me`, async route => {
      if (route.request().headers().authorization === `Bearer ${oldToken}`) {
        oldRequested = true;
        await gate;
        await route.fulfill({ status: oldStatus, json: oldStatus === 200 ? { data: [order] } : { error: { code: 'UNAUTHORIZED', message: 'Old token' } } });
        oldCompleted = true;
      } else {
        await route.fulfill({ json: { data: [{ ...order, id: 'order-b', orderNumber: 'ORD-SESSION-B' }] } });
      }
    });
    try {
      await page.goto('/orders');
      await expect.poll(() => oldRequested).toBe(true);
      // A storage event exercises the provider's actual restore path, as another
      // tab logging in would. Neither authSession nor its hooks are mocked.
      await page.evaluate(token => {
        const oldValue = localStorage.getItem('brewlite_token');
        localStorage.setItem('brewlite_token', token);
        window.dispatchEvent(new StorageEvent('storage', { key: 'brewlite_token', oldValue, newValue: token }));
      }, newToken);
      await expect(page.getByText('ORD-SESSION-B', { exact: true })).toBeVisible();
    } finally {
      release();
    }
    await expect.poll(() => oldCompleted).toBe(true);
    await expect(page.getByText('ORD-SESSION-B', { exact: true })).toBeVisible();
    await expect(page.getByText('ORD-SESSION-A', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('brewlite_token'))).toBe(newToken);
    await expect(page).toHaveURL(/\/orders$/);
  });
}
