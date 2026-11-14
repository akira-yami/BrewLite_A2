# BrewLite API

Backend BrewLite sử dụng NestJS, TypeScript và REST API với global prefix `/api/v1`.

## Chạy local

```bash
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
# Điền giá trị vừa tạo vào JWT_SECRET trong .env trước khi khởi động.
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

Tạo database `brewlite` và user tương ứng trong PostgreSQL trước khi migrate. API chạy tại `http://localhost:3001`; readiness endpoint `GET /api/v1/health` kiểm tra kết nối DB bằng `SELECT 1` và trả 503 khi DB lỗi. Trên PowerShell dùng `Copy-Item .env.example .env`.

Các biến môi trường chính:

```dotenv
PORT=3001
WEB_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://brewlite:change_me_local_only@localhost:5432/brewlite?schema=public
JWT_SECRET=<secret ngẫu nhiên vừa tạo>
JWT_ISSUER=brewlite-api
JWT_AUDIENCE=brewlite-web
JWT_EXPIRES_IN=15m
ORDER_RESERVATION_TTL_MINUTES=15
TRUSTED_PROXY_CIDRS=
```

`WEB_ORIGIN` chấp nhận nhiều origin phân tách bằng dấu phẩy.

`TRUSTED_PROXY_CIDRS` là allowlist tùy chọn cho địa chỉ IP/CIDR của reverse-proxy/ingress trực tiếp kết nối tới API. Để trống khi client kết nối thẳng. Khi cấu hình, Express chỉ tin `X-Forwarded-For` từ các proxy nằm trong allowlist này; địa chỉ `@Ip()` dùng cho VNPay được suy ra theo proxy chain đã tin cậy. Dùng IP/CIDR nội bộ thực tế do người quản trị hạ tầng xác nhận, không sao chép giá trị ví dụ hoặc đoán dải IP. Không dùng `true`, `*`, `0.0.0.0/0` hay `::/0`; API phải được firewall để client Internet không thể giả làm ingress tin cậy.

`JWT_SECRET` bắt buộc để ký và xác thực JWT. API dừng khi thiếu biến này. File `.env` dùng cho local được Git bỏ qua; không ghi secret thật vào `.env.example`.
`JWT_EXPIRES_IN` nhận duration dương dạng `s`, `m`, `h` hoặc `d` (ví dụ `900s`, `15m`, `1h`) và tối đa 7 ngày; `ORDER_RESERVATION_TTL_MINUTES` phải là số nguyên từ 1 đến 10080 (7 ngày). API dừng lúc khởi động nếu một trong hai giá trị không hợp lệ.

## Seed Catalog

Sau khi migrate, chạy `npm run db:seed` để bổ sung catalog mẫu. Seed chỉ thêm sản phẩm, size, topping và liên kết còn thiếu theo SKU/code/khóa liên kết; có thể chạy nhiều lần mà không tạo bản ghi trùng.

Seed cũng bổ sung nguyên liệu (`ingredients`) và công thức (`recipe_items`) cho từng size còn thiếu. Seed giữ nguyên ID, giá, tồn kho nguyên liệu, version, trạng thái và nội dung đã chỉnh sửa của bản ghi hiện có (kể cả công thức đã sửa). Không xóa đơn hàng, chi tiết đơn, topping của đơn hoặc giữ chỗ tồn kho. Toàn bộ seed chạy trong một transaction: nếu gặp lỗi, dữ liệu vừa thêm được rollback và lệnh trả mã lỗi.

## Tồn kho theo nguyên liệu và công thức (BOM)

Thành phẩm (ly cà phê, trà sữa...) **không có số lượng trong CSDL**: `products` và `product_variants` không có cột `stock`, `quantity` hay `version`. Tồn kho chỉ nằm ở nguyên liệu thô.

