# Kiến trúc hệ thống BrewLite

Phiên bản 1.1 · 04/11/2026 · Phụ trách: Khang · [A2-3.1.1 / #12](https://github.com/akira-yami/BrewLite_A2/issues/12).

Kiến trúc A2 tại revision `2645b87`. Topology và revision production được ghi riêng trong [Deployment Railway](../deployment.md).

## 1. Căn cứ và phạm vi

- [Bối cảnh và phạm vi](../requirements/context-and-scope.md), [FR-01..15](../requirements/srs.md), [NFR-01..12](../requirements/non-functional-requirements.md), [UC-01..10](../requirements/use-case-overview.md) là baseline yêu cầu của repository A2.
- Tham khảo `docs/tham_khao/BrewLite/docs/architecture/system-architecture.md`, `architecture/foundation-contract.md` và `decisions/ADR-001..004` của BrewLite A1. Kế thừa ranh giới module và nguyên tắc transaction; không kế thừa trạng thái đã triển khai, approval, PR hay evidence của A1. Thư mục tham khảo chỉ có ở máy làm việc, không cần để đọc thiết kế này.
- Phạm vi: một quầy, VND nguyên, Web Next.js, API NestJS và PostgreSQL. Checkout dùng VNPay. Ví/Thẻ mock thuộc bộ test API.

## 2. Cấu trúc và ranh giới hệ thống

Chọn **kiến trúc phân lớp trong modular monolith**: Next.js là ứng dụng web riêng; NestJS là một backend chia theo domain; PostgreSQL là nguồn dữ liệu giao dịch duy nhất. Không có kết nối trực tiếp từ trình duyệt tới DB.

| Thành phần | Trách nhiệm | Giao tiếp / ranh giới |
|---|---|---|
| Thiết bị khách hàng/Barista | Trình duyệt/PWA, nhập lựa chọn, xem kết quả | HTTPS tới Web/API; không được quyết định giá, quyền hoặc kết quả thanh toán |
| Next.js / `apps/web` | Menu, giỏ, auth, checkout, lịch sử, loyalty và khu Barista | REST/JSON tới NestJS, prefix `/api/v1`; giỏ local, server state lấy lại từ API |
| NestJS / `apps/api` | JWT/RBAC/ownership, validation, nghiệp vụ, điều phối transaction, health/log | API public qua HTTPS; Prisma tới PostgreSQL trên mạng nội bộ |
| PostgreSQL | Order snapshot, tồn/reservation, payment attempt, coupon, loyalty ledger, history | Chỉ API và migration job được truy cập bằng tài khoản có quyền phù hợp |
| VNPay | Tạo URL ký, callback và QueryDr theo cấu hình | Browser redirect HTTPS, VNPay gửi IPN tới API |
| Công cụ vận hành | Migration một lần trước API; cấu hình, health và log | Local/CI/production dùng cấu hình riêng, secret bên ngoài Git |

```text
Customer / Barista
        | HTTPS
        v
Next.js Web/PWA ---- REST/JSON + Bearer JWT ----> NestJS API
                                                   |
                    +------------------------------+-------------------+
                    |                                                  |
         Controller -> Service -> Repository                 VNPay gateway
                                   |                                  |
                                 Prisma                       VNPay (HTTPS)
                                   |
                              PostgreSQL
```

Xem [Deployment Railway A2](../deployment.md) cho cổng, network và persistent volume đã quan sát.

## 3. Backend theo module và lớp

| Module | Dữ liệu / trách nhiệm sở hữu | FR / UC |
|---|---|---|
| `auth`, `users` | Đăng ký/login, JWT, role, hồ sơ; không tự quyết định điểm | FR-05; UC-01/02 |
| `catalog` | Product, variant, topping, giá và trạng thái bán | FR-01/02/03; UC-03/04 |
| `orders` | Order/items snapshot, state machine, ownership, history | FR-06/08/09; UC-06/09/10 |
| `inventory` | RecipeItem/ToppingRecipeItem, tổng nhu cầu ingredient, reserve/consume/release/expiry theo snapshot | FR-06/09; UC-06/08 |
| `payments` | Attempt, request hash/key, serialize attempt theo order, gateway, đối soát | FR-07; UC-08 |
| `promotions` | Quote, hạn mức coupon, reservation và consumption | FR-10; UC-07/08 |
| `loyalty` | Ledger EARN theo order, đổi điểm lấy coupon và lịch sử | FR-10; UC-08/11 |

Luồng phụ thuộc chuẩn là `Controller -> Service -> Repository -> Prisma`.

- Controller xử lý transport/DTO/guard; không query DB, tính giá hoặc mở transaction.
- Service sở hữu business rule, mở transaction và gọi public service của module khác. Repository nhận cùng transaction client; không tự mở transaction rời cho một phần của cùng nghiệp vụ.
- Repository chỉ truy cập dữ liệu; không gọi ngược service hoặc ném HTTP exception. Mapper là helper thuần giữa record/entity/response, không I/O.
- Module khác không inject repository nội bộ. Tránh vòng phụ thuộc: `orders` điều phối create/cancel; `payments` điều phối pay và gọi public order/inventory/promotion/loyalty service với cùng transaction. `orders` chỉ đọc điều kiện payment đang xử lý qua repository dữ liệu order/lock theo contract, không gọi ngược payment orchestration.
- Một transaction có thể đi qua nhiều module nhưng phải có một service điều phối và một DB transaction. Quy tắc order/payment/expiry cùng khóa order trước khi thay đổi để phân xử race.

Đường dẫn đích: `apps/api/src/modules/<domain>/{controllers,services,repositories,dto,entities,mappers}`, `src/common` cho guard/filter/interceptor, `src/config` cho config validation và `prisma/{schema.prisma,migrations,seed.ts}`. Chỉ tạo các lớp cần thiết khi triển khai, không thêm interface/mapper rỗng để đủ cây thư mục.

## 4. Frontend và API boundary

Route/layout ở `apps/web/src/app`; feature ở `src/features/{catalog,cart,auth,checkout,orders}`; API client dùng chung ở `src/lib`. Form và giỏ dùng state client; giỏ persist lựa chọn, đường/đá/note qua localStorage, có xử lý dữ liệu cũ/hỏng. Không lưu giá client như cam kết thanh toán.

API client ghép base URL có `/api/v1`, gửi Bearer access JWT tới route bảo vệ; JWT/credential không ghi log. Web lưu access JWT và thông tin phiên trong localStorage, rồi xác minh lại với API khi reload. Phản hồi 401 của phiên hiện tại xóa phiên; lỗi mạng tạm thời cho phép thử lại. Giỏ dùng kho localStorage riêng. Service worker chỉ lưu trang ngoại tuyến.

Khi chờ thanh toán, Web dùng key lưu trong phiên checkout để tra trạng thái và khôi phục điều hướng. Web chuyển trình duyệt qua URL VNPay, rồi xác nhận bằng trạng thái payment hoặc đơn.

| API dưới /api/v1 | Chủ thể / nghiệp vụ | Kiểm soát bắt buộc |
|---|---|---|
| `GET /products`, `GET /products/:id` | Public, catalog active | Validate ID, không trả option không bán được như có thể mua |
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | Đăng ký/login/xác minh phiên | Chỉ đăng ký CUSTOMER, hash bcrypt, không trả password/hash |
| `POST /orders` | CUSTOMER tạo đơn | JWT, DTO, giá DB, transaction/reservation, không nhận userId/total |
| `GET /orders/me`, `GET /orders/:id` | Khách xem đơn của mình | Ownership kể cả khi biết ID; danh sách chỉ của principal |
| `POST /payments`, `GET /payments/status` | Chủ đơn khởi tạo/tra thanh toán | JWT, `Idempotency-Key`, amount từ DB |
| `GET /payments/vnpay/ipn`, `GET /payments/vnpay/return` | VNPay callback và browser return | Chữ ký, mã giao dịch, số tiền, xử lý lặp |
| `GET /staff/recipes`, `GET /staff/inventory`, `PATCH /staff/inventory/:id/stock` | Công thức và tồn nguyên liệu | Role BARISTA |
| `GET /loyalty/me`, `POST /loyalty/redeem` | Xem điểm và đổi voucher | Role CUSTOMER |
| `POST /orders/:id/cancel`, `PATCH /staff/orders/:id/status` | Chủ đơn hủy; Barista cập nhật pha chế | Ownership/RBAC, state machine, phân xử race với payment/expiry |
| `GET /health` | Readiness | Kiểm tra DB có timeout, 200/503, không lộ config |

Xem [ma trận truy vết](../traceability-matrix.md) cho route, sơ đồ và test tương ứng.

## 5. Dữ liệu, migration và tính nhất quán

PostgreSQL + Prisma; migration versioned trong Git, bổ sung SQL cho CHECK/partial unique index khi ORM không biểu diễn đủ. Tiền lưu số nguyên VND (`BIGINT`), API serialize trong miền số nguyên an toàn đã validate; không trả JavaScript BigInt trực tiếp thành JSON. Thời gian UTC/timestamptz, ID UUID. Dữ liệu giao dịch không cascade-delete theo catalog/user.

Migration one-shot chạy trước API, fail thì không start release mới; không sửa migration đã áp dụng. Seed development/test phải lặp an toàn, không tự cấp tài khoản demo trên production. PostgreSQL có persistent volume/disk; restart không xóa volume. [ADR-002](adr/002-postgresql-prisma.md) ghi lựa chọn; thiết kế chi tiết thuộc [#13](https://github.com/akira-yami/BrewLite_A2/issues/13), triển khai migration/seed thuộc [#35](https://github.com/akira-yami/BrewLite_A2/issues/35).

### 5.1. UC-06: Tạo đơn

1. JWT/CUSTOMER và DTO hợp lệ; chuẩn hóa 1..20 dòng, quantity 1..20, đọc catalog/BOM/nguyên liệu cùng transaction `ReadCommitted`.
2. Đọc RecipeItem và ToppingRecipeItem của mọi topping, nhân số ly và cộng theo ingredientId toàn giỏ. Tồn/version ở Ingredient, không ở ProductVariant. Thiếu BOM/inactive ingredient không bán được; availableServings chỉ là thông tin tính toán.
3. Tính giá server, khóa/quote coupon nếu có, tạo Order PENDING và items/topping snapshots. OrderItem.unitPrice là giá variant; topping snapshot riêng, lineTotal=(giá variant+topping) x quantity.
4. Theo thứ tự ingredientId ổn định, UPDATE Ingredient SET stockQuantity-=need, version+=1 WHERE isActive AND stockQuantity>=need. InventoryReservation mỗi order/variant lưu số ly; InventoryReservationItem lưu lượng ingredient thật đã giữ, gồm cả topping.
5. Coupon RESERVED và history cùng transaction. Lỗi rollback toàn bộ stockQuantity/version/bản ghi; conflict retry toàn transaction có giới hạn, tối đa 3 attempt. TTL từ config. Kiểm tra thiếu nguyên liệu trước ghi trả OUT_OF_STOCK. Nếu cập nhật có điều kiện thất bại vì tồn vừa thay đổi, thử lại toàn transaction.
6. Trả 201 PENDING và kết thúc UC-06; chưa gọi gateway, không tạo payment/consume/EARN. POST /orders chưa idempotent, UI mất response cần tra cứu trước đặt lại.

### 5.2. UC-08: Thực hiện thanh toán (use case độc lập)

1. API xác thực chủ đơn, tính request hash từ orderId, method và amount. Cùng key và hash trả lại dữ liệu đã lưu, gồm URL của attempt VNPay đang xử lý.
2. Attempt mới khóa đơn, kiểm tra trạng thái/hạn và ghi `PROCESSING` cùng URL. API trả HTTP 200 để Web chuyển sang VNPay.
3. IPN xác minh callback và chốt trong transaction. Return hợp lệ ở Sandbox cũng có thể chốt. Thành công consume giữ chỗ/coupon và cộng `floor(total / 10)` điểm cùng commit. Thành công muộn có thể vào `MANUAL_REVIEW`.
4. Thất bại xác định cho phép thử lại đơn còn hạn bằng key mới. Web tra trạng thái bằng key cũ trong lúc chờ kết quả. Đối soát có thẩm quyền được ghi audit.

[Sequence checkout](../diagrams/sequence-checkout.svg) · [Sequence thanh toán](../diagrams/sequence-payment.svg) · [Đặc tả UC-08](../requirements/uc-08-thanh-toan.md).

Chi tiết API phục vụ đối soát nằm trong [hướng dẫn backend](../../apps/api/README.md).

### 5.3. Vòng đời và công việc nền

Order: `PENDING`, `PAYMENT_FAILED`, `PAID`, `PREPARING`, `READY`, `COMPLETED`, `CANCELLED`. Payment: `PROCESSING`, `SUCCEEDED`, `FAILED`, `MANUAL_REVIEW`, `REFUNDED`. Không dùng chung hai enum.

Job expiry chạy trong API. Hủy hoặc hết hạn dùng khóa đơn và hoàn tồn theo snapshot của reservation ACTIVE. Payment cần đối soát ảnh hưởng đến điều kiện hủy hoặc hết hạn. Xem [OrdersService](../../apps/api/src/modules/orders/services/orders.service.ts) và [expiry job](../../apps/api/src/modules/orders/services/order-expiry.job.ts) cho các điều kiện theo trạng thái và phương thức.

## 6. Cấu hình, health và logging

API đọc DATABASE_URL, JWT, WEB_ORIGIN/CORS_ORIGIN, TTL giữ chỗ và cấu hình VNPAY theo môi trường. URL API public được đưa vào bundle Next.js lúc build. Secret được cấp qua biến môi trường của service.

- `GET /api/v1/health` readiness: truy vấn DB có timeout, DB sẵn sàng trả 200; lỗi DB trả 503 chung. Production platform dùng probe này; liveness process có thể tách nếu cần.
- Log JSON ra stdout: timestamp UTC, level, requestId, route, status, duration, error code; che authorization/cookie/password/secret. Không trả stack/Prisma error ra response.
- Global validation và error filter thống nhất lỗi có code/message/requestId; requestId phải đối chiếu response với log. Chỉ trả details đã lọc an toàn.
- Không public DB; production Web/API dùng HTTPS. Local ports dự kiến web 3000, API 3001, DB 5432; không suy các cổng local thành cổng public production.

## 7. Lý do, hạn chế và phương án khác

| Lựa chọn | Lợi ích | Hạn chế / trade-off | Phương án đã cân nhắc |
|---|---|---|---|
| Monorepo, Web/API riêng | Review cùng FR/contract, phối hợp một PR | Cần giữ ranh giới, build/test từng app | Nhiều repo tốn đồng bộ contract ở quy mô nhóm nhỏ |
| Modular monolith, phân lớp | Một transaction cho nhiều domain; ít vận hành | Deploy/scale toàn API, service có thể phình lớn | Microservices thêm network, distributed transaction và recovery quá sức MVP |
| PostgreSQL + Prisma | ACID, constraint, migration có lịch sử | Vẫn cần SQL/locking và test DB thật | Memory DB không chứng minh concurrency; ORM khác hợp lệ nhưng không dùng song song |
| VNPay theo môi trường | Tách redirect, callback và đối soát | Phụ thuộc merchant, callback HTTPS và điều kiện QueryDr | Mock Ví/Thẻ giữ cho kiểm thử API |
| Reservation + durable attempt | Tránh oversell, replay/recovery sau restart | Job expiry và đối soát phức tạp hơn | Giữ transaction khi gọi gateway tạo lock dài; cache key memory mất khi restart |

## 8. ADR và điều kiện kiểm chứng

| Quyết định | Tài liệu |
|---|---|
| Monorepo, modular monolith, lớp và module | [ADR-001](adr/001-monorepo.md) |
| DB, ORM, migration và persistent data | [ADR-002](adr/002-postgresql-prisma.md) |
| JWT, role và ownership | [ADR-003](adr/003-authentication.md) |
| Reservation, payment idempotency/recovery | [ADR-004](adr/004-payment-inventory-consistency.md) |
| Đồng bộ BOM/kho A1 và ranh giới UC | [ADR-006](adr/006-a1-recipe-inventory.md) |

Các ADR đều là đề xuất cho A2, chưa ghi nhận review độc lập. Thay đổi quyết định phải bổ sung ADR thay thế và cập nhật FR/UC/sơ đồ/test bị ảnh hưởng.

Khi triển khai: unit cho giá/state machine/coupon; HTTP cho DTO/JWT/role/ownership; PostgreSQL integration cho rollback, BOM X=10, tồn X=50/20 request, coupon hạn mức, cùng key/khác key/timeout/restart; browser E2E menu tới confirmation/history, giỏ/offline; readiness, clean-checkout migrate/seed và persistence; đo NFR theo đúng dataset/ngưỡng trong SRS. Liên kết code/test/evidence thật tại [ma trận truy vết](../traceability-matrix.md) khi có; không đánh dấu NFR đạt dựa trên kiến trúc.

## 9. Baseline công thức/kho và ranh giới UC

A2 kế thừa mô hình kho Ingredient và công thức món/topping từ baseline A1. [Class domain](class-domain.md) và [ERD](../../database/BrewLite.svg) bám schema hiện tại. UC-06 tạo đơn và giữ nguyên liệu, UC-08 xử lý thanh toán trên đơn đã tạo.
