# Ma trận truy vết BrewLite A2

Các mã FR, NFR và AT giữ theo [SRS](requirements/srs.md) và [NFR](requirements/non-functional-requirements.md). Xem [danh mục nguồn và bản xuất](diagrams/README.md) và [kết quả kiểm chứng, CI/CD và bàn giao](evidence/a2-delivery.md).

## FR → Use Case → sơ đồ → code → test

Các route backend dưới đây có prefix `/api/v1`. Đọc [test plan](testing/test-plan.md) để tra AC, fixture và kết quả mong đợi.

| FR | Use Case và sơ đồ | Code hoặc API | Kiểm chứng |
|---|---|---|---|
| FR-01 | UC-03, [Use Case tổng thể](diagrams/use-case-overview.svg) | `GET /products`, Web `/menu` | [Catalog API](../apps/api/test/unit/modules/catalog/catalog.service.spec.ts), TC-FR-01 |
| FR-02 | UC-04, [Class domain](diagrams/class-domain.svg) | `GET /products/:id`, chi tiết món | [Product detail](../apps/web/tests/unit/product-detail-modal.test.mjs), TC-FR-02 |
| FR-03 | UC-04, [Class domain](diagrams/class-domain.svg) | [CreateOrderDto](../apps/api/src/modules/orders/dto/create-order.dto.ts), server tính giá | [OrdersService](../apps/api/test/unit/modules/orders/services/orders.service.spec.ts), TC-FR-03 |
| FR-04 | UC-05, [Use Case tổng thể](diagrams/use-case-overview.svg) | [Cart store](../apps/web/src/stores/cart-store.ts) | [Cart store tests](../apps/web/tests/unit/cart-store.test.mjs), TC-FR-04 |
| FR-05 | UC-01/02, [Sequence checkout](diagrams/sequence-checkout.svg) | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, JWT và role/ownership | [Auth E2E](../apps/api/test/e2e/auth.e2e-spec.ts), TC-FR-05 |
| FR-06 | [UC-06](requirements/uc-06-tao-don.md), [Sequence tạo đơn](diagrams/sequence-create-order.svg) | `POST /orders`, [OrdersService](../apps/api/src/modules/orders/services/orders.service.ts) | [Orders HTTP](../apps/api/test/integration/orders.integration-spec.ts) kiểm tra trường giá/chủ đơn do client gửi, tính lại coupon và 20 yêu cầu tranh 5 ly. [Orders/inventory integration](../apps/api/test/integration/orders-inventory.integration-spec.ts), TC-FR-06 |
| FR-07 | [UC-08](requirements/uc-08-thanh-toan.md), [Sequence checkout](diagrams/sequence-checkout.svg), [Sequence thanh toán](diagrams/sequence-payment.svg) | `POST /payments`, `GET /payments/status`, IPN/Return | [Checkout API E2E](../apps/api/test/e2e/checkout.e2e-spec.ts) kiểm tra số tiền đã chốt, từ chối `amount` do client gửi và 20 yêu cầu dùng cùng khóa. [VNPay E2E](../apps/web/tests/e2e/vnpay/README.md), TC-FR-07 |
| FR-08 | UC-09, [Sequence checkout](diagrams/sequence-checkout.svg) | `GET /orders/me`, `GET /orders/:id`, Web xác nhận và lịch sử | [E2E menu → xác nhận](../apps/web/tests/e2e/delivery/checkout-flow.spec.ts), [Orders session E2E](../apps/web/tests/e2e/orders-session.spec.ts), TC-FR-08 |
| FR-09 | UC-10 và nhánh hủy của UC-06/08/09, [Class domain](diagrams/class-domain.svg) | `POST /orders/:id/cancel`, `PATCH /staff/orders/:id/status`, expiry job | [State machine integration](../apps/api/test/integration/order-state-machine.integration-spec.ts), [Staff orders E2E](../apps/api/test/e2e/staff-orders.e2e-spec.ts), TC-FR-09 |
| FR-10 | UC-07/08 và UC-11, [Class domain](diagrams/class-domain.svg) | `POST /coupons/validate`, consume coupon và EARN khi thanh toán, `POST /loyalty/redeem` | [Checkout E2E](../apps/api/test/e2e/checkout.e2e-spec.ts), [Loyalty integration](../apps/api/test/integration/loyalty-redemption.integration-spec.ts), TC-FR-10 |
| FR-11 | UC-09, [Use Case tổng thể](diagrams/use-case-overview.svg) | `GET /orders/me` nhận tham số phân trang | [Orders integration](../apps/api/test/integration/orders.integration-spec.ts), TC-FR-11 |
| FR-12 | UC-10, UC-12/13, [Use Case tổng thể](diagrams/use-case-overview.svg) | Web `/barista`, `/barista/recipes`, `/barista/inventory` | [Staff E2E](../apps/web/tests/e2e/staff.spec.ts), [Inventory E2E](../apps/web/tests/e2e/inventory.spec.ts), TC-FR-12 |
| FR-13 | UC-02, refresh token theo kế hoạch | Auth dùng access JWT | TC-FR-13 |
| FR-14 | UC-09, realtime theo kế hoạch | Web đọc trạng thái qua GET | TC-FR-14 |
| FR-15 | Giới hạn thu tiền thật trong phạm vi đề | Kiểm chứng cấu hình VNPay Sandbox và mock test | TC-FR-15 |
| FR-16 | UC-14/15, [Use Case thanh toán](diagrams/use-case-uc08.svg) | [Thiết kế hoàn tiền trước pha chế](requirements/staff-operations.md) | [Unit hoàn tiền](../apps/api/test/unit/modules/orders/services/orders-refund.service.spec.ts) và [Checkout API E2E](../apps/api/test/e2e/checkout.e2e-spec.ts) kiểm tra quyền và hai lượt duyệt đồng thời chỉ hoàn điểm/kho một lần |
| FR-17 | UC-16/17, [Use Case tổng thể](diagrams/use-case-overview.svg) | [Thiết kế nhập kho và biến động](requirements/staff-operations.md) | [Staff inventory HTTP integration](../apps/api/test/integration/staff-inventory.integration-spec.ts) kiểm tra phân quyền, lịch sử, hoàn tác và nhập kho đồng thời |

