# Hướng dẫn Rollback, Backup/Restore và Migration Production

**Phiên bản:** 1.0 · 07/11/2026  
**Phụ trách:** Kiệt · [A2-5.3.2 / Issue #38](https://github.com/akira-yami/BrewLite_A2/issues/38)  
**Truy vết:** NFR-11 (AT-NFR-11), TC-NFR-11, [deployment.md](../../deployment.md), [ADR-005](../../architecture/adr/005-railway-deployment.md)

> **Mục tiêu nghiệm thu:** Rollback ứng dụng ≤10 phút trên môi trường test; không mất đơn đã commit.  
> **Phạm vi:** Môi trường Railway production (Web/API/Postgres). Các bước dùng `pg_dump`/`pg_restore` cho backup/restore, không dùng `prisma migrate dev` trên production.

---

## Mục lục

1. [Nguyên tắc chung](#1-nguyên-tắc-chung)
2. [Quy trình Migration Forward-Only](#2-quy-trình-migration-forward-only)
3. [Rollback Ứng dụng (App Revision)](#3-rollback-ứng-dụng-app-revision)
4. [Backup Database](#4-backup-database)
5. [Restore Database](#5-restore-database)
6. [Smoke Test sau Deploy/Rollback](#6-smoke-test-sau-deployrollback)
7. [Kiểm chứng NFR-11 (Evidence Checklist)](#7-kiểm-chứng-nfr-11-evidence-checklist)
8. [Phục hồi sự cố nhanh (Quick Reference)](#8-phục-hồi-sự-cố-nhanh-quick-reference)

---

## 1. Nguyên tắc chung

| Nguyên tắc | Nội dung |
|---|---|
| **Forward-only migration** | Không chạy `prisma migrate revert` hay xóa/sửa migration đã áp dụng trên production. Rollback schema = tạo migration mới đảo ngược thay đổi. |
| **Fail-stop** | Pre-deploy migration fail → Railway không start container mới → traffic giữ revision cũ. |
| **Backup trước thay đổi** | Backup DB trước mỗi deploy quan trọng, đặc biệt trước migration thêm/sửa cột. |
| **Không seed production** | `npm run db:seed` chỉ dùng local/test. Production catalog được quản lý qua migrations và admin interface. |
| **Secret ngoài Git** | `DATABASE_URL`, `JWT_SECRET` và các secrets Railway: cấu hình qua Railway Variables, không commit vào repo. |

---

## 2. Quy trình Migration Forward-Only

### 2.1. Tạo migration mới (local)

```powershell
# Trong apps/api (đang dùng DB local/test)
cd apps/api

# 1. Sửa schema.prisma
# 2. Tạo migration
npx prisma migrate dev --name <ten_migration>

# 3. Xem lại migration SQL tạo ra
Get-Content prisma/migrations/<timestamp>_<ten_migration>/migration.sql

# 4. Commit cả schema.prisma và file migration
git add prisma/schema.prisma prisma/migrations/
git commit -m "chore(db): add migration <ten_migration>"
```

### 2.2. Apply migration lên production (Railway)

Railway chạy pre-deploy command trước khi start container mới:

```
# Railway → API service → Settings → Deploy → Pre-deploy command:
npm run prisma:deploy
```

**Lệnh này tương đương:**

```powershell
cd apps/api
npm run prisma:deploy
```

**Kiểm tra trạng thái migration hiện tại:**

```powershell
cd apps/api
# Cần DATABASE_URL trong .env
npx prisma migrate status       # prisma migrate status
```

**Kết quả mong đợi khi migration thành công:**

```
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "brewlite" at "localhost:5432"

3 migrations found in prisma/migrations

✔  Applied migrations:
  20260925100913_init
  20261101090000_ingredient_recipe_inventory
  ...

No pending migrations
```

### 2.3. Fail-stop khi migration thất bại

Khi `prisma migrate deploy` gặp lỗi (constraint violation, syntax error, network failure):
- **Exit code 1** → Railway không deploy container mới
- Traffic **giữ nguyên** revision đang chạy
- Railway build log ghi rõ lỗi migration
- Hành động: Xem log, sửa migration SQL (hoặc schema.prisma + migrate mới), push và trigger redeploy

---

## 3. Rollback Ứng dụng (App Revision)

> **⚠ Lưu ý:** Rollback app revision chỉ hoạt động khi schema DB tương thích với revision cũ. Nếu migration đã chạy và thêm NOT NULL column không có default, revision cũ sẽ fail. Xem mục 3.3.

### 3.1. Rollback qua Railway Dashboard

1. Mở [Railway Dashboard](https://railway.app/dashboard)
2. Chọn project và service **api** hoặc **web** theo thành phần cần quay lui
3. Mở tab **Deployments**
4. Tìm revision lành mạnh cuối cùng (status: SUCCESS, trước revision lỗi)
5. Trên deployment đích, mở **⋮** → **Rollback** theo [hướng dẫn Railway](https://docs.railway.com/deployments/deployment-actions#rollback)
6. Xác nhận → Railway start lại container từ image revision cũ
7. Đợi health check pass (~60–120 giây)
8. Chạy smoke test để xác nhận (xem mục 6)

```
Mục tiêu NFR-11 trên môi trường test: ≤10 phút từ khi bắt đầu rollback đến khi smoke pass
```

### 3.2. Chọn đúng deployment từ artifact CD

Mở artifact theo SHA của lần CD đã thành công. Lấy ID từ JSON của service Web hoặc API rồi đối chiếu ID trên Railway Dashboard trước khi bấm Rollback. Kiểm tra API health và Web health/menu sau khi chuyển.

### 3.3. Khi schema mới không tương thích với app cũ

**Scenario:** Migration thêm NOT NULL column không có default → app cũ fail khi đọc row mới.

**Chiến lược migration safe (3-step):**

```
Step 1: Thêm column NULLABLE (không breaking) → deploy app cũ vẫn chạy
Step 2: Backfill dữ liệu (nếu cần)
Step 3: Thêm NOT NULL constraint + deploy app mới cùng lúc
```

**Ví dụ cụ thể:**

```sql
-- Migration step 1: thêm nullable (backward compatible)
ALTER TABLE "orders" ADD COLUMN "customer_note" VARCHAR(500);

-- Migration step 2 (sau khi app mới chạy ổn định, optional):
-- ALTER TABLE "orders" ALTER COLUMN "customer_note" SET DEFAULT '';
```

---

## 4. Backup Database

> **Cần:** `psql` client, `pg_dump`, và DATABASE_URL của production (không commit vào Git).

### 4.1. Lấy DATABASE_URL từ Railway

```powershell
# Railway CLI
railway variables --service postgres

# Hoặc: Railway Dashboard → Postgres service → Variables → DATABASE_URL
# Dạng: postgresql://user:password@host:port/database
```

### 4.2. Backup bằng pg_dump

```powershell
# Thay <DATABASE_URL> bằng URL thật từ Railway
# KHÔNG commit file .env hoặc URL vào Git

$env:DATABASE_URL = "postgresql://user:password@host.railway.internal:5432/railway"

# Backup toàn bộ DB (custom format, hỗ trợ restore chọn lọc)
pg_dump --format=custom --no-acl --no-owner `
  "$env:DATABASE_URL" `
  --file="backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"

# Backup schema-only (kiểm tra migration)
pg_dump --schema-only --no-acl --no-owner `
  "$env:DATABASE_URL" `
  --file="schema_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
```

**Kết quả mong đợi:**

```
pg_dump: last built-in OID is 16383
pg_dump: reading schemas
pg_dump: reading user-defined tables
...
# File .dump tạo ra với kích thước > 0
```

### 4.3. Kiểm tra backup hợp lệ

```powershell
# Liệt kê tables trong backup
pg_restore --list backup_<timestamp>.dump | Select-String "TABLE DATA"
```

### 4.4. Kiểm tra số lượng orders trong backup

```powershell
# Restore vào DB test riêng để đếm orders
$env:TEST_DB_URL = "postgresql://user:password@localhost:5432/brewlite_restore_test"

# Tạo DB test
psql "$env:TEST_DB_URL_BASE" -c "CREATE DATABASE brewlite_restore_test;"

# Restore
pg_restore --no-acl --no-owner --dbname "$env:TEST_DB_URL" backup_<timestamp>.dump

# Đếm orders
psql "$env:TEST_DB_URL" -c "SELECT COUNT(*) FROM orders;"
# Phải khớp với số orders trên production trước backup
```

---

## 5. Restore Database

> **⚠ Cảnh báo:** Restore sẽ xóa dữ liệu hiện tại. Chỉ dùng trên DB test để kiểm chứng backup. Không restore trực tiếp lên production DB đang có traffic.

### 5.1. Restore vào DB test (kiểm chứng backup)

```powershell
# Trên máy local với PostgreSQL
$env:RESTORE_DB = "postgresql://brewlite:password@localhost:5432/brewlite_restore_test"

# Tạo DB restore
psql "postgresql://brewlite:password@localhost:5432/postgres" `
  -c "DROP DATABASE IF EXISTS brewlite_restore_test; CREATE DATABASE brewlite_restore_test;"

# Restore
pg_restore --no-acl --no-owner `
  --dbname "$env:RESTORE_DB" `
  backup_<timestamp>.dump

# Kiểm tra số orders khớp với production
psql "$env:RESTORE_DB" -c "SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;"

# So sánh với production
psql "$env:DATABASE_URL" -c "SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;"
```

**Kết quả mong đợi (expected = actual):**

```
 status    | count
-----------+-------
 CANCELLED |     2
 COMPLETED |    45
 PAID      |    12
 PENDING   |     3
(4 rows)

# Cả hai lệnh (production và restore) phải trả cùng kết quả
```

### 5.2. Evidence cho NFR-11

Khi chạy backup/restore test, ghi lại:

```markdown
## Evidence TC-NFR-11 — Backup/Restore

- **Commit thực thi:** <git hash>
- **Thời điểm bắt đầu (UTC):** <ISO timestamp>
- **DB backup:** <timestamp>.dump (<kích thước>)
- **Số orders production:** <N>
- **Số orders sau restore:** <N> ← phải khớp
- **Lệnh dùng:** pg_dump + pg_restore (xem rollback-guide.md)
- **Môi trường restore:** PostgreSQL local, DB riêng `brewlite_restore_test`
- **Kết quả:** ✅ Pass / ❌ Fail
- **Reviewer:** <tên>
```

---

## 6. Smoke Test sau Deploy/Rollback

Sau mỗi deploy hoặc rollback, chạy smoke test để xác nhận API healthy:

```powershell
# Chạy từ gốc repo, target production URL
$env:BASE_URL = "https://api-a2-production.up.railway.app"
node apps/api/scripts/smoke.mjs $env:BASE_URL

curl.exe -f https://web-a2-production.up.railway.app/health
```

**Kết quả mong đợi:**

```
🔍  Smoke test — https://api-a2-production.up.railway.app
    Started at: 2026-11-07T14:30:00.000Z
    Timeout: 10000ms per request | Retries: 3

  ✅  GET /api/v1/health → 200 với DB connectivity
  ✅  GET /api/v1/products → 200 array response
  ✅  GET /api/v1/products/:nonExistentId → 404
  ✅  GET /api/v1/products/not-a-uuid → 400

────────────────────────────────────────
  Passed: 4/4
  Failed: 0/4
  Ended at: 2026-11-07T14:30:03.542Z
────────────────────────────────────────

✅  Smoke test PASSED. API is healthy.
```

**Khi smoke test fail:**

```powershell
# Kiểm tra logs Railway
railway logs --service api

# Kiểm tra health thủ công
Invoke-WebRequest -Uri "https://api-a2-production.up.railway.app/api/v1/health" | Select-Object -ExpandProperty Content
```

---

## 7. Kiểm chứng NFR-11 (Evidence Checklist)

Theo **AT-NFR-11** và **TC-NFR-11** trong [test-plan.md](../../testing/test-plan.md):

| Tiêu chí | Lệnh/Bước | Cách kiểm chứng |
|---|---|---|
| CI chặn merge khi lint/test/build fail | `node scripts/ci-projects.mjs lint/test/build` | Xem PR run fail + required check không pass |
| Migration apply an toàn trước start | Railway pre-deploy `npm run prisma:deploy` | Railway build log ghi migration applied |
| Smoke test sau deploy | `node apps/api/scripts/smoke.mjs <URL>` | Exit 0, 4 checks pass |
| Rollback app ≤10 phút | Railway Dashboard → Redeploy revision cũ | Đo thời gian phát hiện → health pass |
| Không mất đơn sau rollback | `SELECT COUNT(*) FROM orders` trước và sau | Số đơn bằng nhau |
| Backup/restore DB test | `pg_dump` + `pg_restore` + so orders | Số đơn khớp production |
| URL production HTTPS | `Invoke-WebRequest https://...` | HTTP 200, cert valid |
| Secret không trong Git | `git log --all -S "password"` (không kết quả) | Không tìm thấy secret |

### Snapshot lịch sử (07/11/2026)

| Tiêu chí | Trạng thái | Ghi chú |
|---|---|---|
| Dockerfile.railway API | ✅ Tạo xong | `apps/api/Dockerfile.railway` |
| prisma:deploy alias | ✅ Tạo xong | `package.json` script `prisma:deploy` |
| Kiểm tra migration | Có | Dùng `npx prisma migrate status` trong apps/api |
| Smoke test script | ✅ Tạo xong | `apps/api/scripts/smoke.mjs` |
| Rollback guide | ✅ Tài liệu này | `docs/evidence/cd/rollback-guide.md` |
| Chạy CI lint/test/build pass | ✅ Xác nhận | Xem bên dưới |
| Rollback app diễn tập | ⚠ Chưa có URL A2 | Chờ deployment A2 production (#39) |
| Backup/restore với data thật | ⚠ Chưa có DB production | Chờ deployment A2 (#36/#37/#39) |
| Evidence smoke run thật | ⚠ Chưa có URL | Chờ production URL |

> **Gap hợp lệ:** Các evidence thực thi trên production (rollback timing, backup/restore, smoke URL thật) không thể hoàn thành trước khi có deployment A2 production (#36/#37/#39). Tài liệu này ghi đầy đủ quy trình, script và expected output; kết quả thực thi sẽ bổ sung khi có infrastructure.

---

## 8. Phục hồi sự cố nhanh (Quick Reference)

Đợt 14/11/2026 đã thử backup/restore vào PostgreSQL local riêng sau Playwright. So sánh tập bốn ID đơn và trạng thái giữa DB nguồn và DB restore cho kết quả khớp. Xem [hồ sơ nghiệm thu](../a2-delivery.md). Việc quay lui revision trên Railway cần dùng deployment ID tương thích schema từ artifact CD.

```
SCENARIO A: Deploy mới fail (migration fail / health fail)
──────────────────────────────────────────────────────────
1. Xem Railway build log → tìm lỗi migration hoặc startup
2. Traffic vẫn ở revision cũ (Railway giữ nguyên vì health fail)
3. Không cần rollback thủ công
4. Fix issue → push → trigger redeploy

SCENARIO B: Deploy thành công nhưng có bug nghiêm trọng
──────────────────────────────────────────────────────────
1. Railway Dashboard → api → Deployments
2. Chọn revision cuối SUCCESS (trước revision lỗi)
3. Rollback về deployment đã chọn → chờ health pass
4. Chạy: node apps/api/scripts/smoke.mjs <URL>
5. Ghi thời điểm phát hiện → health pass (mục tiêu: ≤10 phút)
6. Kiểm tra số orders không thay đổi

SCENARIO C: Data corruption / cần restore backup
──────────────────────────────────────────────────────────
⚠ Không restore trực tiếp production
1. Restore vào brewlite_restore_test (xem mục 5)
2. Đối chiếu dữ liệu
3. Quyết định dựa trên extent of corruption
4. Nếu phải restore: maintenance mode → pg_restore → redeploy → smoke

SCENARIO D: Migration sai cần rollback schema
──────────────────────────────────────────────────────────
1. Tạo migration mới đảo ngược thay đổi (forward-only)
2. npx prisma migrate status để xem migrations applied
3. Push migration mới → Railway pre-deploy apply tự động
4. Không dùng prisma migrate revert / xóa migration đã apply
```

---

Minh chứng production có tại [Railway CD và smoke test](railway-53b9321/README.md).

Kết quả diễn tập local đổi revision Web/API, migration bù và restore được lưu trong [biên bản rollback bốn lớp](rollback-local-2026-11-14/README.md).
