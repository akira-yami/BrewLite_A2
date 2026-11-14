# Biên Bản Bàn Giao — A2-5.1.5 Thanh toán Ví/Thẻ mô phỏng

**Issue:** [#29](https://github.com/akira-yami/BrewLite_A2/issues/29) · **Branch:** `feat/A2-5.1.5-Thanh-toan-Vi-The-mo-phong`
**Commit:** `74af270` · **Ngày:** 07/11/2026 · **Phụ trách:** Kiệt

---

## 1. Quyết Định Kiến Trúc & Hướng Đi Kỹ Thuật

### Hướng đi được lựa chọn

**4-Phase Payment Pipeline** với `PaymentsController → PaymentsService → MockGateway → PostgreSQL`:

| Phase | Nội dung | Bảo vệ |
|---|---|---|
| Phase 1 | Ownership check (`userId == order.userId`) | Trước mọi tra cứu idempotency — ngăn replay của người khác |
| Phase 2 | Idempotency guard (lookup `payment.idempotencyKey`) | Replay → trả kết quả cũ; hash mismatch → 409 REUSED |
| Phase 3 | Tạo attempt PROCESSING + lock order (short tx) | Ngăn 2 PROCESSING đồng thời; ngăn SUCCEEDED thứ hai |
| Phase 4 | Gọi gateway NGOÀI transaction → finalize trong tx mới | Không giữ DB lock dài khi chờ gateway |

### Lý do lựa chọn

- **Ownership trước idempotency**: SRS AT-FR-05.4 yêu cầu không lộ kết quả payment của đơn người khác ngay cả khi biết key — phải verify chủ sở hữu *trước* khi trả replay.
- **Gateway ngoài transaction**: giữ lock DB trong khi chờ response HTTP từ gateway tạo deadlock tiềm ẩn và giảm throughput.
- **Durable mock kết quả**: `chargeOnce()` lưu kết quả in-memory theo key → lookup sau restart (AT-FR-07.5 recovery).
- **DB partial unique index**: `uq_one_successful_payment_per_order` + `uq_earn_per_order` là hàng rào cuối chặn kép ngay cả khi application logic race.

### Phân tích giải pháp thay thế

| Phương án | Lý do loại bỏ |
|---|---|
| Gọi gateway BÊN TRONG transaction | Lock DB dài; nếu gateway chậm 5s → toàn bộ request chờ |
| Chỉ dùng unique key, không lock order | Cho phép 2 key khác nhau cùng charge 1 order |
| Idempotency check TRƯỚC ownership check | User B có thể replay key của A và nhận kết quả → vi phạm AT-FR-05.4 |
| Status check đơn thuần không dùng DB constraint | Race condition trong finalize → EARNED/SUCCEEDED kép |

### Giá trị mang lại

- **Không giao dịch trùng**: AC chính của issue #29 đạt — DB constraint + application guard bảo vệ 2 lớp.
- **AT-FR-07.1–07.5 coverage**: 14 unit tests bao phủ toàn bộ acceptance criteria payment.
- **CI clean**: 0 lỗi lint/typecheck, 101 unit tests pass (63 API + 38 Web).
- **Frontend aligned**: `checkout/page.tsx` xử lý đúng DECLINE, TIMEOUT, PROCESSING, ORDER_EXPIRED với giỏ hàng an toàn.

---

## 2. Hướng Dẫn Vận Hành & Khởi Chạy File Đặc Biệt

### Danh sách file đặc biệt

| File | Loại | Vai trò |
|---|---|---|
| `apps/api/prisma/migrations/20261107090000_payment_constraints/migration.sql` | DB Migration | Tạo unique index + CHECK constraint cho payment |
| `apps/api/src/modules/payments/payments.controller.ts` | API Controller | `POST /api/v1/payments` |
| `apps/api/src/modules/payments/payments.module.ts` | NestJS Module | Wire controller + service |
| `apps/api/src/app.module.ts` | Root Module | Import AuthModule, OrdersModule, PaymentsModule |
| `apps/api/test/unit/payments.service.spec.ts` | Unit Test | 14 test cases AT-FR-07.1–07.5 |

### Điều kiện tiên quyết

```powershell
# Biến môi trường cần thiết (apps/api/.env)
DATABASE_URL=postgresql://brewlite:PASSWORD@localhost:5432/brewlite
JWT_SECRET=<random-secret>
PAYMENT_PROVIDER=mock
RESERVATION_TTL_SECONDS=900

# Để test gateway outcomes (chỉ cho development/test):
MOCK_PAYMENT_OUTCOME=SUCCESS   # hoặc DECLINE hoặc TIMEOUT
```

### Lệnh khởi chạy

```powershell
# 1. Chạy migration (chỉ khi có DB thật)
cd apps/api
npm run db:migrate

# 2. Chạy toàn bộ unit tests
npm test

# 3. Khởi động API server (cần DB)
npm run build && npm start

# 4. Test endpoint thủ công (cần JWT từ POST /api/v1/auth/login)
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/payments" `
  -Method POST `
  -Headers @{ "Authorization"="Bearer <token>"; "Idempotency-Key"="key-001" } `
  -ContentType "application/json" `
  -Body '{"orderId":"<uuid>","method":"E_WALLET"}'
```

### Kết quả mong đợi

```json
// SUCCESS
{ "success": true, "data": { "id": "<uuid>", "status": "SUCCEEDED", "orderId": "<uuid>" } }

// DECLINED
{ "success": true, "data": { "id": "<uuid>", "status": "FAILED", "orderId": "<uuid>" } }

// TIMEOUT (503)
{ "statusCode": 503, "message": "GATEWAY_TIMEOUT" }

// Replay cùng key (idempotent)
{ "success": true, "data": { "id": "<uuid>", "status": "SUCCEEDED", "orderId": "<uuid>" } }
// → kết quả giống lần đầu, không charge mới
```

---

## 3. Kết Quả Kiểm Thử CI Local

### API Unit Tests (Vitest)

```
Test Files  8 passed (8)
Tests       63 passed (63)
Duration    1.65s
```

| Suite | Tests | Kết quả |
|---|---|---|
| payments.service.spec.ts | 14 | ✅ |
| auth.service.spec.ts | 9 | ✅ |
| catalog.service.spec.ts | 5 | ✅ |
| order-state.spec.ts | 6 | ✅ |
| jwt.spec.ts | 5 | ✅ |
| recipe-capacity.spec.ts | 14 | ✅ |
| catalog-seed.integration-spec.ts | 4 | ✅ |

### Web Unit Tests (Node test runner)

```
tests 38 | pass 38 | fail 0
```

### CI Pipeline

| Step | Exit Code | Ghi chú |
|---|---|---|
| `node --test ci-projects.test.mjs` | ✅ 0 | 10/10 runner self-tests |
| `ci-projects.mjs validate` | ✅ 0 | manifests + lockfiles OK |
| `ci-projects.mjs lint` | ✅ 0 | oxlint (API) + ESLint (Web) |
| `ci-projects.mjs test` | ✅ 0 | 63 + 38 = 101 tests |
| `ci-projects.mjs build` | ✅ 0 | tsc + next build |
| `npm run typecheck` (API) | ✅ 0 | 0 TS errors |

### Tiêu chí AC đã đạt

| AC | Mô tả | Trạng thái |
|---|---|---|
| AT-FR-07.1 | Amount từ server; key bắt buộc; method validate | ✅ |
| AT-FR-07.2 | SUCCESS → SUCCEEDED + PAID + consume reservation + EARN 1 lần | ✅ |
| AT-FR-07.3 | Replay cùng key → trả kết quả cũ; PROCESSING → 409; hash khác → 409; key mới cùng order đã paid → block | ✅ |
| AT-FR-07.4 | DECLINE → FAILED + PAYMENT_FAILED; giữ reservation; retry key mới | ✅ |
| AT-FR-07.5 | TIMEOUT → 503 tạm thời; giữ PROCESSING; không charge mới | ✅ |
| AT-FR-10.3 | floor(total/1000) điểm EARN; chỉ 1 EARN/order | ✅ |
| AT-FR-05.4 | User B không replay key của A (ownership check trước idempotency) | ✅ |

---

## 4. Danh Sách Thay Đổi

### API (`apps/api`)

| File | Loại | Mô tả |
|---|---|---|
| `src/app.module.ts` | Modified | Import AuthModule + OrdersModule + PaymentsModule |
| `src/modules/payments/payments.controller.ts` | **New** | `POST /payments`, Idempotency-Key guard, CUSTOMER-only |
| `src/modules/payments/payments.module.ts` | **New** | NestJS module wiring |
| `prisma/migrations/20261107090000_payment_constraints/migration.sql` | **New** | Unique index + CHECK constraints |
| `test/unit/payments.service.spec.ts` | **New** | 14 unit tests AT-FR-07.1–07.5 |
| `test/unit/auth.service.spec.ts` | Fixed | Xóa vi.fn generic incompatible với TS6 (typecheck clean) |

### Web (`apps/web`)

| File | Loại | Mô tả |
|---|---|---|
| `src/types/checkout.contract.ts` | Modified | Align `PaymentResponse` với backend thực tế |
| `src/app/checkout/page.tsx` | Modified | Chỉ check `payment.status`; thread `failureCode` |

---

## 5. Gap & Việc Còn Lại

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Integration test PostgreSQL thật (AT-FR-06.4 concurrency) | ⚠️ Chưa có | Cần DB thật; thuộc issue #31 |
| Recovery job expiry (AT-FR-09.2) | ⚠️ Chưa có | Thuộc issue #28/#38 |
| Browser E2E checkout flow | ⚠️ Chưa có | Thuộc issue #34 |
| Migration chạy từ DB rỗng (smoke) | ⚠️ Chưa verify | Cần PostgreSQL local; thuộc issue #35 |
| Tỷ lệ loyalty floor(total/1000) | ⚠️ Chờ PO review | Ghi trong code comment + SRS |
