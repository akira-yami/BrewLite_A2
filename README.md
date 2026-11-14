# BrewLite - Assignment 2

Ứng dụng đặt đồ uống tại quầy: menu -> chọn món/tùy chọn -> giỏ -> đăng nhập -> tạo đơn -> VNPay Sandbox -> xác nhận/lịch sử. Công nghệ theo đề: **Next.js/PWA, NestJS, PostgreSQL**.

Repository chính: [akira-yami/BrewLite_A2](https://github.com/akira-yami/BrewLite_A2). Thiết lập và quy trình: [A2-4.1 / #17](https://github.com/akira-yami/BrewLite_A2/issues/17).

## Bàn giao Assignment 2

Luồng ứng dụng gồm menu → chi tiết món → giỏ hàng → đăng nhập → tạo đơn → thanh toán VNPay → xác nhận/lịch sử. API có logging và readiness. Xem hướng dẫn [API](apps/api/README.md) và [Web](apps/web/README.md).

- **Production Frontend**: [https://web-a2-production.up.railway.app/menu](https://web-a2-production.up.railway.app/menu)
- **Production API & Health**: [https://api-a2-production.up.railway.app/api/v1/health](https://api-a2-production.up.railway.app/api/v1/health)
- **Video Demo & Bàn giao**: [Thư mục Video Demo trên Google Drive](https://drive.google.com/drive/folders/1R0mMpga32tXJx-Pg-UcuiGaUncPrsqSE?hl=vi) (Xem chi tiết tại [`demo/README.md`](demo/README.md))
- **Kiểm thử và minh chứng**: [Task 4.4, 5.2, 5.3 và 5.4](docs/evidence/a2-delivery.md)
- **CI**: `PR quality gate` bắt buộc cho lint, unit test, build, integration PostgreSQL, API E2E và Playwright.
- **Phiên bản**: [GitHub Releases](https://github.com/akira-yami/BrewLite_A2/releases) và [v1.0.2 · 53b9321](https://github.com/akira-yami/BrewLite_A2/releases/tag/v1.0.2).
- **Rollback guide**: xem [`docs/evidence/cd/rollback-guide.md`](docs/evidence/cd/rollback-guide.md)

Xem hướng dẫn chi tiết [API](apps/api/README.md) và [Web](apps/web/README.md). Docker Compose và browser E2E đã đạt trong [CI của PR #102](https://github.com/akira-yami/BrewLite_A2/actions/runs/43571751138). Revision `53b9321` đã qua [Railway CD #11](https://github.com/akira-yami/BrewLite_A2/actions/runs/43572616665). Commit `e9ace66` trên `main` cũng đã qua [CI](https://github.com/akira-yami/BrewLite_A2/actions/runs/43575835639) và [Railway CD](https://github.com/akira-yami/BrewLite_A2/actions/runs/43576208668).

Nếu nộp báo cáo PDF, đính kèm file PDF trực tiếp trong gói nộp. Thư mục `report/` là thư mục local được Git bỏ qua.

## Clone và đọc hồ sơ

```powershell
git clone https://github.com/akira-yami/BrewLite_A2.git
cd BrewLite_A2
git status
```

Cần Git, Node **24.x** (xem `.nvmrc`) và npm. Mỗi app có lockfile riêng; chạy `npm ci`, `npm run lint`, `npm test`, `npm run build` trong từng thư mục. Build/unit không cần DB. API chạy local cần PostgreSQL và `DATABASE_URL`; Web dùng port 3000, API dùng 3001. Xem README ứng dụng để cấu hình/chạy.

## Chạy local bằng Docker Compose

Ví dụ PowerShell từ bản clone sạch. Docker Desktop cần chạy Linux containers.

```powershell
Copy-Item .env.example .env
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
docker compose -f compose.yaml --profile demo config --quiet
docker compose -f compose.yaml --profile demo build
docker compose -f compose.yaml up --wait --wait-timeout 180
docker compose -f compose.yaml run --rm --no-deps seed
node apps/api/scripts/smoke.mjs http://localhost:3001
```

Mở [menu local](http://localhost:3000/menu). Profile `demo` nạp catalog và tài khoản mẫu cục bộ. Để thanh toán trên Web local, bật `VNPAY_ENABLED=true` và cấu hình thông tin VNPay Sandbox theo [hướng dẫn API](apps/api/README.md) và `.env.example`. Compose mặc định tắt VNPay. Dừng bằng `docker compose -f compose.yaml --profile demo down`. Volume PostgreSQL giữ dữ liệu giữa các lượt chạy. `docker-compose.yml` là cấu hình tương thích cho các máy đang dùng luồng local cũ.

## Chạy Local (không cần Docker)

### 1. Cài đặt dependencies

```powershell
cd apps/api ; npm ci ; cd ../..
cd apps/web ; npm ci ; cd ../..
```

### 2. Cấu hình API

```powershell
Copy-Item .env.example apps/api/.env
# Mở apps/api/.env và thay:
#   DATABASE_URL=postgresql://user:password@localhost:5432/brewlite
#   JWT_SECRET=any-random-string-32-chars-or-more
```

### 3. Migrate + seed database

```powershell
cd apps/api
npm run prisma:deploy
npm run db:seed
cd ../..
```

### 4. Cấu hình Web

```powershell
Set-Content apps/web/.env.local "NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1"
```

### 5. Chạy API và Web

```powershell
# Terminal 1 — API
cd apps/api ; npm run build ; npm start
# → http://localhost:3001/api/v1/health phải trả {"success":true,"data":{"status":"ok"}}

# Terminal 2 — Web
cd apps/web ; npm run dev
# → http://localhost:3000/menu để xem menu
```

### 6. CI local (từ gốc repo, không cần DB)

```powershell
node scripts/ci-projects.mjs validate
node scripts/ci-projects.mjs lint
node scripts/ci-projects.mjs test
node scripts/ci-projects.mjs build
```

### 7. Smoke test (khi API đang chạy)

```powershell
node apps/api/scripts/smoke.mjs http://localhost:3001
```

Kiểm thử có PostgreSQL và trình duyệt làm theo [test plan](docs/testing/test-plan.md#e2e-checkout) và [README API](apps/api/README.md). Triển khai theo [Railway CD](docs/evidence/cd/railway-a2-setup.md), quay lui theo [runbook](docs/evidence/cd/rollback-guide.md).

| Thư mục / tệp | Nội dung |
|---|---|
| [apps/web](apps/web/README.md) | Ranh giới Next.js/PWA và việc còn lại |
| [apps/api](apps/api/README.md) | Ranh giới NestJS/API/DB và việc còn lại |
| [docs](docs/README.md) | Yêu cầu, sơ đồ, kiến trúc và Scrum |
| [docs/RELEASE-NOTES-v1.0.0.md](docs/RELEASE-NOTES-v1.0.0.md) | Release notes v1.0.0 — tính năng, CI evidence, quick start |
| [docs/evidence/cd/rollback-guide.md](docs/evidence/cd/rollback-guide.md) | Hướng dẫn rollback/backup/restore |
| `tests/` | Ca E2E từ menu tới xác nhận đơn |
| `.github/workflows/` | [PR CI](docs/ci-pull-request.md), quality gate và Railway CD |
| [.env.example](.env.example) | Mẫu local, chỉ có placeholder; API/Web có working directory riêng |
| [compose.yaml](compose.yaml) | Web, API, PostgreSQL, migration và seed demo |

## Cấu hình

API đọc `apps/api/.env`; Web đọc `apps/web/.env.local`. Tạo từ mẫu gốc, thay mọi placeholder theo README ứng dụng. API kiểm tra cấu hình khi khởi động. VNPay cần bộ biến `VNPAY_*` của môi trường đang chạy. Không commit `.env`, token, mật khẩu, DB dump. `NEXT_PUBLIC_*` công khai trong browser, không chứa secret. DB URL host `localhost` dành cho ứng dụng trên máy; container phải dùng hostname service trong Compose.

Production dùng biến Railway và GitHub Environment `a2-production`. Xem [cấu hình triển khai](docs/deployment.md) và [minh chứng theo revision](docs/evidence/a2-delivery.md).

## Quy trình

- [Nhánh, commit và PR](CONTRIBUTING.md).
- [Backlog hai Sprint](docs/scrum/product-backlog.md), [Definition of Done](docs/scrum/definition-of-done.md).
- [Sprint 1](docs/scrum/sprint-01.md): nền tảng/menu thật/CI; [Sprint 2](docs/scrum/sprint-02.md): checkout/test/production/bàn giao.

PR có mã như `[A2-4.1] Repository, backlog và DoD`, liên kết issue, cách kiểm tra và gap. Chỉ ghi Done khi đạt DoD; có tài liệu không chứng minh code/test/deployment đã đạt.
