# BIÊN BẢN BÀN GIAO — A2-5.3.2 Migration & Rollback Production #38

**Issue:** [A2-5.3.2 / #38](https://github.com/akira-yami/BrewLite_A2/issues/38)  
**Phân công:** Kiệt · Sprint 2  
**Nhánh:** `feat/A2-5.3.2-Migration-&-rollback-production`  
**Ngày:** 07/11/2026  
**Dependency:** #35 (migration/seed), #37 (CD quality gate)

---

## 1. Quyết Định Kiến Trúc & Hướng Đi Kỹ Thuật (Architectural Decisions)

### Hướng đi được lựa chọn

**Forward-only migration với fail-stop deployment** — không có lệnh `migrate revert`; rollback schema luôn được thực hiện bằng migration mới đi ngược thay đổi. Rollback ứng dụng (app revision) thực hiện qua Railway Dashboard (Redeploy revision cũ) hoặc Railway CLI, độc lập với migration.

Bốn thành phần được xây dựng:

| Thành phần | File | Mục đích |
|---|---|---|
| Dockerfile.railway API | `apps/api/Dockerfile.railway` | Build/deploy NestJS trên Railway |
| .dockerignore API | `apps/api/.dockerignore` | Giảm image size, không đưa secrets vào build context |
| Scripts mới (package.json) | `apps/api/package.json` | `prisma:deploy`, `db:status`, `smoke` aliases |
| Smoke test | `apps/api/scripts/smoke.mjs` | Kiểm tra API healthy sau deploy/rollback |
| Rollback guide | `docs/evidence/cd/rollback-guide.md` | Hướng dẫn vận hành đầy đủ, evidence checklist NFR-11 |
| README update | `apps/api/README.md` | Migration/rollback commands cho team |

### Lý do lựa chọn (Rationals)

1. **Fail-stop là yêu cầu bắt buộc của issue #38:** "Deploy lỗi dừng; có cách rollback." Railway pre-deploy command (`npm run prisma:deploy`) thực hiện đúng điều này — exit 1 từ `prisma migrate deploy` ngăn container mới start, traffic giữ nguyên revision cũ.

2. **Forward-only migration là tiêu chuẩn Prisma:** Prisma không hỗ trợ `migrate revert` natively. Cố gắng xóa/sửa migration đã apply sẽ gây inconsistency giữa `_prisma_migrations` table và schema thực tế trên production. Forward-only an toàn và có thể kiểm chứng qua `prisma migrate status`.

3. **Smoke test dùng Node bare (không dependencies):** Script `smoke.mjs` dùng `node:fetch` built-in (Node 18+), không cần `npm install`. Có thể chạy ngay sau deploy mà không cần thiết lập thêm gì.

4. **`prisma:deploy` alias:** Railway A1 đang dùng `npm run prisma:deploy` làm pre-deploy command. Alias này giữ tương thích với config Railway hiện tại khi chuyển source sang A2, không cần sửa Railway settings.

5. **Rollback guide theo NFR-11 (AT-NFR-11, TC-NFR-11):** "Rollback app ≤10 phút, không mất đơn đã commit." Hướng dẫn ghi đủ 4 scenarios (fail-stop, app revision rollback, schema rollback, data restore) với lệnh copy-paste.

### Phân tích giải pháp thay thế (Trade-off Analysis)

| Giải pháp | Lý do loại bỏ |
|---|---|
| **`prisma migrate reset`** | Xóa toàn bộ DB — chỉ dùng development, không bao giờ trên production |
| **Sửa migration đã apply** | Vi phạm immutability của migration history; gây conflict với `_prisma_migrations` table |
| **Blue/Green deployment** | Phức tạp với Railway free tier, cần cấu hình load balancer; vượt phạm vi MVP |
| **Database branching (Neon/PlanetScale)** | Không dùng PostgreSQL Railway; thêm nhà cung cấp ngoài thiết kế ban đầu |
| **Smoke test bằng Jest/Vitest** | Cần `npm install` → chậm hơn; smoke script cần chạy nhanh ngay sau deploy |
| **Rollback script tự động** | Cần secrets Railway trong CI để trigger — vượt phạm vi issue này; rollback thủ công đủ cho demo |

### Giá trị mang lại (Value Proposition)

- **Ngắn hạn:** Team có thể deploy API lên Railway với confidence: migration fail → traffic không bị ảnh hưởng; migration pass → API start với schema đúng.
- **Ngắn hạn:** Smoke test 4 checks chạy <15 giây, phát hiện ngay deployment hoặc rollback có vấn đề.
- **Dài hạn:** Rollback guide và evidence checklist là tài liệu vận hành sống — khi cần rollback thật sự, team có hướng dẫn rõ ràng và không cần improvise dưới áp lực thời gian.
- **Dài hạn:** Dockerfile.railway API cho phép tiếp tục theo dõi cùng pattern với Dockerfile.railway Web đã có, nhất quán quy trình build.

---

## 2. Hướng Dẫn Vận Hành & Khởi Chạy File Đặc Biệt (Execution Guide)

### Danh sách file đặc biệt

| File | Loại | Đường dẫn đầy đủ |
|---|---|---|
| Dockerfile Railway API | Docker build | `apps/api/Dockerfile.railway` |
| Docker ignore API | Docker config | `apps/api/.dockerignore` |
| Smoke test script | Node script (no deps) | `apps/api/scripts/smoke.mjs` |
| Rollback guide | Vận hành | `docs/evidence/cd/rollback-guide.md` |

### Điều kiện tiên quyết (Prerequisites)

**Dockerfile.railway:**
- Docker Desktop (build local) hoặc Railway (build cloud)
- Không cần `DATABASE_URL` ở build time — chỉ cần ở runtime

**Smoke test script:**
- Node.js 18+ (dùng built-in `fetch`) — không cần `npm install` gì thêm
- API target phải đang chạy và có `GET /api/v1/health` và `GET /api/v1/products`

**Migration scripts (db:migrate, prisma:deploy, db:status):**
- `DATABASE_URL` trong `apps/api/.env` (local) hoặc Railway Variables (production)
- `npm ci` đã chạy trong `apps/api/` để có Prisma CLI

### Lệnh khởi chạy (Commands)

```powershell
# ── Smoke test ────────────────────────────────────────────────────────────
# Local
node apps/api/scripts/smoke.mjs http://localhost:3001

# Production (thay bằng URL thật)
node apps/api/scripts/smoke.mjs https://api-production-1be6.up.railway.app

# Với env var
$env:BASE_URL = "https://api-production-1be6.up.railway.app"
node apps/api/scripts/smoke.mjs

# ── Migration commands ───────────────────────────────────────────────────
# Xem trạng thái migration
cd apps/api
npm run db:status

# Apply migration (local)
npm run db:migrate

# Apply migration (alias Railway pre-deploy)
npm run prisma:deploy

# ── Build Docker image locally ───────────────────────────────────────────
# Build từ apps/api/ (đặt context đúng)
docker build -f apps/api/Dockerfile.railway -t brewlite-api:local apps/api/

# ── Full CI pipeline local (từ gốc repo) ────────────────────────────────
node scripts/ci-projects.mjs validate
node scripts/ci-projects.mjs lint
node scripts/ci-projects.mjs test
node scripts/ci-projects.mjs build
```

### Kết quả mong đợi (Expected Output)

**Smoke test (pass):**
```
🔍  Smoke test — https://api-production-1be6.up.railway.app
    Started at: 2026-11-07T13:52:00.000Z
    Timeout: 10000ms per request | Retries: 3

  ✅  GET /api/v1/health → 200 với DB connectivity
  ✅  GET /api/v1/products → 200 array response
  ✅  GET /api/v1/products/:nonExistentId → 404
  ✅  GET /api/v1/products/not-a-uuid → 400

────────────────────────────────────────
  Passed: 4/4
  Failed: 0/4
────────────────────────────────────────

✅  Smoke test PASSED. API is healthy.
```

**Migration status (tất cả applied):**
```
Prisma schema loaded from prisma/schema.prisma
...
✔  Applied migrations: 20260925100913_init ... 20261107090000_payment_constraints
No pending migrations
```

---

## 3. Chi Tiết Kỹ Thuật

### 3.1 Dockerfile.railway — Multi-stage build

```
base → dependencies (npm ci + prisma generate) → build (tsc) → runtime (dist/ only)
```

- Stage `dependencies`: `npm ci` với cache mount → `prisma generate` (postinstall) sinh ra `src/generated/prisma`
- Stage `build`: copy full source, `npm run build` → `tsc -p tsconfig.build.json` → `dist/`
- Stage `runtime`: chỉ copy `dist/`, `src/generated/`, `node_modules/`, `package.json`, `prisma/` — không copy source `.ts`
- HEALTHCHECK: `wget -qO- http://localhost:3001/api/v1/health` mỗi 30s
- USER node (non-root)

### 3.2 Smoke test — 4 checks

| Check | Mục đích |
|---|---|
| `GET /health → 200` | API running + DB connected |
| `GET /products → 200 array` | Catalog endpoint hoạt động |
| `GET /products/<non-existent-uuid> → 404` | Error handling không gây 500 |
| `GET /products/not-a-uuid → 400` | Validation hoạt động, không gây 500 |

Retry mechanism: 3 lần, delay 2s giữa các lần → tổng tối đa 10+10+10+2+2 = 34s per check.

### 3.3 Migration strategy

```
Deployment mới:
  pre-deploy: npm run prisma:deploy
  ├── Success → Railway start container mới → traffic chuyển sang
  └── Fail (exit 1) → Railway giữ container cũ → traffic không bị ảnh hưởng

Rollback:
  Option A (app revision, schema compatible):
    Railway Dashboard → Deployments → Redeploy revision cũ → ~60-120s
  Option B (schema rollback):
    Tạo migration mới đảo ngược → push → Railway apply tự động
```

---

## 4. Tổng Hợp & Trạng Thái Nghiệm Thu

### Bằng chứng kết quả CI (Evidence)

- **Thời điểm:** 07/11/2026, ~20:54 UTC+7
- **Môi trường:** Windows 11, Node.js 24.x, Vitest 4.1.11

```
CI lint:  API ✅ (oxlint --deny-warnings)  |  Web ✅ (eslint)
CI test:  API ✅ 12 files, 161 tests pass  |  Web ✅ 38 tests pass
CI build: API ✅ tsc -p tsconfig.build.json  |  Web ✅ Next.js 16.3.6
CI runner tests: ✅ 10/10 pass
```

**Tổng tests: 199 passed, 0 failed**

### Ma trận nghiệm thu issue #38

| Tiêu chí issue #38 | Trạng thái | Bằng chứng |
|---|---|---|
| Deploy lỗi dừng (fail-stop) | ✅ Thiết kế xong | Railway pre-deploy `prisma:deploy` → exit 1 dừng deploy |
| Có cách rollback | ✅ Tài liệu xong | `rollback-guide.md` mục 3 (app revision) + mục 3.3 (schema) |
| Smoke test sau deploy | ✅ Script xong | `apps/api/scripts/smoke.mjs` — 4 checks, retry, exit 0/1 |
| Backup/restore hướng dẫn | ✅ Tài liệu xong | `rollback-guide.md` mục 4 và 5 (pg_dump, pg_restore) |
| Evidence checklist NFR-11 | ✅ Tài liệu xong | `rollback-guide.md` mục 7 |
| Dockerfile.railway API | ✅ File xong | `apps/api/Dockerfile.railway` |
| CI lint/test/build pass | ✅ Xác nhận local | 199 tests pass, build exit 0 |
| README cập nhật | ✅ Hoàn thành | `apps/api/README.md` thêm migration section |

### Ma trận nghiệm thu NFR-11 (TC-NFR-11)

| Tiêu chí AT-NFR-11 | Trạng thái | Ghi chú |
|---|---|---|
| CI required check chặn merge khi fail | ✅ Hoạt động | PR CI GitHub Actions (có từ #24) |
| Migration apply trước start | ✅ Thiết kế xong | Railway pre-deploy config |
| Smoke test sau deploy | ✅ Script xong | `smoke.mjs` exit 0/1 |
| Rollback app ≤10 phút | ⚠ Chưa diễn tập | Chờ deployment A2 production (#39) |
| Không mất đơn sau rollback | ⚠ Chưa có data | Chờ DB production có orders thật |
| Backup/restore với data thật | ⚠ Chưa có data | Chờ DB production (#36/#37/#39) |
| Evidence smoke run thật | ⚠ Chưa có URL | Chờ production URL A2 |

### Khoảng trống (Gap)

| Nội dung | Lý do | Issue liên quan |
|---|---|---|
| Diễn tập rollback thật trên Railway | Chưa có deployment A2 production | #37, #39 |
| Smoke test với production URL thật | Chưa có URL A2 production | #39 |
| Backup/restore với orders thật | Chưa có DB production | #36, #37 |
| Evidence timing rollback ≤10 phút | Cần production environment | #38 completion |

> **Gap hợp lệ theo DoD:** Issue #38 phụ thuộc vào #35 (migration/seed) và #37 (CD quality gate). Hướng dẫn, script và Dockerfile được hoàn thiện đầy đủ; evidence thực thi sẽ bổ sung khi infrastructure A2 production sẵn sàng.

### Ghi chú kỹ thuật cho Reviewer

- `prisma:deploy` là alias mới của `db:migrate` — cả hai đều chạy `prisma migrate deploy`. Alias này khớp với pre-deploy command Railway A1 đang dùng (`npm run prisma:deploy`), giúp giảm friction khi chuyển source sang A2.
- `smoke.mjs` không có dependencies → không cần `npm install` ở deployment pipeline.
- Dockerfile dùng `--mount=type=cache,target=/root/.npm` để cache npm packages giữa các build → Railway build nhanh hơn sau lần đầu.
- `HEALTHCHECK` trong Dockerfile là cho Docker native health check; Railway platform dùng config health path riêng (`/api/v1/health`) nhưng không conflict với HEALTHCHECK instruction.