| Bảng | Vai trò |
|---|---|
| `ingredients` | Nguyên liệu thô. `stock_quantity` tính theo đơn vị cơ sở của `unit` (`G`, `ML`, `PCS`); `version` tăng sau mỗi lần ghi tồn; các luồng dùng khóa phiên bản kiểm tra giá trị này. |
| `recipe_items` | Công thức (BOM): khóa chính `(product_variant_id, ingredient_id)`, `quantity` là lượng nguyên liệu cho 1 ly. |
| `inventory_reservation_items` | Lượng nguyên liệu thực tế đã giữ cho từng reservation, dùng để hoàn đúng số lượng khi hủy hoặc hết hạn, kể cả khi công thức đổi sau đó. |

Topping theo cùng nguyên tắc, bảng `topping_recipe_items` (công thức 1 phần topping) và cột `toppings.type`:

- `PREPACKAGED` (nhập sẵn: thạch hộp, trân châu 3Q, flan đóng hộp): đúng 1 dòng công thức, 1 phần = 1 định lượng nguyên liệu thô, ví dụ 30g trân châu 3Q.
- `PREPARED` (chế biến: trân châu đen đường đen, kem cheese tự đánh): bán thành phẩm, 1 phần gồm nhiều nguyên liệu thô (bột năng, đường đen, sữa tươi...). Không có tồn kho riêng cho bán thành phẩm; tồn kho chỉ nằm ở nguyên liệu thô.

Mỗi ly kèm một phần topping, nguyên liệu của topping được trừ cùng lúc với nguyên liệu của ly và ghi vào reservation. `toppings[].available` trong API là `true` khi topping đang hoạt động và mọi nguyên liệu đủ cho ít nhất 1 phần. Topping chưa có công thức bị coi là hết hàng (tạo đơn trả `OUT_OF_STOCK` kèm `toppingId`). Số lượng công thức là số nguyên theo đơn vị cơ sở nên chọn đơn vị (g, ml) đủ nhỏ để không cần phần thập phân. Migration `20261101100000_topping_recipe`.

API menu/detail trả `variants[].available` (boolean): công thức có đủ nguyên liệu để pha ít nhất một phần hay không. Không trả số lượng tồn của từng món/size. Các size và món có thể dùng chung nguyên liệu nên khả dụng tại lúc đọc không phải cam kết giữ hàng. Backend cộng dồn nhu cầu của toàn giỏ (gồm topping) rồi giữ nguyên liệu trong transaction; UI chỉ hiển thị “Có thể pha / Tạm hết nguyên liệu”.

Khi tạo đơn, hệ thống quy đổi số ly thành nhu cầu nguyên liệu theo công thức, cộng dồn các nguyên liệu dùng chung giữa các dòng, rồi trừ kho nguyên liệu bằng `UPDATE ... WHERE is_active = true AND stock_quantity >= ?` theo thứ tự ID trong transaction `ReadCommitted`. Migration `20261101090000_ingredient_recipe_inventory` tạo ba bảng trên và xóa `product_variants.stock`/`version`. Số lượng thành phẩm cũ không được chuyển đổi; sau khi `npm run prisma:deploy`, chạy `npm run db:seed` để có nguyên liệu và công thức mẫu.

## Kiểm tra

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`test/e2e/checkout.e2e-spec.ts` kiểm tra HTTP/DB thật cho checkout: preview coupon, tạo đơn có giảm giá, thanh toán Wallet thành công, Card thất bại, replay idempotency key và retry bằng key mới. Test yêu cầu `SMOKE_DATABASE_URL` trỏ đến database disposable có tên bắt đầu bằng `brewlite_foundation_smoke`.

Build/typecheck tự generate client; `src/generated/prisma` được bỏ qua trong Git. Docker dùng migration one-shot trước backend. Không sửa migration đã chạy trên database chia sẻ.

## Mức đường/đá của OrderItem

`sugarLevel Int? @map("sugar_level")` và `iceLevel Int? @map("ice_level")` nhận phần trăm nguyên 0..100. Null hoặc không gửi dùng công thức chuẩn; 0 là không đường/đá. Migration `20261010090000_order_item_sugar_ice_levels` thêm hai cột nullable và CHECK, giữ đơn cũ với null. Cập nhật DB đang dùng bằng `npm run prisma:deploy`, rồi `npm run prisma:generate` (hoặc build/typecheck).

