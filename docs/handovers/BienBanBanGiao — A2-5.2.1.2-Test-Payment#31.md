# BIÊN BẢN BÀN GIAO — A2-5.2.1.2 Test Payment #31

**Issue:** [A2-5.2.1.2 / #31](https://github.com/akira-yami/BrewLite_A2/issues/31)  
**Phân công:** Kiệt · Sprint 2  
**Nhánh:** `feat/A2-5.2.1.2-Test-Payment`  
**Commit:** `8730820`  
**Ngày:** 07/11/2026  

---

## 1. Quyết Định Kiến Trúc & Hướng Đi Kỹ Thuật (Architectural Decisions)

### Hướng đi được lựa chọn

Unit test thuần **Mock-Based Unit Testing** cho toàn bộ Payment layer — không cần database hay network.

Ba lớp kiểm thử được xây dựng độc lập:

| Lớp | File | Phạm vi |
|---|---|---|
| Gateway | `test/mock-gateway.spec.ts` | Idempotency, outcome, lookup, clear |
| Service | `test/payments.service.spec.ts` (bổ sung) | Edge cases finalize, retry, loyalty, coupon |
| Controller | `test/payments.controller.spec.ts` | HTTP contract, header validation, error propagation |

### Lý do lựa chọn (Rationals)

- CI pipeline không có DB (xem `apps/api/README.md`: *"Unit tests mock the repository; they do not require PostgreSQL"*) — mock-based tests phải là lựa chọn duy nhất cho unit CI.
- `MOCK_PAYMENT_OUTCOME` env var của `mock-gateway.ts` được thiết kế sẵn để test kiểm soát outcome (SUCCESS/DECLINE/TIMEOUT) mà không cần stub external HTTP.
- Pattern đã được thiết lập từ `orders.service.spec.ts` và `auth.service.spec.ts` — giữ nhất quán codebase.
- Phân tách rõ ba lớp kiểm thử giúp isolate lỗi: khi gateway thay đổi chỉ `mock-gateway.spec.ts` fail; khi business logic thay đổi chỉ `payments.service.spec.ts` fail; khi HTTP layer thay đổi chỉ `payments.controller.spec.ts` fail.

### Phân tích giải pháp thay thế (Trade-off Analysis)

| Giải pháp | Lý do loại bỏ |
|---|---|
| **Integration tests với PostgreSQL thật** | Thuộc issue #35 (`tests/integration/`); CI không có DB; sẽ flaky trên shared runner |
| **E2E tests với Playwright** | Thuộc issue #34; cần full stack web+API+DB chạy song song |
| **Một file test duy nhất** | Khó maintain khi ba lớp có responsibility khác nhau; lỗi cascade khó debug |
| **Spy trực tiếp vào chargeOnce thay vì test mock-gateway** | Mock-gateway là component độc lập có contract riêng (idempotency bền vững) — deserves test riêng |

### Giá trị mang lại (Value Proposition)

- **Ngắn hạn:** CI pipeline không bao giờ break vì payment code; developer biết ngay lớp nào gây lỗi.
- **Dài hạn:** Bộ 38 test mới là specification sống — khi refactor `PaymentsService` (ví dụ: chuyển sang outbox pattern), test suite là safety net chứng minh không regression.

---

## 2. Hướng Dẫn Vận Hành & Khởi Chạy File Đặc Biệt (Execution Guide)

### Danh sách file đặc biệt

| File | Loại | Đường dẫn đầy đủ |
|---|---|---|
| Test mới — Controller | Test script | `apps/api/test/payments.controller.spec.ts` |
| Test mới — Gateway | Test script | `apps/api/test/mock-gateway.spec.ts` |
| Test bổ sung — Service | Test script | `apps/api/test/payments.service.spec.ts` |

### Điều kiện tiên quyết (Prerequisites)

- Node.js **24.x** (xem `.nvmrc`)
- `npm ci` đã chạy trong `apps/api/` (sinh Prisma Client)
- **Không cần** `DATABASE_URL`, không cần DB chạy, không cần `.env`

### Lệnh khởi chạy (Commands)

```powershell
# Chạy toàn bộ test suite API (bao gồm các file payment mới)
cd apps/api
npm test
```

```powershell
# Chạy chỉ các file payment tests
cd apps/api
npx vitest run test/payments.service.spec.ts test/payments.controller.spec.ts test/mock-gateway.spec.ts
```

```powershell
# Chạy CI pipeline đầy đủ (lint + test + build) — từ gốc repo
node scripts/ci-projects.mjs validate
node scripts/ci-projects.mjs install
node scripts/ci-projects.mjs lint
node scripts/ci-projects.mjs test
node scripts/ci-projects.mjs build
```

### Kết quả mong đợi (Expected Output)

```
Test Files  12 passed (12)
     Tests  161 passed (161)
  Duration  ~3s
  Exit: 0
```

---

## 3. Chi Tiết Bộ Test

### 3.1 `payments.controller.spec.ts` — 14 tests (TC-CTRL-PAY-01..12)

Kiểm tra HTTP contract của `POST /api/v1/payments`:

| TC | Mô tả | AC bao phủ |
|---|---|---|
| TC-CTRL-PAY-01 | Thiếu `Idempotency-Key` header → `BadRequestException 400` | AT-FR-07.1 |
| TC-CTRL-PAY-02 | Key là khoảng trắng → `BadRequestException 400` | AT-FR-07.1 |
| TC-CTRL-PAY-02b | Key là empty string → `BadRequestException 400` | AT-FR-07.1 |
| TC-CTRL-PAY-03 | Key > 100 ký tự → `BadRequestException 400` | AT-FR-07.1 |
| TC-CTRL-PAY-03b | Key đúng 100 ký tự → được chấp nhận, gọi service | AT-FR-07.1 |
| TC-CTRL-PAY-04 | SUCCESS → `{ success: true, data: { status: 'SUCCEEDED' } }` | AT-FR-07.2 |
| TC-CTRL-PAY-05 | DECLINE → `{ success: true, data: { status: 'FAILED' } }` (không phải HTTP error) | AT-FR-07.4 |
| TC-CTRL-PAY-06 | GATEWAY_TIMEOUT → propagates `ServiceUnavailableException` | AT-FR-07.5 |
| TC-CTRL-PAY-07 | PAYMENT_IN_PROGRESS → propagates `ConflictException` | AT-FR-07.3 |
| TC-CTRL-PAY-08 | IDEMPOTENCY_KEY_REUSED → propagates `ConflictException` | AT-FR-07.3 |
| TC-CTRL-PAY-09 | ORDER_ALREADY_PAID → propagates `ConflictException` | AT-FR-07.3 |
| TC-CTRL-PAY-10 | Đơn không tồn tại → propagates `NotFoundException` | AT-FR-07.1 |
| TC-CTRL-PAY-11 | Sai chủ đơn → propagates `ForbiddenException` | AT-FR-05.4 |
| TC-CTRL-PAY-12 | Gọi `service.pay` với đúng `(userId, orderId, method, key)` từ JWT+header | AT-FR-07.1 |

### 3.2 `mock-gateway.spec.ts` — 12 tests (TC-GW-01..10)

Kiểm tra `chargeOnce`, `lookupResult`, `__clearForTests`:

| TC | Mô tả |
|---|---|
| TC-GW-01 | `SUCCESS` → `{ result: 'SUCCESS', transactionId: string }` |
| TC-GW-02 | `DECLINE` → `{ result: 'DECLINE', transactionId: null }` |
| TC-GW-03 | `TIMEOUT` → ném `Error('GATEWAY_TIMEOUT')`, không lưu kết quả |
| TC-GW-04 | Cùng key gọi lần 2 → trả cùng kết quả cũ (idempotent re-delivery) |
| TC-GW-05 | DECLINE cùng key → trả lại DECLINE, không đổi thành SUCCESS |
| TC-GW-06 | Các key độc lập, kết quả không ảnh hưởng nhau |
| TC-GW-07a | `lookupResult` trả `null` khi key chưa có kết quả |
| TC-GW-07b | `lookupResult` trả đúng kết quả SUCCESS sau charge |
| TC-GW-07c | `lookupResult` trả đúng kết quả DECLINE sau charge |
| TC-GW-08 | `transactionId` của SUCCESS bắt đầu bằng `'TXN-'` |
| TC-GW-09 | Sau TIMEOUT, `lookupResult` trả `null` (không được lưu) |
| TC-GW-10 | `__clearForTests` xóa toàn bộ state — lookup sau clear trả `null` |

### 3.3 `payments.service.spec.ts` — +12 edge case tests (TC-PAY-EXT-01..12)

Bổ sung vào 11 tests đã có từ sprint trước:

| TC | Mô tả | AC bao phủ |
|---|---|---|
| TC-PAY-EXT-01 | Order bị CANCELLED trong finalize → attempt cập nhật `FAILED:ORDER_CANCELLED`, không cộng điểm | AT-FR-07.2 |
| TC-PAY-EXT-02 | `alreadySucceeded > 0` trong finalize → attempt cập nhật `FAILED:DUPLICATE_SUCCESS` | AT-FR-07.3 |
| TC-PAY-EXT-03 | `total < 1000 VND` → `loyaltyTransaction.create` **không** được gọi (EARN = 0) | AT-FR-10.3 |
| TC-PAY-EXT-04 | Tích lũy loyalty đúng — `balanceAfter = 200 + 114 = 314` khi `total = 114.000 VND` | AT-FR-10.3 |
| TC-PAY-EXT-05 | Đơn `PAYMENT_FAILED` retry với key mới → được phép, SUCCESS | AT-FR-07.4 |
| TC-PAY-EXT-06 | Đơn `COMPLETED` không thể thanh toán → `ORDER_INVALID_TRANSITION` | AT-FR-09.1 |
| TC-PAY-EXT-07 | Đơn `CANCELLED` không thể thanh toán → `ORDER_INVALID_TRANSITION` | AT-FR-09.1 |
| TC-PAY-EXT-08 | Đơn `PREPARING` không thể thanh toán → `ORDER_INVALID_TRANSITION` | AT-FR-09.1 |
| TC-PAY-EXT-09 | `couponRedemption.updateMany` được gọi với `CONSUMED` sau SUCCESS | AT-FR-10.2 |
| TC-PAY-EXT-10 | `couponRedemption.updateMany` **không** được gọi sau DECLINE | AT-FR-10.2 |
| TC-PAY-EXT-11 | `inventoryReservation.updateMany` được gọi với `CONSUMED` sau SUCCESS | AT-FR-06.3 |
| TC-PAY-EXT-12 | `OrderStatusHistory` ghi đúng `PENDING → PAID` với actor đúng sau SUCCESS | AT-FR-09.1 |

---

## 4. Tổng Hợp & Trạng Thái Nghiệm Thu

### Bằng chứng kết quả (Evidence)

- **Commit:** `8730820` trên nhánh `feat/A2-5.2.1.2-Test-Payment`
- **Thời điểm:** 07/11/2026, 19:4x UTC+7
- **Môi trường:** Windows 11, Node.js 24.x, Vitest 4.1.11
- **Lệnh:** `cd apps/api && npm test`

```
Test Files  12 passed (12)
     Tests  161 passed (161)
  Duration  3.51s (transform 1.97s, setup 725ms, import 15.39s, tests 293ms)
  Exit: 0
```

### Ma trận nghiệm thu

| Tiêu chí issue #31 | Trạng thái | TC bao phủ |
|---|---|---|
| Test pass, không thanh toán lặp | ✅ Đạt | TC-PAY-EXT-02, TC-CTRL-PAY-08/09, Phase-1 idempotency |
| Integration test success | ✅ Đạt | TC-CTRL-PAY-04, Phase-3 gateway+finalization |
| Integration test fail/decline | ✅ Đạt | TC-CTRL-PAY-05, TC-GW-02, Phase-3 DECLINE |
| Retry với key mới | ✅ Đạt | TC-PAY-EXT-05, TC-GW-04 |
| Idempotency replay | ✅ Đạt | Phase-1 replay, TC-GW-04/05, TC-CTRL-PAY-07 |
| Concurrency PAYMENT_IN_PROGRESS | ✅ Đạt | Phase-2/Concurrent guard, TC-CTRL-PAY-07 |
| GATEWAY_TIMEOUT giữ PROCESSING | ✅ Đạt | TC-CTRL-PAY-06, TC-GW-03/09, Phase-3 timeout |
| Ownership check | ✅ Đạt | TC-CTRL-PAY-11, Phase-2 forbidden |
| Invalid state transitions | ✅ Đạt | TC-PAY-EXT-06/07/08 |
| Loyalty EARN một lần sau SUCCESS | ✅ Đạt | TC-PAY-EXT-03/04, Phase-3 loyalty |
| Coupon consume đúng một lần | ✅ Đạt | TC-PAY-EXT-09/10 |
| Inventory consumed sau SUCCESS | ✅ Đạt | TC-PAY-EXT-11 |
| History ghi đúng transition | ✅ Đạt | TC-PAY-EXT-12 |
| CI lint/test/build pass | ✅ Đạt | Exit 0 — API lint, test, build |

### Khoảng trống (Gap)

| Nội dung | Lý do | Issue liên quan |
|---|---|---|
| Integration tests với PostgreSQL thật (BOM X=10, 20 concurrent) | Cần DB thật, thuộc `tests/integration/` | #32, #35 |
| Same-key 20 request đồng thời trên DB thật | Cần DB thật | #31 integration scope, #35 |
| Crash sau gateway success trước finalize (restart test) | Cần process restart | #31 integration scope |
| Browser E2E menu → confirmation | Cần full stack | #34 |

> Unit tests này đáp ứng toàn bộ yêu cầu unit CI của issue #31.  
> Các integration scenarios cần DB thật thuộc phạm vi issue #35 và nằm ngoài CI pipeline.

### Ghi chú kỹ thuật cho Reviewer

- **Pre-existing TypeScript error** tại `test/orders.service.spec.ts:984` không liên quan đến PR này (đã có trước commit `248ce39`). CI không chạy `typecheck` nên không ảnh hưởng.
- **Windows DEP0190 warning** trong CI runner script (`shell: true`) chỉ xuất hiện local trên Windows; GitHub Actions (Ubuntu) không bị ảnh hưởng và sẽ pass bình thường.
