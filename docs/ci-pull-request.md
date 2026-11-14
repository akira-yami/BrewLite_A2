# CI trên pull request — A2-4.4 / #24

Workflow [Pull Request CI](../.github/workflows/pr-ci.yml) chạy trên mọi PR vào
`main` (kể cả chỉ sửa tài liệu), push `main`, merge queue và chạy thủ công.
Không dùng path filter hoặc `continue-on-error` cho required check.
Token workflow chỉ có `contents: read`. Các bước tích hợp dùng PostgreSQL riêng trên runner, với hai database test cho API và trình duyệt.

## Contract ứng dụng

Node **24**, npm đi kèm Node (cùng `.nvmrc` và `engines` của hai app). Hai ứng dụng độc lập `apps/api`, `apps/web` có
`package.json`, `package-lock.json` được commit và scripts không rỗng:

| Bước | Lệnh cho mỗi app | Điều kiện |
|---|---|---|
| Validate | `node scripts/ci-projects.mjs validate` tại gốc | Cả hai manifest/lock và scripts tồn tại |
| Install | `npm ci` | Lockfile khớp manifest; cài cả dev dependencies |
| Lint | `npm run lint` | Linter trả exit code khác 0 khi có lỗi |
| Unit Test | `npm run test` | Chạy một lượt, không watch; thiếu test phải fail |
| Build | `npm run build` | Biên dịch ứng dụng thật; không cần secret production |

Mỗi bước chạy API rồi Web trước khi chuyển bước tiếp theo. Một lệnh lỗi sẽ dừng
job, các bước sau không chạy. Không dùng `--if-present` hoặc bỏ qua app thiếu
runtime. Nếu chuyển sang npm workspaces/pnpm/yarn hoặc cần env build public,
cập nhật runner, lockfile và tài liệu trong cùng PR runtime.

Chạy từ gốc repository:

```powershell
node --test scripts/ci-projects.test.mjs
node scripts/ci-projects.mjs validate
node scripts/ci-projects.mjs install
node scripts/ci-projects.mjs lint
node scripts/ci-projects.mjs test
node scripts/ci-projects.mjs build
```

`CI runner tests` kiểm tra thứ tự lệnh, missing manifest/lock/script, lỗi process,
exit code CLI và pipeline fixture bằng npm thật. Fixture tạm không có dependency;
test chủ động tạo unit test trả mã 7 và xác nhận runner trả lỗi, không chạy Web.
Kết quả fixture **không phải** kết quả unit/build của Web/API.

Sau build, workflow chạy migration trên DB rỗng, integration, API E2E, seed DB trình duyệt và Playwright Chromium. Job Compose độc lập dựng Web/API/PostgreSQL từ checkout sạch, kiểm tra thanh toán mô phỏng, chạy lại migration/seed và kiểm tra trạng thái đơn sau restart. Báo cáo Playwright và log Compose gắn với SHA của workflow trong mục Artifacts.

## Required check

Required check cho `main`: **`PR quality gate`**. Job này dùng `always()` và chỉ
pass khi `CI runner tests`, `Install, lint, unit test and build` và `Compose from clean checkout` đều
`success`; fail/cancel/skip không được coi là pass. Giữ tên này ổn định để tránh
required check bị treo khi đổi tên job.

Branch protection cần yêu cầu nhánh cập nhật với `main`, required status check
trên và áp dụng cho cả admin; không cho force push/xóa nhánh. Cấu hình GitHub
là trạng thái ngoài Git, không tự được bật chỉ nhờ file YAML. Xem
[GitHub: required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging).

## Runtime và giới hạn nghiệm thu

Baseline `aea87f5` thiếu runtime nên run ban đầu fail tại validate. PR #63 bổ sung
manifest/lockfile và runtime tối thiểu: NestJS CatalogModule, PrismaService và
Next.js menu. API dùng Oxlint, Vitest, TypeScript; Web dùng ESLint, Node test
runner và Next.js production build. `npm ci` của API tự sinh Prisma Client từ
schema; không cần DATABASE_URL hoặc DB chạy để install/lint/unit/build.

Unit API mock repository; unit Web mock fetch. Build/unit pass chưa chứng minh
PostgreSQL/migration, browser E2E, auth/cart/payment/PWA hoặc production. Các phần
đó thuộc issue riêng. Xem [evidence](evidence/ci/A2-4.4.md) cho run pass/fail,
required check và giới hạn đã xác minh; review độc lập vẫn cần trước merge.
