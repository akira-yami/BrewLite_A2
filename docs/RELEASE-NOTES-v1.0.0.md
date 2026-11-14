# Release Notes — BrewLite A2 v1.0.0

**Tag:** `v1.0.0`  
**Ngày phát hành:** 07/11/2026  
**Nhánh:** `feat/A2-5.4.2-Release-va-ban-giao` → merge vào `main`  
**Issue:** [A2-5.4.2 / #40](https://github.com/akira-yami/BrewLite_A2/issues/40)  
**Phân công:** Kiệt · Sprint 2

---

## Tóm tắt

Đây là phiên bản đầu tiên và cũng là phiên bản hoàn chỉnh của **BrewLite A2** — ứng dụng đặt đồ uống tại quầy end-to-end, được phát triển trong Assignment 2. Phiên bản này bao gồm đầy đủ luồng nghiệp vụ từ xem menu → giỏ hàng → đặt đơn → thanh toán → xác nhận/lịch sử.

---

## Tính năng mới trong v1.0.0

### Backend — NestJS API (`apps/api`)

| Module | Tính năng |
|--------|-----------|
| **Auth** | Đăng ký CUSTOMER, đăng nhập JWT (HS256 tự triển khai, constant-time compare), `GET /auth/me` |
| **Catalog** | `GET /products` và `GET /products/:id` — catalog với BOM/ingredient availability |
| **Orders** | `POST /orders` (Serializable TX, BOM, reservation), `GET /orders/me`, `GET /orders/:id`, `POST /orders/:id/cancel`, `PATCH /orders/:id/status` (BARISTA) |
| **Payments** | `POST /payments` — idempotency key, mock gateway success/decline/timeout, loyalty EARN |
| **Inventory** | Reservation system, InventoryReservationItem snapshot, conditional UPDATE stockQuantity/version |
| **Coupon/Loyalty** | CouponRedemption RESERVED→CONSUMED/RELEASED, LoyaltyTransaction EARN = floor(total/1000) |
| **Health** | `GET /api/v1/health` — readiness probe |
| **State machine** | Order states: PENDING → PAID/PAYMENT_FAILED → PREPARING → READY → COMPLETED/CANCELLED |

### Frontend — Next.js Web (`apps/web`)

| Route | Tính năng |
|-------|-----------|
| `/menu` | Menu catalog, loading/empty/error/retry states, mobile-first Tailwind CSS |
| `/menu/:productId` | Detail modal với size, topping, sugar/ice/note, available inventory |
| `/login`, `/register` | Đăng nhập/đăng ký, JWT session, React Query |
| `/checkout` | Giỏ hàng persist localStorage, checkout form, coupon input, submit order |
| `/orders` | Lịch sử đơn của chính user |
| `/orders/[id]` | Chi tiết đơn, timeline trạng thái |
| `/orders/confirmation` | Trang xác nhận sau thanh toán |
| `/health` | Liveness endpoint |

### Testing

- **API**: 161 unit tests (Vitest) — auth, catalog, orders, payments, JWT, state machine, recipe capacity
- **Web**: 38 unit tests (Node test runner) — cart store, menu UI states, API client, payment/checkout
- **CI**: GitHub Actions `pr-ci.yml` với required check `PR quality gate`

### Infrastructure

- `apps/api/Dockerfile.railway` — multi-stage build cho Railway deployment
- `apps/api/scripts/smoke.mjs` — smoke test 4 checks sau deploy
- `docs/evidence/cd/rollback-guide.md` — hướng dẫn rollback đầy đủ
- `docker-compose.yml` — cấu hình web/API/PostgreSQL local (placeholder, chờ #36)

---

## Sửa lỗi trong v1.0.0

- **JWT constant-time comparison**: sửa trường hợp edge case khi base64url decode ra buffer có độ dài khác nhau dẫn đến `timingSafeEqual` throw sai error type, không khớp regex `/invalid signature/`. Fix: kiểm tra lengths trước, wrap `timingSafeEqual` trong try-catch.

---

## Cách bắt đầu (Quick Start)

### Yêu cầu

- Node.js 24.x (`node -v` phải ra `v24.x.x`)
- npm (đi kèm Node.js)
- PostgreSQL đang chạy (cho `apps/api` runtime)

### Clone và cài đặt

```powershell
git clone https://github.com/akira-yami/BrewLite_A2.git
cd BrewLite_A2
```

### Chạy API (backend)

```powershell
cd apps/api
npm ci

# Tạo .env từ mẫu
Copy-Item ..\..\\.env.example .env
# Sửa .env: thay DATABASE_URL, JWT_SECRET

# Chạy migration và seed
npm run prisma:deploy
npm run db:seed

# Start server
npm run build
npm start
# → API chạy tại http://localhost:3001
```

### Chạy Web (frontend)

```powershell
cd apps/web
npm ci

# Tạo .env.local
Set-Content .env.local "NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1"

# Start development server
npm run dev
# → Web chạy tại http://localhost:3000
```

### CI local (từ gốc repo)

```powershell
# Validate
node scripts/ci-projects.mjs validate

# Lint (không cần DB)
node scripts/ci-projects.mjs lint

# Unit test (không cần DB)
node scripts/ci-projects.mjs test

# Build (không cần DB)
node scripts/ci-projects.mjs build
```

**Kết quả mong đợi:**
```
CI test: apps/api → 161 tests passed
CI test: apps/web → 38 tests passed
```

---

## Kết quả CI (Evidence)

| Bước | API | Web |
|------|-----|-----|
| Lint | ✅ oxlint, 0 warnings | ✅ ESLint, 0 errors |
| Unit Test | ✅ 161/161 passed | ✅ 38/38 passed |
| Build | ✅ tsc + dist/ | ✅ Next.js standalone |

**Tổng: 199 tests, 0 failed**

---

## Hướng dẫn Rollback

Xem hướng dẫn chi tiết tại: [`docs/evidence/cd/rollback-guide.md`](evidence/cd/rollback-guide.md)

Tóm tắt:
1. **App revision rollback**: Railway Dashboard → Deployments → Redeploy revision cũ (~60-120s)
2. **Schema rollback**: tạo migration mới đảo ngược thay đổi → push → Railway auto-apply
3. **Data restore**: `pg_restore` từ backup vào DB test riêng, không restore thẳng vào production

---

## Phụ thuộc và môi trường biến

| Biến | Mô tả |
|------|-------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key ngẫu nhiên (>=32 chars) |
| `JWT_EXPIRES_IN` | TTL token (mặc định `15m`) |
| `PORT` | API port (mặc định `3001`) |
| `CORS_ORIGIN` | Web origin (mặc định `http://localhost:3000`) |
| `RESERVATION_TTL_SECONDS` | Thời gian giữ tồn (mặc định `900`) |
| `PAYMENT_PROVIDER` | `mock` (MVP chỉ mock) |
| `NEXT_PUBLIC_API_BASE_URL` | API base URL cho web bundle |

---

## Khoảng trống đã biết (Known Gaps)

| Nội dung | Issue | Ưu tiên |
|----------|-------|---------|
| Docker Compose web/API/PostgreSQL local | #36 | Must |
| Browser E2E (Playwright) | #34 | Must |
| Production HTTPS/Railway deployment A2 | #39 | Must |
| CD quality gate (image + smoke trên CI) | #37 | Must |
| Rollback diễn tập thực tế trên Railway | #38 | Must |
| Traceability matrix hoàn chỉnh | #41 | Must |

---

## Tạo phẩm bàn giao (Deliverables)

- **Production Frontend (HTTPS):** [https://web-a2-production.up.railway.app/menu](https://web-a2-production.up.railway.app/menu)
- **Production API & Health Check:** [https://api-a2-production.up.railway.app/api/v1/health](https://api-a2-production.up.railway.app/api/v1/health)
- **Video Demo Trực tiếp Luồng End-to-End (Google Drive):** [Xem thư mục video demo](https://drive.google.com/drive/folders/1R0mMpga32tXJx-Pg-UcuiGaUncPrsqSE?hl=vi)
- **Hướng dẫn kịch bản demo và tài khoản test:** [`demo/README.md`](../demo/README.md)

---

## Liên quan

- [Repository](https://github.com/akira-yami/BrewLite_A2)
- [Video Demo & Bàn giao (Google Drive)](https://drive.google.com/drive/folders/1R0mMpga32tXJx-Pg-UcuiGaUncPrsqSE?hl=vi)
- [Hướng dẫn Demo](../demo/README.md)
- [Issue #40](https://github.com/akira-yami/BrewLite_A2/issues/40)
- [CI/CD workflow](../.github/workflows/pr-ci.yml)
- [Architecture](architecture/system-architecture.md)
- [SRS](requirements/srs.md)
- [Test Plan](testing/test-plan.md)