`CreateOrderDto` validate các trường mới; `toOrderItemResponse` trả nguyên lựa chọn từ snapshot, không phụ thu. Controller/service Orders đã có trong mã nguồn; snapshot cần giữ giá trị 0 và tổng hợp nhu cầu nguyên liệu qua các dòng khác tùy chọn. Xem [DTO tạo đơn](src/modules/orders/dto/create-order.dto.ts) và [ERD](../../database/BrewLite.svg).

## Ghi chú của OrderItem

`OrderItem.note String? @db.VarChar(500)` lưu ghi chú cho từng dòng. Migration `20261010100000_order_item_note` thêm cột nullable, giữ đơn cũ với null. DTO trim đầu/cuối, rỗng thành null, validate chuỗi tối đa 500 ký tự; mapper trả nguyên note đã lưu. Chỉ gộp dòng khi cùng ghi chú đã chuẩn hóa; không đổi giá. Áp dụng bằng `npm run prisma:deploy` rồi generate/build như trên.

## Migration smoke từ database sạch

Tạo **database test mới, rỗng** có tên bắt đầu bằng `brewlite_foundation_smoke_test`, rồi chạy:

```powershell
$env:SMOKE_DATABASE_URL = 'postgresql://brewlite:change_me_local_only@localhost:5432/brewlite_foundation_smoke_test?schema=public'
npm run test:migration
```

Script không đọc `.env`, không reset/drop database và từ chối DB không rỗng. Nó validate/generate, migrate deploy hai lần, kiểm tra migration status và chạy integration tests với Prisma thật. Dữ liệu fixture chỉ nằm trong DB test này. Lần chạy mới cần DB test rỗng khác.

Integration kiểm tra CHECK, FK, partial unique payment/loyalty và rollback; chưa chứng minh implementation Task 10 (state machine, payment idempotency service, inventory concurrency), vốn thuộc các Sprint sau.

`test/integration/s1.integration-spec.ts` bổ sung kiểm tra HTTP qua AppModule với PostgreSQL thật: Register → Login → JWT/profile, hash/response an toàn, whitelist, credential lỗi và Menu đọc giá từ DB. Bộ này chạy cùng `test:migration`/`test:integration` và chỉ ghi fixture vào `SMOKE_DATABASE_URL` đã được kiểm tra tên.

## Hợp đồng Orders và tài liệu dữ liệu

Environment variables:
- VNPAY_ENABLED=true
- VNPAY_TMN_CODE=8-character-merchant-code
- VNPAY_HASH_SECRET=merchant-hash-secret
- VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
- VNPAY_QUERY_URL=https://sandbox.vnpayment.vn/merchant_webapi/api/transaction (QueryDr; official sandbox endpoint by default)
- VNPAY_RETURN_URL=https://api.example.com/api/v1/payments/vnpay/return
- VNPAY_IPN_URL=https://api.example.com/api/v1/payments/vnpay/ipn
- WEB_ORIGIN=https://brew.example

- POST /api/v1/payments with method VNPAY stores a PROCESSING Payment, a unique merchant reference and signed payment URL before returning the redirect URL.
- Replaying the same Idempotency-Key returns the persisted URL; it does not create a second merchant transaction.
- GET /api/v1/payments/status includes the saved payment URL for the authenticated Order owner.
- GET /api/v1/payments/vnpay/ipn validates HMAC-SHA512, merchant code and exact amount, and processes the Payment/Order transition in one transaction.
- GET /api/v1/payments/vnpay/return redirects to Checkout on the first `WEB_ORIGIN`. The signed IPN settles live VNPay transactions. A verified Sandbox Return can also settle an attempt.
- For Sandbox transactions, BrewLite can settle a signed Return before redirecting, including on hosted deployments that use the Sandbox gateway. The payment must have been created with a Sandbox payment link. IPN and Return share settlement validation and order locking.
- For local Sandbox testing, set `WEB_ORIGIN=http://localhost:3000` and `VNPAY_RETURN_URL=http://localhost:3001/api/v1/payments/vnpay/return`. Hosted production deployments require HTTPS for both URLs.
- Checkout uses VNPay as its only payment method. Enable `VNPAY_ENABLED` on the API and configure the merchant credentials to accept payments.
- When API is behind a reverse proxy, configure `TRUSTED_PROXY_CIDRS` with only the exact ingress proxy IP/CIDRs so VNPay receives the client IP rather than the proxy address; never enable blanket proxy trust.
- A real Sandbox merchant transaction, registered HTTPS IPN URL and gateway inquiry/reconciliation process still require separate acceptance. Code tests do not prove a live merchant transaction.