Task 2.1 dùng [Activity checkout](diagrams/activity-checkout.svg) cho FR-01 đến FR-08, gồm các nhánh chưa đăng nhập, hết hàng và thanh toán thất bại. Task 2.2 gồm [Sequence tạo đơn](diagrams/sequence-create-order.svg), [Sequence thanh toán](diagrams/sequence-payment.svg) và [Sequence checkout](diagrams/sequence-checkout.svg). [Class domain](diagrams/class-domain.svg) và [ERD](../database/BrewLite.svg) thể hiện các quan hệ dữ liệu.

## NFR → thiết kế → kiểm chứng

| NFR | Thiết kế hoặc evidence | Ca kế hoạch | Trạng thái nghiệm thu |
|---|---|---|:---:|
| NFR-01 | [Báo cáo đo tải API](evidence/nfr/perf/nfr-01-load-test-report.md), [Dữ liệu JSON](evidence/nfr/perf/nfr-01-results.json), [Script đo tải](../scripts/run-load-test-nfr01.mjs), [Screenshots](evidence/nfr/perf/screenshots/) | TC-NFR-01, AT-NFR-01 | 3 API đọc và khởi tạo VNPay đạt trong lần đo lại; [POST /orders đạt trên local: 9.833/9.833 HTTP 201, p95 189,08 ms](evidence/nfr/perf/nfr-01-orders-20-clients.md) |
| NFR-02 | [Minh chứng Bcrypt & Auth](evidence/nfr/nfr_02/), [Unit AuthService](../apps/api/test/unit/modules/auth/auth.service.spec.ts), [Auth E2E](../apps/api/test/e2e/auth.e2e-spec.ts) | TC-NFR-02, AT-NFR-02 | Đã kiểm thử băm mật khẩu bcrypt cost >= 10, JWT hợp lệ, không lộ hash/secret trong response & log |
| NFR-03 | [Minh chứng DTO Validation](evidence/nfr/nfr_03/), [CreateOrder DTO Spec](../apps/api/test/unit/modules/orders/dto/create-order.dto.spec.ts), server tính giá | TC-NFR-03, AT-NFR-03 | Đã kiểm thử pipeline chặn ID sai, payload không hợp lệ, trả về 400 Bad Request |
| NFR-04 | [Minh chứng Rollback Tồn kho](evidence/nfr/nfr_04/), [Sequence tạo đơn](diagrams/sequence-create-order.svg), [Kiểm thử đồng thời](../apps/api/test/integration/inventory-concurrency.integration-spec.ts) | TC-NFR-04, AT-NFR-04 | Đã kiểm thử tạo đơn, giữ nguyên liệu và rollback giao dịch trên PostgreSQL |
| NFR-05 | [Minh chứng Idempotency](evidence/nfr/nfr_05/), [Sequence thanh toán](diagrams/sequence-payment.svg), [Kiểm thử VNPay E2E](../apps/api/test/unit/modules/payments/payments-idempotency.spec.ts) | TC-NFR-05, AT-NFR-05 | Đã kiểm thử gửi lại cùng key, callback IPN mô phỏng và chống thanh toán trùng lặp |
| NFR-06 | [Minh chứng Migration](evidence/nfr/nfr_06/), [Deploy migrations](evidence/nfr/nfr_06/prisma-deploy-migrations.png), [Replay status](evidence/nfr/nfr_06/migration-replay-status.png) | TC-NFR-06, AT-NFR-06 | Đã kiểm thử áp dụng 21 migration trên DB rỗng; chạy lại không phát sinh migration chờ |
| NFR-07 | [Minh chứng Readiness & Health](evidence/nfr/nfr_07/), [Readiness 200/503](../apps/api/test/e2e/app.e2e-spec.ts), logs redaction | TC-NFR-07, AT-NFR-07 | API E2E kiểm tra phản hồi 200 khi có DB, 503 khi mất kết nối DB; log đã che thông tin nhạy cảm |
| NFR-08 | [Báo cáo Cross-Browser E2E](evidence/cross-browser/nfr-08-cross-browser-report.md), [42 Screenshots](evidence/cross-browser/screenshots/), [Dữ liệu JSON](evidence/cross-browser/nfr-08-results.json) | TC-NFR-08, AT-NFR-08 | 6/6 cấu hình Chrome, Edge và Firefox đạt trong ma trận đã chạy |
| NFR-09 | [Minh chứng Phục hồi & Khả dụng](evidence/nfr/nfr_09/), [Biên bản diễn tập rollback](evidence/cd/rollback-local-2026-11-14/README.md), [Runbook rollback](evidence/cd/rollback-guide.md) | TC-NFR-09, AT-NFR-09 | Đã diễn tập khôi phục DB/App sau sự cố và kiểm thử khả dụng steady-state trên local |
| NFR-10 | [Minh chứng Phân quyền & HTTPS](evidence/nfr/nfr_10/), [Tài liệu Production HTTPS](evidence/demo/production-https.md), [Railway config](deployment.md) | TC-NFR-10, AT-NFR-10 | Đã kiểm thử JWT xác thực, quyền sở hữu đơn hàng; Railway kích hoạt HTTPS và DB nội bộ private |
| NFR-11 | [Biên bản diễn tập Rollback](evidence/cd/bien-ban-dien-tap-rollback-nfr-11.md), [Dữ liệu JSON](evidence/cd/nfr-11-drill-results.json), [Railway CD Evidence](evidence/cd/railway-53b9321/README.md) | TC-NFR-11, AT-NFR-11 | Đã hoàn tất quality gate CI, deploy Railway CD, migration và diễn tập rollback local |
| NFR-12 | [Báo cáo PWA Offline & Reconnect](evidence/pwa/nfr-12-pwa-offline-report.md), [Ảnh offline](evidence/pwa/nfr-12-offline-banner.png), [Ảnh reconnect](evidence/pwa/nfr-12-reconnect-banner.png), [Dữ liệu JSON](evidence/pwa/nfr-12-pwa-results.json) | TC-NFR-12, AT-NFR-12 | Đã kiểm tra banner, giỏ hàng và trang ngoại tuyến trên Chrome local |

Lưu kết quả kiểm chứng cùng FR/NFR, mã TC/AT, revision, môi trường, dữ liệu test, lệnh chạy và kết quả quan sát. Các ca kế hoạch và evidence vận hành được theo dõi riêng.
