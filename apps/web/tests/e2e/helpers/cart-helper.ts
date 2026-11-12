import type { Page } from '@playwright/test';

/**
 * Sets up cart with at least one available product
 *
 * Navigates to menu, sets authentication token, adds first available product to cart.
 * Cart drawer auto-opens after adding product.
 *
 * @param page - Playwright Page instance
 * @param accessToken - User authentication token to set in localStorage
 * @throws Error if no available products found
 */
export async function setupCartWithProduct(
  page: Page,
  accessToken: string,
): Promise<void> {
  // Navigate to menu page
  await page.goto('/menu');

  // Set authentication token in localStorage
  await page.evaluate(
    (token) => localStorage.setItem('brewlite_token', token),
    accessToken,
  );

  // Reload to apply token
  await page.reload();
  await addFirstAvailableProduct(page);
}

export async function addFirstAvailableProduct(page: Page): Promise<void> {
  // Match the catalog button exactly. The offscreen cart also has "Sửa tùy chọn".
  const productButton = page
    .getByRole('button', { name: 'Tùy chọn', exact: true, disabled: false })
    .first();

  // The menu fetches its catalog asynchronously. Wait for an enabled product
  // instead of checking count immediately after reload (a CI race condition).
  await productButton.waitFor({ state: 'visible', timeout: 15000 });

  // Click to open product detail modal
  await productButton.click();

  // Find "Thêm vào giỏ" button by role
  const addToCartButton = page.getByRole('button', {
    name: /Thêm vào giỏ/,
  });

  // Click to add product to cart
  // Cart drawer auto-opens after adding (via onAddedToCart)
  await addToCartButton.click();
}

/**
 * Proceeds from cart to checkout page
 *
 * Clicks checkout button and waits for URL to change to /checkout.
 *
 * @param page - Playwright Page instance
 */
export async function proceedToCheckout(page: Page): Promise<void> {
  // Click checkout button
  await page.getByRole('button', {
    name: 'Tiến hành đặt & thanh toán',
  }).click();

  // Wait for URL to change to /checkout
  await page.waitForURL(/\/checkout/);
}
