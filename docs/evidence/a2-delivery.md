# Minh chứng nghiệm thu BrewLite A2

## Task 4.4 · CI và điều kiện merge

- [PR #63](https://github.com/akira-yami/BrewLite_A2/pull/63), [run phát hiện lỗi](https://github.com/akira-yami/BrewLite_A2/actions/runs/42158544330), [run sửa lỗi thành công](https://github.com/akira-yami/BrewLite_A2/actions/runs/42160719475) và [hồ sơ chặn merge](ci/A2-4.4.md).
- Kiểm tra lại GitHub ngày 14/11/2026 cho thấy `main` yêu cầu `PR quality gate` từ GitHub Actions với chế độ strict. Gate hiện kiểm tra các job mô tả trong [hướng dẫn PR CI](../ci-pull-request.md).
- Khi chọn revision nộp, dùng tab Checks và artifact `playwright-<SHA>`, `compose-<SHA>` của lần chạy tương ứng.

## Task 5.2 · Kiểm thử luồng nghiệp vụ

Kiểm tra cục bộ ngày 14/11/2026 trên nhánh `codex/a2-release-verification` dựa trên `ab856a2`, Node 24 và PostgreSQL 18 riêng.

| Kiểm chứng | Lệnh hoặc ca | Kết quả |
|---|---|---|
| Unit, lint và build | `node scripts/ci-projects.mjs lint`, `test`, `build` với cùng runner | API 525/525 và Web 103/103. Lint exit 0 với cảnh báo có sẵn. Build API và Web exit 0. |
| Runner và cấu hình | `node --test scripts/*.test.mjs` | 19/19. |
| Migration và integration | `npm --prefix apps/api run test:migration` | 21 migration trên DB rỗng, replay no-op, 91/91 ca integration. |
| Tạo đơn/thanh toán API | `npm --prefix apps/api run test:e2e` | 32/32. [Checkout HTTP](../../apps/api/test/checkout.e2e-spec.ts) dùng DB thật và Ví/Thẻ mock. [Readiness](../../apps/api/test/app.e2e-spec.ts) kiểm tra gọi DB và trả 503 khi truy vấn lỗi. |
| Browser E2E | `npm --prefix apps/web run test:e2e` | 19/19, chạy với Web 55472 và API 55471. [Ca nghiệm thu](../../tests/e2e/checkout-flow.spec.ts) kiểm tra mã xác nhận và trạng thái `PAID` qua API và PostgreSQL local. Callback VNPay được mô phỏng. |
| Compose | [Job Compose trên PR CI](../../.github/workflows/pr-ci.yml) | Log cục bộ phát hiện thiếu Prisma schema tại bước npm install, đã sửa Dockerfile. Dùng artifact của job Compose để xác nhận build, khởi động, seed lặp và đơn `PAID` sau restart. |

[Test plan](../testing/test-plan.md) và [ma trận truy vết](../traceability-matrix.md) nối các ca với FR/NFR.

## Tasks 5.3 và 5.4 · Production, release và bàn giao

Đối chiếu trực tiếp Railway ngày 14/11/2026 với project `brewlite-a2`, environment `a2-production`.

| Thành phần | Kết quả quan sát |
|---|---|
| Web | `ab856a2`, deployment `1b7dfe9c-c2c7-4d8f-aafe-2cfa7518e6ff`, `SUCCESS`. [Menu HTTPS](https://web-a2-production.up.railway.app/menu) trả 200. |
| API | `ab856a2`, deployment `c3a272c1-05f0-4109-89ad-7dc56c669d9b`, `SUCCESS`. Log pre-deploy ghi 21 migration, không có migration pending. [Health HTTPS](https://api-a2-production.up.railway.app/api/v1/health) trả 200. Smoke thủ công 4/4, catalog có 30 món. |
| PostgreSQL | Service PostgreSQL có volume 500 MB và không có public domain hoặc TCP proxy trong cấu hình Railway. Kiểm tra tên biến API và Web trên Railway, không ghi giá trị secret. |
| GitHub CD | [Run trước thay đổi](https://github.com/akira-yami/BrewLite_A2/actions/runs/43265937400) dừng vì thiếu secret `RAILWAY_TOKEN`. Railway deployment đang phục vụ đến từ nguồn GitHub trực tiếp. [Workflow mới](../../.github/workflows/railway-cd.yml) ghi ID từng deployment và smoke của lần CD. |
| Khôi phục | Diễn tập PostgreSQL cục bộ ngày 14/11 với `pg_dump -Fc` và `pg_restore --exit-on-error --no-owner` vào DB mới. Dữ liệu test có 4 đơn, ID và trạng thái khớp toàn bộ sau restore. [Runbook](cd/rollback-guide.md) mô tả quay lui app theo revision tương thích schema. |
| Bàn giao | [Release/tag](https://github.com/akira-yami/BrewLite_A2/releases), [README](../../README.md), [demo và tài khoản](../../demo/README.md), [Review/Retro Sprint 1](../scrum/sprint1-review-retro.md), [Review/Retro Sprint 2](../scrum/sprint2-review-retro.md). |

**Bổ sung sau merge PR #102.** [Railway CD #11](https://github.com/akira-yami/BrewLite_A2/actions/runs/43572616665) đã triển khai commit `53b9321` thành công. Xem [ảnh GitHub Actions, deployment Railway, log migration và smoke test](cd/railway-53b9321/README.md). Các quan sát về `ab856a2` trong bảng trên thuộc lần triển khai trước. Kiểm tra video bằng tài khoản giảng viên hoặc người xem được cấp quyền.
