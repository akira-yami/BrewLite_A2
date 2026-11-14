// Kiểm tra nhân viên phục vụ một đơn đã thanh toán và giới hạn quyền truy cập.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const api = process.env.E2E_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? '3101'}/api/v1`;

test("Barista xử lý đơn đã thanh toán và kiểm tra quyền nhân viên trên desktop/mobile", async ({
  page,
  request,
}) => {
  const login = await request.post(`${api}/auth/login`, {
    data: {
      username: "barista01",
      password: "Barista@123",
    },
  });
  expect(login.ok()).toBeTruthy();
  const staff = (await login.json()).data.accessToken;
  const registered = await request.post(`${api}/auth/register`, {
    data: {
      username: `staff_e2e_${randomUUID().slice(0, 12)}`,
      password: "Customer-e2e-password",
    },
  });
  const customer = (await registered.json()).data.accessToken;
  const menu = (await (await request.get(`${api}/products`)).json()).data;
  const variant = menu
    .flatMap(
      (p: { variants: { id: string; available?: boolean; availableServings?: number }[] }) =>
        p.variants,
    )
    .find((v: { available?: boolean; availableServings?: number }) => v.available ?? (v.availableServings ?? 0) > 0);
  expect(variant).toBeTruthy();
  const created = await request.post(`${api}/orders`, {
    headers: { Authorization: `Bearer ${customer}` },
    data: {
      items: [
        {
          productVariantId: variant.id,
          quantity: 1,
          sugarLevel: 25,
          iceLevel: 50,
          note: "Pha cẩn thận cho khách",
        },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();
  const order = (await created.json()).data;
  const paid = await request.post(`${api}/payments`, {
    headers: {
      Authorization: `Bearer ${customer}`,
      "Idempotency-Key": randomUUID(),
    },
    data: { orderId: order.id, method: "E_WALLET" },
  });
  expect(paid.ok()).toBeTruthy();
  await page.goto("/login");
  await page.evaluate(
    (token) => localStorage.setItem("brewlite_token", token),
    staff,
  );
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto("/barista");
  const card = page.getByRole("article", {
    name: `Đơn ${order.orderNumber}`,
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText("25%");
  await expect(card).toContainText("Pha cẩn thận cho khách");
  await page.screenshot({
    path: "../../.tmp/barista-desktop.png",
    fullPage: true,
  });
  for (const label of ["Nhận đơn", "Pha xong", "Đã giao khách"]) {
    await card.getByRole("button", { name: label, exact: true }).click();
    if (label !== "Đã giao khách")
      await expect(
        card.getByRole("button", {
          name: label === "Nhận đơn" ? "Pha xong" : "Đã giao khách",
          exact: true,
        }),
      ).toBeEnabled();
  }
  await expect(card).toHaveCount(0);
  const detail = await request.get(`${api}/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${customer}` },
  });
  expect((await detail.json()).data.status).toBe("COMPLETED");
  // A CUSTOMER never receives the employee interface.
  await page.evaluate(
    (token) => localStorage.setItem("brewlite_token", token),
    customer,
  );
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "không có quyền" }),
  ).toContainText("không có quyền");
});
