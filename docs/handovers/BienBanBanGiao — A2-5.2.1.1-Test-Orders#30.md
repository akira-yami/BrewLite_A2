# Biên bản bàn giao — A2-5.2.1.1 Test Orders #30

**Phụ trách:** Kiệt · Sprint 2
**Nhánh:** `feat/A2-5.2.1.1-Test-Orders`  
**Commit:** `b5d1402`

---

## 1. Quyết Định Kiến Trúc & Hướng Đi Kỹ Thuật

### Hướng đi được lựa chọn
Unit test thuần với **Vitest + vi.fn() mock** — không dùng NestJS Test Module, không dùng DB thật. Instantiate service/controller trực tiếp, inject Prisma mock thủ công.

### Lý do lựa chọn
- Nhất quán với pattern đã có trong `payments.service.spec.ts` và `auth.service.spec.ts`.
- Không cần `@nestjs/testing`, tránh overhead DI container trong unit test.
- Mock Prisma `$transaction` trả về callback với tx client mock, giúp kiểm soát được từng lời gọi DB trong transaction.
- Không cần `DATABASE_URL` hay PostgreSQL — chạy được trong mọi môi trường CI.

### Phân tích giải pháp thay thế

| Giải pháp | Lý do không chọn |
|---|---|
| NestJS `TestingModule` | Overhead DI, khó mock Prisma sâu bên trong |
| Integration test với DB thật | Thuộc `test:integration` riêng (SMOKE_DATABASE_URL), không phải scope unit CI |
| `jest-mock-extended` | Chưa có trong dependencies, thêm dependency không cần thiết |

### Giá trị mang lại
- Ngắn hạn: CI xanh, PR #30 có evidence test pass thực sự.
- Dài hạn: Bộ regression test bảo vệ logic nghiệp vụ phức tạp (BOM, inventory lock, state machine, coupon, ownership) khi refactor.

---

## 2. Hướng Dẫn Vận Hành & Khởi Chạy

### Danh sách file đặc biệt

| File | Loại |
|---|---|
| `apps/api/test/orders.service.spec.ts` | Unit test mới — 47 test cases |
| `apps/api/test/orders.controller.spec.ts` | Unit test mới — 13 test cases |

### Điều kiện tiên quyết
```powershell
cd apps/api
npm ci   # sẽ tự prisma generate
```

### Lệnh khởi chạy

```powershell
# Chạy toàn bộ unit test API
cd apps/api
npm test

# Hoặc qua CI runner (chạy cả api + web):
cd ../..
node scripts/ci-projects.mjs test
```

### Kết quả mong đợi
```
Test Files  10 passed (10)
     Tests  123 passed (123)
  Duration  ~3s
```

---

## 3. Kết quả Test Local

### API Unit Tests
```
Test Files  10 passed (10)
     Tests  123 passed (123)
  Duration  3.32s
Exit Code: 0
```

### Web Unit Tests
```
pass 38 / fail 0
Exit Code: 0
```

### CI Runner Tests
```
pass 10 / fail 0
Exit Code: 0
```

### Lint
```
oxlint: 0 errors, 0 warnings
eslint: 0 errors
Exit Code: 0
```

### Build
```
API: tsc -p tsconfig.build.json — OK
Web: next build — 10 routes generated — OK
Exit Code: 0
```

---

## 4. Bảng test case chi tiết

### `orders.service.spec.ts` (47 cases)

