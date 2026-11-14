import { expect, test } from '@playwright/test';
const api = process.env.E2E_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? '3101'}/api/v1`;
test('Barista inventory is read-only on desktop and mobile', async ({ page, request }) => {
 const response = await request.post(`${api}/auth/login`, { data: { username: 'barista01', password: 'Barista@123' } });
 expect(response.ok()).toBeTruthy();
 const token = (await response.json()).data.accessToken;
 await page.goto('/login');
 await page.evaluate(value => localStorage.setItem('brewlite_token', value), token);
 await page.setViewportSize({ width: 1440, height: 1000 });
 await page.goto('/barista/inventory');
 await expect(page.getByRole('heading', { name: 'Danh sách nguyên liệu' })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Cập nhật', exact: true })).toHaveCount(0);
 const data = (await (await request.get(`${api}/staff/inventory`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
 expect(data.length).toBeGreaterThan(0);
 const result = await request.patch(`${api}/staff/inventory/${data[0].id}/stock`, { headers: { Authorization: `Bearer ${token}` }, data: { stockQuantity: 0, version: data[0].version } });
 expect(result.status()).toBe(403);
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