## Payment PROCESSING reconciliation (Issue #41)

### Architecture and safety rules

- QueryDr is an operator-triggered, single-Payment operation (bounded batch size: 1) with an 8-second provider timeout.
- Recovery uses an `Idempotency-Key` scoped to the Payment. The provider request ID is committed before QueryDr is called; replaying the same recovery key never creates another inquiry.
- QueryDr runs outside the database transaction. Settlement then locks the Order, re-reads Payment and Order, and commits Payment + Order + inventory/loyalty + coupon consumption + audit atomically.
- Provider timeout, transport failure, malformed/unsigned response, amount/merchant mismatch, and unknown/pending outcomes never set Payment to FAILED. They keep Payment PROCESSING.
- Expiry retains coupon and inventory reservations during active payments. A verified success can settle a pending order after its reservation deadline. Customers can cancel a pending VNPay order and release its reservations. If VNPay later confirms a charge for that cancelled order, the payment moves to MANUAL_REVIEW for reconciliation.
- PostgreSQL trigger rejects UPDATE and DELETE on the recovery audit table. HashSecret and signed request/response payloads are never persisted in audit.

### Provisioning an operator

Public registration always assigns CUSTOMER. Never add a role field to registration or trust a role sent by a client. A trusted database administrator must promote an existing, separately verified account:

```sql
UPDATE "users"
SET "role" = 'PAYMENT_OPERATOR'
WHERE "username" = '<approved-operator-account>';
```

The operator must sign in again to receive a JWT containing the provisioned role. Remove the role with a controlled DBA action when access is revoked.

### Recovery API

```http
POST /api/v1/payments/{paymentId}/recovery
Authorization: Bearer <operator-jwt>
Idempotency-Key: <unique-recovery-key>
X-Correlation-Id: <optional-correlation-id>
Content-Type: application/json

{ "incidentReference": "INC-2026-1042" }
```

The request is restricted to PAYMENT_OPERATOR. The server requires `VNPAY_QUERY_SERVER_IP` to be the trusted fixed egress IP configured by infrastructure; it must not come from a browser request. The API processes one Payment per call, serializes concurrent inquiries for one Payment, uses a durable lease and exponential backoff (30 seconds, doubling up to 15 minutes), and opens a process-local circuit breaker after five consecutive inquiry failures.

### Operator runbook

1. Open a P1 incident/ticket before invoking recovery. Capture Payment ID, Order ID/number, VNPay transaction reference, amount, transaction creation timestamp, last IPN evidence, response codes and correlation ID. Never collect or paste HashSecret, signed payloads or credentials into the ticket or logs.
2. Verify the operator account has PAYMENT_OPERATOR through the approved DBA access procedure. Customer and Barista accounts must receive HTTP 403. The operator must sign in again after role provisioning or revocation.
3. Call the recovery endpoint once with a new idempotency key and incident reference. A retry with the same key is a replay, not a new inquiry. The endpoint handles one Payment per request.
4. If the result is PROCESSING/UNKNOWN, do not retry immediately and do not create a new payment attempt. Observe the durable backoff/circuit-breaker response and escalate to payment operations.
5. If Payment becomes MANUAL_REVIEW, preserve the Order state and inspect the immutable audit and provider evidence. A second authorized operator must independently verify the evidence and approve any refund/reversal/compensation.
6. Refund/reversal is performed only through the approved merchant/finance procedure; this API deliberately does not issue refunds automatically. Record provider refund reference, amount, timestamp, executing operator and approving operator in the incident. Never manually force Payment to SUCCEEDED or Order to PAID to close the incident.
7. Close the incident only after provider evidence, Payment/Order consistency, coupon/inventory/loyalty state, refund evidence where applicable and immutable audit entries have been independently checked.