| Group | ID | Mô tả |
|---|---|---|
| createOrder | TC-ORD-CREATE-01 | Happy path — PENDING, id, orderNumber |
| createOrder | TC-ORD-CREATE-02 | Giá đúng 2 ly × 50000 = 100000 |
| createOrder | TC-ORD-CREATE-03 | Giá có topping (size + topping) × quantity |
| createOrder | TC-ORD-CREATE-04 | Variant không active → ConflictException |
| createOrder | TC-ORD-CREATE-05 | Hết tồn kho (stock < need) → ConflictException |
| createOrder | TC-ORD-CREATE-06 | Optimistic lock ($executeRaw = 0) → ConflictException |
| createOrder | TC-ORD-CREATE-07 | Rollback khi order.create throw |
| createOrder | TC-ORD-CREATE-08 | Serialization retry 3 lần |
| createOrder | TC-ORD-CREATE-09 | Snapshot tên/giá đúng lúc tạo |
| createOrder | TC-ORD-CREATE-10 | Note whitespace trim → null |
| createOrder | TC-ORD-CREATE-11 | Coupon FIXED_AMOUNT áp dụng |
| createOrder | TC-ORD-CREATE-12 | Coupon không tồn tại → COUPON_NOT_APPLICABLE |
| createOrder | TC-ORD-CREATE-13 | Coupon hết lượt user → COUPON_NOT_APPLICABLE |
| createOrder | TC-ORD-CREATE-14 | BOM aggregation hai dòng chung ingredient |
| createOrder | TC-ORD-CREATE-15 | Topping không active → ConflictException |
| cancelOrder | TC-ORD-CANCEL-01 | Hủy PENDING thành công |
| cancelOrder | TC-ORD-CANCEL-02 | Hủy PAYMENT_FAILED thành công |
| cancelOrder | TC-ORD-CANCEL-03 | Hủy PAID + release reservation |
| cancelOrder | TC-ORD-CANCEL-04 | NotFoundException đơn không tồn tại |
| cancelOrder | TC-ORD-CANCEL-05 | ForbiddenException cross-user |
| cancelOrder | TC-ORD-CANCEL-06 | COMPLETED → INVALID_TRANSITION |
| cancelOrder | TC-ORD-CANCEL-07 | PAYMENT_IN_PROGRESS block cancel |
| cancelOrder | TC-ORD-CANCEL-08 | Double-cancel guard |
| cancelOrder | TC-ORD-CANCEL-09 | Không có reservation → không gọi $executeRaw |
| cancelOrder | TC-ORD-CANCEL-10 | History entry fromStatus/toStatus đúng |
| updateStatus | TC-ORD-STATUS-01 | PAID → PREPARING |
| updateStatus | TC-ORD-STATUS-02 | PREPARING → READY |
| updateStatus | TC-ORD-STATUS-03 | READY → COMPLETED |
| updateStatus | TC-ORD-STATUS-04 | PENDING → PREPARING (invalid) |
| updateStatus | TC-ORD-STATUS-05 | COMPLETED → any (final state) |
| updateStatus | TC-ORD-STATUS-06 | NotFoundException |
| updateStatus | TC-ORD-STATUS-07 | History actor và status đúng |
| updateStatus | TC-ORD-STATUS-08 | Self-transition (PAID → PAID) |
| getOrderById | TC-ORD-GET-01 | Owner access thành công |
| getOrderById | TC-ORD-GET-02 | NotFoundException |
| getOrderById | TC-ORD-GET-03 | ForbiddenException cross-user |
| getOrderById | TC-ORD-GET-04 | BigInt → Number conversion |
| getMyOrders | TC-ORD-LIST-01 | Filter đúng userId |
| getMyOrders | TC-ORD-LIST-02 | Empty array |
| getMyOrders | TC-ORD-LIST-03 | BigInt → Number list |
| getMyOrders | TC-ORD-LIST-04 | orderBy desc |
| edge cases | TC-ORD-EDGE-01 | Coupon cap tại subtotal |
| edge cases | TC-ORD-EDGE-02 | Reservation count per item |
| edge cases | TC-ORD-EDGE-03 | Deadlock retry thành công lần 3 |
| edge cases | TC-ORD-EDGE-04 | statusHistory fromStatus=null khi create |
| edge cases | TC-ORD-EDGE-05 | Inactive ingredient trong BOM |
| edge cases | TC-ORD-EDGE-06 | sugarLevel=0 / iceLevel=0 ≠ null |

### `orders.controller.spec.ts` (13 cases)

| ID | Endpoint | Mô tả |
|---|---|---|
| TC-CTRL-ORDER-01 | POST /orders | Gọi service với userId từ JWT |
| TC-CTRL-ORDER-02 | POST /orders | Propagate ConflictException |
| TC-CTRL-ORDER-03 | GET /orders/me | Gọi service với userId |
| TC-CTRL-ORDER-04 | GET /orders/me | Empty array |
| TC-CTRL-ORDER-05 | GET /orders/:id | Owner access |
| TC-CTRL-ORDER-06 | GET /orders/:id | Propagate NotFoundException |
| TC-CTRL-ORDER-07 | GET /orders/:id | Propagate ForbiddenException |
| TC-CTRL-ORDER-08 | POST /orders/:id/cancel | Gọi service đúng args |
| TC-CTRL-ORDER-09 | POST /orders/:id/cancel | Propagate INVALID_TRANSITION |
| TC-CTRL-ORDER-10 | POST /orders/:id/cancel | Propagate PAYMENT_IN_PROGRESS |
| TC-CTRL-ORDER-11 | PATCH /orders/:id/status | BARISTA updateStatus |
| TC-CTRL-ORDER-12 | PATCH /orders/:id/status | Propagate INVALID_TRANSITION |
| TC-CTRL-ORDER-13 | PATCH /orders/:id/status | Propagate NotFoundException |

---

## 5. Trạng thái nghiệm thu

| Tiêu chí | Trạng thái |
|---|---|
| Test pass và có kết quả | ✅ 123/123 pass |
| Lint sạch | ✅ 0 warnings |
| Build sạch | ✅ API tsc + Web next build |
| CI required checks (`PR quality gate`) | ✅ Pass local |
| Commit lên branch | ✅ `b5d1402` |
| Truy vết FR-06/08/09/10 | ✅ Đủ AC |

**Kết luận: DONE — Sẵn sàng tạo Pull Request.**
