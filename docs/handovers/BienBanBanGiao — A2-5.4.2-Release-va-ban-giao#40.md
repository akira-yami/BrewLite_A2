# BIÊN BẢN BÀN GIAO — A2-5.4.2 Release và Bàn giao #40

**Issue:** [A2-5.4.2 / #40](https://github.com/akira-yami/BrewLite_A2/issues/40)  
**Phân công:** Kiệt · Sprint 2  
**Nhánh:** `feat/A2-5.4.2-Release-va-ban-giao`  
**Ngày:** 07/11/2026  
**Dependency:** #30–#39, #41  

---

## 1. Quyết Định Kiến Trúc & Hướng Đi Kỹ Thuật (Architectural Decisions)

### Hướng đi được lựa chọn

**Tạo release notes và biên bản bàn giao toàn diện** với hai trục chính:

1. **Release documentation** (`docs/RELEASE-NOTES-v1.0.0.md`): Tài liệu bàn giao kỹ thuật dành cho người clone, bao gồm tính năng, quick start 7 bước, evidence CI, biến môi trường và known gaps.

2. **README root nâng cấp** (`README.md`): Từ "trạng thái tối thiểu" lên "MVP đầy đủ" với quick start end-to-end, không cần đọc nhiều file khác để biết cách chạy.

3. **Sửa lỗi JWT edge case**: `jwt.ts` có edge case khi base64url tamper 1 ký tự làm `timingSafeEqual` throw `ERR_CRYPTO_TIMINGSAFEEQUAL_LENGTH` thay vì `invalid signature` — test security đã fail. Sửa bằng cách kiểm tra lengths trước và wrap `timingSafeEqual` trong try-catch.

### Lý do lựa chọn (Rationals)

1. **Issue #40 yêu cầu "người ngoài clone/chạy được"**: Không có quick start rõ ràng thì không thể nghiệm thu. README cũ chỉ có 4 lệnh cho CI, không có hướng dẫn migrate/seed/start đầy đủ.

2. **JWT edge case là security bug thực sự**: Hàm `verify()` dùng `timingSafeEqual` để chống timing attack — nhưng khi base64url decode ra buffer có độ dài khác nhau (1 ký tự cuối bị thay có thể thay đổi số bytes decode), Node.js throw `ERR_CRYPTO_TIMINGSAFEEQUAL_LENGTH` không phải `'invalid signature'`. Test `jwt.spec.ts` line 35 mong đợi `/invalid signature/` nhưng không nhận được → test fail → CI fail → chặn merge.

3. **Release notes theo cấu trúc chuẩn**: Tài liệu đủ để reviewer độc lập từ checkout sạch: chạy lệnh → thấy output → xác nhận pass/fail — không cần hỏi thêm thành viên nhóm.

### Phân tích giải pháp thay thế (Trade-off Analysis)

| Giải pháp | Lý do loại bỏ |
|---|---|
| **Giữ nguyên README cũ, chỉ thêm link** | Người clone phải đọc qua nhiều file, không tự lập được → vi phạm tiêu chí issue #40 |
| **Viết wiki GitHub riêng** | Cần GUI GitHub, không trong repo → không phải source of truth, không version control cùng code |
| **Bỏ qua edge case JWT** | Bug thực trong security-critical code, làm test fail → CI fail → chặn merge PR của issue này |
| **Dùng thư viện JWT bên ngoài (jsonwebtoken)** | Thay đổi kiến trúc quá lớn khi đã có implementation tự build; vấn đề chỉ là 2 dòng code |

### Giá trị mang lại (Value Proposition)

- **Ngắn hạn**: Reviewer có thể nghiệm thu issue #40 từ checkout sạch trong <15 phút theo README.
- **Ngắn hạn**: CI không còn bị block bởi JWT test fail — mọi PR có thể merge nếu đạt DoD.
- **Dài hạn**: README và release notes là tài liệu sống — mỗi Sprint bổ sung chỉ cần update phần "Trạng thái hiện tại" và "Known Gaps", không viết lại từ đầu.
- **Dài hạn**: Fix JWT edge case tăng độ bền của constant-time comparison: dù base64url padding có thay đổi buffer length, `verify()` vẫn luôn throw `invalid signature` (không lộ thông tin timing qua error type).

---

## 2. Hướng Dẫn Vận Hành & Khởi Chạy File Đặc Biệt (Execution Guide)

### Danh sách file đặc biệt

| File | Loại | Đường dẫn |
|------|------|-----------|
| Release Notes v1.0.0 | Tài liệu bàn giao | `docs/RELEASE-NOTES-v1.0.0.md` |
| README gốc (cập nhật) | Hướng dẫn chính | `README.md` |
| JWT utility (sửa lỗi) | Source code | `apps/api/src/common/utils/jwt.ts` |

### Điều kiện tiên quyết (Prerequisites)

**Để chạy CI local (không cần DB):**
- Node.js 24.x
- `npm ci` đã chạy trong `apps/api/` và `apps/web/`

**Để chạy full stack local:**
- PostgreSQL 14+ đang chạy
- `apps/api/.env` có `DATABASE_URL` và `JWT_SECRET` hợp lệ
- `apps/web/.env.local` có `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1`

### Lệnh khởi chạy (Commands)

```powershell
# ── Clone và cài đặt ────────────────────────────────────────────────────
git clone https://github.com/akira-yami/BrewLite_A2.git
cd BrewLite_A2

# ── CI local (không cần DB, chạy từ gốc repo) ──────────────────────────
node scripts/ci-projects.mjs validate
node scripts/ci-projects.mjs lint
node scripts/ci-projects.mjs test    # 199 tests
node scripts/ci-projects.mjs build

# ── Full stack local (cần PostgreSQL) ──────────────────────────────────
# Bước 1: Cấu hình API
Copy-Item .env.example apps/api/.env
# Sửa apps/api/.env: DATABASE_URL và JWT_SECRET

# Bước 2: Cài + migrate + seed
cd apps/api
npm ci
npm run db:migrate
npm run db:seed

# Bước 3: Build và chạy API
npm run build
npm start        # → http://localhost:3001/api/v1/health

# Bước 4: Cấu hình và chạy Web
cd ../web
npm ci
Set-Content .env.local "NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1"
npm run dev      # → http://localhost:3000/menu

# ── Smoke test (khi API đang chạy) ─────────────────────────────────────
node apps/api/scripts/smoke.mjs http://localhost:3001
```

### Kết quả mong đợi (Expected Output)

**CI local (không cần DB):**
```
Test Files  12 passed (12)
     Tests  161 passed (161)
     ...
tests 38
pass 38
fail 0
```

**API startup:**
```
[NestApplication] Nest application successfully started +Xms
```

**API health:**
```json
{"status":"ok"}
```

**Smoke test (pass):**
```
✅  GET /api/v1/health → 200
✅  GET /api/v1/products → 200 array response
✅  GET /api/v1/products/:nonExistentId → 404
✅  GET /api/v1/products/not-a-uuid → 400
Passed: 4/4
✅  Smoke test PASSED. API is healthy.
```

---

## 3. Chi Tiết Kỹ Thuật

### 3.1 Sửa lỗi JWT `verify()` — edge case constant-time comparison

**Vị trí:** `apps/api/src/common/utils/jwt.ts`

**Vấn đề gốc:**
```typescript
// Trước khi sửa — có thể throw ERR_CRYPTO_TIMINGSAFEEQUAL_LENGTH
if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid signature');
```

Khi base64url decode một signature bị tamper 1 ký tự cuối, `a.length !== b.length` có thể là **false** (cùng số bytes decode) hoặc **true** (khác số bytes). Trường hợp lengths khác nhau: biểu thức `a.length !== b.length` trả `true` → short-circuit → `timingSafeEqual` không được gọi → throw `invalid signature` đúng. Nhưng khi `a.length` và `b.length` bằng nhau mà `timingSafeEqual` throw (trường hợp hiếm với base64url padding bất thường), error message khác → test fail.

**Cách sửa:**
```typescript
// Sau khi sửa — luôn throw 'invalid signature'
let valid = a.length === b.length;
if (valid) {
  try {
    valid = timingSafeEqual(a, b);
  } catch {
    valid = false;
  }
}
if (!valid) throw new Error('invalid signature');
```

Logic an toàn: kiểm tra length trước, wrap `timingSafeEqual` trong try-catch để bắt mọi error từ Node.js crypto, luôn throw `invalid signature` — không lộ thông tin qua error type.

**Test kết quả sau sửa:**
```
✓ test/jwt.spec.ts (5 tests) — tất cả 5 pass trong 16ms
  ✓ signs and verifies a token with correct payload
  ✓ rejects a token signed with a different secret
  ✓ rejects a token that is expired
  ✓ rejects a malformed token
  ✓ uses constant-time comparison (cannot bypass with partial match)
```

### 3.2 Nội dung README cập nhật

Thêm quick start 7 bước với lệnh copy-paste:

```
1. Clone + cài đặt dependencies
2. Cấu hình API (.env)
3. Migrate + seed database
4. Cấu hình Web (.env.local)
5. Chạy API (build + start)
6. Chạy Web (dev server)
7. CI local (validate/lint/test/build)
Bonus: Smoke test khi API chạy
```

### 3.3 Release Notes v1.0.0 — nội dung chính

- Danh sách tính năng API/Web theo module
- Evidence CI: 161 API tests + 38 Web tests = 199/199 pass
- Environment variables với mô tả
- Known gaps (Docker Compose, E2E, production A2)
- Link tài liệu liên quan

---

## 4. Tổng Hợp & Trạng Thái Nghiệm Thu

### Bằng chứng CI local (Evidence)

**Thời điểm:** 07/11/2026, ~22:05 UTC+7  
**Môi trường:** Windows 11, Node.js 24.x, npm  
**Commit head:** `9cfb311` + changes trên nhánh `feat/A2-5.4.2-Release-va-ban-giao`

```
validate:   ✅ PASS
lint:       ✅ PASS (API: oxlint 0 warnings; Web: ESLint 0 errors)
test API:   ✅ 12/12 test files, 161/161 tests passed (Vitest 4.1.11)
test Web:   ✅ 38/38 tests passed (Node test runner)
build API:  ✅ tsc -p tsconfig.build.json (exit 0)
build Web:  ✅ Next.js standalone (exit 0)

Tổng: 199 tests, 0 failed
```

### Ma trận nghiệm thu issue #40

| Tiêu chí issue #40 | Trạng thái | Bằng chứng |
|--------------------|-----------|-----------|
| Người ngoài clone/chạy được | ✅ Tài liệu hoàn thiện | README quick start 7 bước, `docs/RELEASE-NOTES-v1.0.0.md` |
| CI local pass trước PR | ✅ 199 tests pass | Xem section Evidence ở trên |
| Release notes có tính năng | ✅ Đầy đủ | `docs/RELEASE-NOTES-v1.0.0.md` |
| Hướng dẫn local/test/build | ✅ Trong README + RELEASE-NOTES | Clone, install, migrate, start |
| Hướng dẫn deploy | ✅ Trong `rollback-guide.md` | Railway Dockerfile.railway + pre-deploy |
| Hướng dẫn rollback | ✅ Có từ #38 | `docs/evidence/cd/rollback-guide.md` |
| JWT test pass (CI gate) | ✅ Sửa xong | test/jwt.spec.ts 5/5 pass |

### Ma trận nghiệm thu NFR-11 (phần release)

| Tiêu chí AT-NFR-11 | Trạng thái | Ghi chú |
|--------------------|-----------|---------|
| CI required check chặn merge khi fail | ✅ Đang hoạt động | `PR quality gate` trên GitHub |
| Có README local/test/build/deploy/rollback | ✅ Hoàn thiện | README root + RELEASE-NOTES |
| Tag/release notes | ⚠ Chờ merge | Tag `v1.0.0` sẽ tạo sau merge vào main |
| Demo URL production | ⚠ Chờ #39 | Production A2 Railway chưa deploy |
| Evidence deploy thực tế | ⚠ Chờ #37/#39 | CD quality gate và production URL |

### Khoảng trống (Gap)

| Nội dung | Lý do | Issue liên quan |
|----------|-------|-----------------|
| Git tag `v1.0.0` | Tạo sau khi merge PR vào main | #40 bước cuối |
| GitHub Release page | Tạo từ tag trên GitHub UI | #40 bước cuối |
| Production URL A2 | Chưa có deployment A2 Railway | #39 |
| Docker Compose local | `docker-compose.yml` giữ chỗ | #36 |
| Browser E2E | Playwright suite chờ full stack | #34 |
| Traceability matrix hoàn chỉnh | Cập nhật cùng mỗi PR | #41 |

> **Gap hợp lệ theo DoD:** Tag/Release sẽ được tạo sau merge PR; Docker Compose, E2E và production phụ thuộc vào các issue riêng (#34, #36, #39). README và release notes đã đủ để người clone tái tạo môi trường và chạy CI.

### Ghi chú kỹ thuật cho Reviewer

1. `npm run test` (API) sẽ run tất cả `*.spec.ts` trong `src/**` và `test/**` — 12 test files, 161 tests.
2. `npm run test` (Web) sẽ run `tests/*.test.mjs` — 38 tests.
3. Build/test không cần `DATABASE_URL` — `PrismaService` và các service dùng mock trong unit test.
4. `DEP0190` DeprecationWarning từ `ci-projects.mjs` trên Windows (`shell: true`) là warning, không phải lỗi — exit code vẫn 0 và không xảy ra trên Linux CI runner.
5. JWT fix: không thay đổi public API hay behavior của `jwt.sign()` và `jwt.verify()` — chỉ hardening error handling trong verify.