### Escalation SLA (operational target; requires Payment Operations ratification)

- P1 suspected charge / unresolved PROCESSING: acknowledge within 15 minutes of alert creation.
- If QueryDr remains UNKNOWN or times out: escalate to Payment Operations and gateway support within 30 minutes; provide the evidence bundle without secrets.
- MANUAL_REVIEW: assign a second operator immediately and record a refund/reversal decision within 4 business hours, or document the external dependency and next review time.
- While unresolved: update the incident at least every 30 minutes; never clear the alert solely because a Payment row is old or a browser Return page was visited.
- Incident closure: require two-person evidence review and reconciliation of Payment, Order, inventory, coupon, loyalty and any provider refund reference.

These are proposed operational targets for this repository, not an existing contractual SLA; the Payment Operations owner must ratify them before production.

### Recovery API example

```bash
curl --fail-with-body --request POST \
  "$API_BASE_URL/api/v1/payments/$PAYMENT_ID/recovery" \
  --header "Authorization: Bearer $PAYMENT_OPERATOR_JWT" \
  --header "Idempotency-Key: $RECOVERY_IDEMPOTENCY_KEY" \
  --header "X-Correlation-Id: $CORRELATION_ID" \
  --header "Content-Type: application/json" \
  --data '{"incidentReference":"INC-2026-1042"}'
```

Expected behavior:
- First request: creates a durable recovery request and audit before calling QueryDr.
- Same key + same payload: returns the stored recovery result without another inquiry.
- Same key + different incident reference: HTTP 409.
- Customer/Barista/no JWT: HTTP 403/401; no recovery request is created.
- Timeout/unknown: Payment remains PROCESSING and response reports UNKNOWN; no Order/coupon/inventory release occurs.
- Late success: Payment becomes MANUAL_REVIEW; Order is not marked PAID and refund is not automated.

### Explicitly deferred

This delivery does not provide a scheduled worker, automatic refund adapter, or merchant Sandbox acceptance. QueryDr recovery is operator-triggered and one Payment at a time. The circuit breaker is process-local; multi-replica circuit coordination remains a follow-up. Merchant Sandbox evidence is deferred by project decision and is not reported as passed.


### Manual-review disposition API

A second operator records externally verified evidence; this endpoint never sends a refund to VNPay:

```http
POST /api/v1/payments/{paymentId}/recovery/resolve
Authorization: Bearer <different-operator-jwt>
Idempotency-Key: <unique-resolution-key>
X-Correlation-Id: <optional-correlation-id>
Content-Type: application/json

{
  "decision": "REFUND_CONFIRMED",
  "evidenceReference": "VN-REFUND-2026-0001",
  "incidentReference": "INC-2026-1042"
}
```

- `REFUND_CONFIRMED`: use only after the approved merchant/finance process confirms the refund or reversal. Payment becomes REFUNDED.
- `NO_CHARGE_CONFIRMED`: use only with provider evidence proving no charge occurred. Payment becomes FAILED; retry is only possible while the Order remains eligible.
- Both decisions require a stable external evidence reference, a unique idempotency key, and a different operator from the one who initiated the human recovery that moved Payment to MANUAL_REVIEW.
- Decision, evidence reference, actor, correlation/incident and before/after state are stored in append-only resolution and audit tables in the same transaction as the Payment/Order transition.
- If Order is PENDING, it moves to PAYMENT_FAILED. Expired reservations are released once by the existing expiry job; a cancelled Order remains cancelled. This endpoint never sets Order PAID.
- Replays return the saved resolution; reusing a key with another decision/evidence returns HTTP 409.
- The operator must execute and verify the actual refund/reversal through the approved merchant/finance channel before selecting REFUND_CONFIRMED; the application does not issue or simulate a refund.
