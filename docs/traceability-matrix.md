# Ma trận truy vết BrewLite A2

Đối chiếu với source tại `2645b87`. Các mã FR, NFR và AT giữ theo [SRS](requirements/srs.md) và [NFR](requirements/non-functional-requirements.md). Cột kiểm chứng ghi test có trong source hoặc ca dự kiến, còn kết quả chạy cần gắn với revision và môi trường cụ thể. Xem [danh mục nguồn và bản xuất](diagrams/README.md).

## FR → Use Case → sơ đồ → code → test

Các route backend dưới đây có prefix `/api/v1`. Đọc [test plan](testing/test-plan.md) để tra AC, fixture và kết quả mong đợi.

| FR | Use Case và sơ đồ | Code hoặc API | Kiểm chứng |
|---|---|---|---|
| FR-01 | UC-03, [Use Case tổng thể](diagrams/use-case-overview.svg) | `GET /products`, Web `/menu` | [Catalog API](../apps/api/test/catalog.service.spec.ts), TC-FR-01 |
| FR-02 | UC-04, [Class domain](diagrams/class-domain.svg) | `GET /products/:id`, chi tiết món | [Product detail](../apps/web/tests/product-detail-modal.test.mjs), TC-FR-02 |
| FR-03 | UC-04, [Class domain](diagrams/class-domain.svg) | [CreateOrderDto](../apps/api/src/modules/orders/dto/create-order.dto.ts), server tính giá | [OrdersService](../apps/api/src/modules/orders/services/orders.service.spec.ts), TC-FR-03 |
| FR-04 | UC-05, [Use Case tổng thể](diagrams/use-case-overview.svg) | [Cart store](../apps/web/src/stores/cart-store.ts) | [Cart store tests](../apps/web/tests/cart-store.test.mjs), TC-FR-04 |
| FR-05 | UC-01/02, [Sequence checkout](diagrams/sequence-checkout.svg) | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, JWT và role/ownership | [Auth E2E](../apps/api/test/auth.e2e-spec.ts), TC-FR-05 |
| FR-06 | [UC-06](requirements/uc-06-tao-don.md), [Sequence tạo đơn](diagrams/sequence-create-order.svg) | `POST /orders`, [OrdersService](../apps/api/src/modules/orders/services/orders.service.ts) | [Orders/inventory integration](../apps/api/test/orders-inventory.integration-spec.ts), TC-FR-06 |
| FR-07 | [UC-08](requirements/uc-08-thanh-toan.md), [Sequence checkout](diagrams/sequence-checkout.svg), [Sequence thanh toán](diagrams/sequence-payment.svg) | `POST /payments`, `GET /payments/status`, IPN/Return | [VNPay E2E](../apps/web/tests/e2e/vnpay/README.md), [mock API E2E](../apps/api/test/checkout.e2e-spec.ts), TC-FR-07 |
| FR-08 | UC-09, [Sequence checkout](diagrams/sequence-checkout.svg) | `GET /orders/me`, `GET /orders/:id`, Web xác nhận và lịch sử | [E2E menu → xác nhận](../tests/e2e/checkout-flow.spec.ts), [Orders session E2E](../apps/web/tests/e2e/orders-session.spec.ts), TC-FR-08 |
| FR-09 | UC-10 và nhánh hủy của UC-06/08/09, [Class domain](diagrams/class-domain.svg) | `POST /orders/:id/cancel`, `PATCH /staff/orders/:id/status`, expiry job | [State machine integration](../apps/api/test/order-state-machine.integration-spec.ts), [Staff orders E2E](../apps/api/test/staff-orders.e2e-spec.ts), TC-FR-09 |
| FR-10 | UC-07/08 và UC-11, [Class domain](diagrams/class-domain.svg) | `POST /coupons/validate`, consume coupon và EARN khi thanh toán, `POST /loyalty/redeem` | [Checkout E2E](../apps/api/test/checkout.e2e-spec.ts), [Loyalty integration](../apps/api/test/loyalty-redemption.integration-spec.ts), TC-FR-10 |
| FR-11 | UC-09, [Use Case tổng thể](diagrams/use-case-overview.svg) | `GET /orders/me` nhận tham số phân trang | [Orders integration](../apps/api/test/orders.integration-spec.ts), TC-FR-11 |
| FR-12 | UC-10, UC-12/13, [Use Case tổng thể](diagrams/use-case-overview.svg) | Web `/barista`, `/barista/recipes`, `/barista/inventory` | [Staff E2E](../apps/web/tests/e2e/staff.spec.ts), [Inventory E2E](../apps/web/tests/e2e/inventory.spec.ts), TC-FR-12 |
| FR-13 | UC-02, refresh token theo kế hoạch | Auth dùng access JWT | TC-FR-13 |
| FR-14 | UC-09, realtime theo kế hoạch | Web đọc trạng thái qua GET | TC-FR-14 |
| FR-15 | Giới hạn thu tiền thật trong phạm vi đề | Kiểm chứng cấu hình VNPay Sandbox và mock test | TC-FR-15 |

Task 2.1 Activity còn thiếu tạo phẩm. Báo cáo trình bày ba hình riêng cho Task 2.2 gồm [Sequence tạo đơn](diagrams/sequence-create-order.svg), [Sequence thanh toán](diagrams/sequence-payment.svg) và [Sequence checkout](diagrams/sequence-checkout.svg). [Class domain](diagrams/class-domain.svg) và [ERD](../database/BrewLite.svg) cũng có hình riêng.

## NFR → thiết kế → kiểm chứng

| NFR | Thiết kế hoặc evidence | Ca kế hoạch |
|---|---|---|
| NFR-01 | API và PostgreSQL, mục tiêu hiệu năng theo NFR | TC-NFR-01 |
| NFR-02 | Auth, bcrypt và JWT | TC-NFR-02 |
| NFR-03 | DTO validation, JWT/role và server tính giá | TC-NFR-03 |
| NFR-04 | [Sequence tạo đơn](diagrams/sequence-create-order.svg), transaction và kiểm thử tồn kho đồng thời | TC-NFR-04 |
| NFR-05 | [Sequence thanh toán](diagrams/sequence-payment.svg), key/hash, IPN và recovery | TC-NFR-05 |
| NFR-06 | Compose, migration, seed và persistent volume | TC-NFR-06 |
| NFR-07 | Health check, request ID, logs và redaction | TC-NFR-07 |
| NFR-08 | UI mobile và Playwright E2E | TC-NFR-08 |
| NFR-09 | Recovery, persistence và [runbook rollback](evidence/cd/rollback-guide.md) | TC-NFR-09 |
| NFR-10 | JWT/ownership và [Railway HTTPS, private DB](deployment.md) | TC-NFR-10 |
| NFR-11 | [PR CI](ci-pull-request.md), [Railway CD và smoke](evidence/cd/railway-a2-setup.md) | TC-NFR-11 |
| NFR-12 | [Manifest PWA](../apps/web/src/app/manifest.json), hành vi giỏ/checkout khi mất kết nối | TC-NFR-12 |

Lưu kết quả kiểm chứng cùng FR/NFR, mã TC/AT, revision, môi trường, dữ liệu test, lệnh chạy và kết quả quan sát. Các ca kế hoạch và evidence vận hành được theo dõi riêng.
