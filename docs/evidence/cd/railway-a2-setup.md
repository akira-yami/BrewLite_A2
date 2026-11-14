# A2-5.3.1 — CD trên Railway

[Issue #37](https://github.com/akira-yami/BrewLite_A2/issues/37)

Workflow Railway CD nhận commit của lần PR CI thành công sau push lên `main`. Cũng có thể chạy lại bằng Run workflow trên `main` khi CI của cùng SHA đã pass. Job build hai image, lưu tag và ID image theo SHA, rồi dùng Railway CLI upload source cùng revision. Railway build ảnh chạy thực tế và lưu trong registry do Railway quản lý. CD chờ deployment ID của API ở trạng thái `SUCCESS` sau pre-deploy migration và health check trước khi deploy Web. Sau khi xác minh cả hai ID, CD chạy smoke health và catalog/menu. Khi có lỗi, workflow dừng và dẫn tới [runbook rollback](rollback-guide.md).

## Cấu hình một lần

1. Tạo hoặc chọn environment riêng cho A2, cùng các service `api`, `web` và PostgreSQL có volume. PostgreSQL dùng mạng nội bộ và không tạo public domain hoặc TCP proxy. Nếu đã nối nguồn GitHub để deploy ban đầu, ghim nguồn vào commit bootstrap để push không kích hoạt deploy song song với CD.
2. Tạo domain HTTPS cho API (port 3001) và Web (port 3000). CLI upload từ gốc repo. Trong Railway, đặt Root Directory của API là `/apps/api` và Web là `/apps/web`. Cả hai dùng `Dockerfile.railway`. Đặt pre-deploy command API là `npm run prisma:deploy`, health check API `/api/v1/health` và Web `/health`.
3. Đặt biến API trên Railway gồm `DATABASE_URL` tham chiếu PostgreSQL private, `JWT_SECRET` ngẫu nhiên riêng cho A2 (ít nhất 32 byte), `WEB_ORIGIN` là HTTPS origin của Web A2, `NODE_ENV=production` và `PORT=3001`. Đặt biến Web `NEXT_PUBLIC_API_URL=<API origin>/api/v1` và `PORT=3000`. Next.js đọc URL API lúc build.
4. Tạo GitHub Actions environment `a2-production`. Đặt secret `RAILWAY_TOKEN` bằng project token giới hạn vào environment Railway của A2. Đặt các biến sau trong GitHub Actions environment.

| Biến | Giá trị |
|---|---|
| `RAILWAY_PROJECT_ID` | ID project chứa environment A2 |
| `RAILWAY_ENVIRONMENT_ID` | ID environment Railway của A2 |
| `RAILWAY_API_SERVICE_ID` | ID service API A2 |
| `RAILWAY_WEB_SERVICE_ID` | ID service Web A2 |
| `A2_API_ORIGIN` | HTTPS origin API, bỏ `/api/v1` và dấu `/` cuối |
| `A2_WEB_ORIGIN` | HTTPS origin Web, bỏ dấu `/` cuối |

5. Sau khi cấu hình và merge workflow vào `main`, xem run CD sau PR CI. Tải artifact `railway-<SHA>` gồm SHA, image ID của CI, ID/trạng thái của hai deployment và smoke log. Dùng ID API để xem log pre-deploy migration trên Railway. Kiểm tra cả API readiness, catalog có dữ liệu, Web health và Web menu. Ca checkout đầy đủ chạy riêng trong PR CI với PostgreSQL test và cổng mô phỏng.

## Minh chứng deploy ban đầu

Ngày 10/11/2026, Railway triển khai trực tiếp commit `b3ec642` từ nhánh PR #91 vào [project BrewLite A2](https://railway.com/project/a07749a5-2382-4497-a7fd-63d79b5e523c), environment `a2-production`. Web và API có domain riêng. PostgreSQL có volume 500 MB và chỉ mở mạng nội bộ, không có public domain hoặc TCP proxy.

- [Web](https://web-a2-production.up.railway.app/menu) và [Web health](https://web-a2-production.up.railway.app/health) trả HTTP 200. Bundle menu trỏ tới API A2.
- [API health](https://api-a2-production.up.railway.app/api/v1/health) trả HTTP 200. Log ghi nhận migration thành công, catalog có 30 sản phẩm và CORS cho phép Web A2.
- Smoke API đạt 4/4 lúc 11:43 UTC+7. GitHub Actions đã có sáu biến đích, còn cần Project Token để chạy workflow CD từ `main`.
- VNPay ở A2 đang tắt vì thông tin Sandbox local trùng merchant A1.

[Railway CLI và token](https://docs.railway.com/cli/deploying) · [Railway monorepo](https://docs.railway.com/deployments/monorepo)
