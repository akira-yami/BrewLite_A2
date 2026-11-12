# BrewLite - Assignment 2

Ứng dụng đặt đồ uống tại quầy: menu -> chọn món/tùy chọn -> giỏ -> đăng nhập -> tạo đơn -> Ví/Thẻ mô phỏng -> xác nhận/lịch sử. Công nghệ theo đề: **Next.js/PWA, NestJS, PostgreSQL**.

Repository chính: [akira-yami/BrewLite_A2](https://github.com/akira-yami/BrewLite_A2). Thiết lập và quy trình: [A2-4.1 / #17](https://github.com/akira-yami/BrewLite_A2/issues/17).

## Trạng thái hiện tại — Sprint 2 (v1.0.0)

Luồng ứng dụng gồm menu → chi tiết món → giỏ hàng → đăng nhập → tạo đơn → thanh toán VNPay → xác nhận/lịch sử. API có logging và readiness. Xem hướng dẫn [API](apps/api/README.md) và [Web](apps/web/README.md).

- **Production Frontend**: [https://web-a2-production.up.railway.app/menu](https://web-a2-production.up.railway.app/menu)
- **Production API & Health**: [https://api-a2-production.up.railway.app/api/v1/health](https://api-a2-production.up.railway.app/api/v1/health)
- **Video Demo & Bàn giao**: [Thư mục Video Demo trên Google Drive](https://drive.google.com/drive/folders/1R0mMpga32tXJx-Pg-UcuiGaUncPrsqSE?hl=vi) (Xem chi tiết tại [`demo/README.md`](demo/README.md))
- **API**: 161 unit tests pass, NestJS với Catalog/Auth/Orders/Payments/Inventory/Coupon/Loyalty
- **Web**: 38 unit tests pass, Next.js với App Router, React Query, Tailwind CSS
- **CI**: GitHub Actions required check `PR quality gate` chặn merge khi lint/test/build lỗi
- **Release notes**: xem [`docs/RELEASE-NOTES-v1.0.0.md`](docs/RELEASE-NOTES-v1.0.0.md)
- **Rollback guide**: xem [`docs/evidence/cd/rollback-guide.md`](docs/evidence/cd/rollback-guide.md)

## 🎥 Video Demo & Minh chứng Bàn giao (Task 5.4)

* 🎬 **Thư mục Video Demo End-to-End (Google Drive):** [Xem Video Demo tại đây](https://drive.google.com/drive/folders/1R0mMpga32tXJx-Pg-UcuiGaUncPrsqSE?hl=vi)
* 📖 **Hướng dẫn kịch bản & tài khoản test:** Xem tại [`demo/README.md`](demo/README.md)
* 🌐 **Môi trường Production trực tuyến:**
  * Frontend Web (HTTPS): [https://web-a2-production.up.railway.app/menu](https://web-a2-production.up.railway.app/menu)
  * Backend API Readiness: [https://api-a2-production.up.railway.app/api/v1/health](https://api-a2-production.up.railway.app/api/v1/health)
* 👤 **Tài khoản Demo:**
  * Khách hàng: `customer@brewlite.test` / Liên hệ nhóm
  * Barista: `barista@brewlite.test` / Liên hệ nhóm

Xem hướng dẫn chi tiết [API](apps/api/README.md) và [Web](apps/web/README.md). Docker Compose local (#36), browser E2E (#34), production deployment A2 (#39) còn trong backlog.

## Clone và đọc hồ sơ

```powershell
git clone https://github.com/akira-yami/BrewLite_A2.git
cd BrewLite_A2
git status
```

Cần Git, Node **24.x** (xem `.nvmrc`) và npm. Mỗi app có lockfile riêng; chạy `npm ci`, `npm run lint`, `npm test`, `npm run build` trong từng thư mục. Build/unit không cần DB. API chạy local cần PostgreSQL và `DATABASE_URL`; Web dùng port 3000, API dùng 3001. Xem README ứng dụng để cấu hình/chạy.

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
npm run db:migrate
npm run db:seed
cd ../..
```

### 4. Cấu hình Web

```powershell
Set-Content apps/web/.env.local "NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1"
```

### 5. Chạy API và Web

```powershell
# Terminal 1 — API
cd apps/api ; npm run build ; npm start
# → http://localhost:3001/api/v1/health phải trả {"status":"ok"}

# Terminal 2 — Web
cd apps/web ; npm run dev
# → http://localhost:3000/menu để xem menu
```

### 6. CI local (từ gốc repo, không cần DB)

```powershell
node scripts/ci-projects.mjs validate
node scripts/ci-projects.mjs lint
node scripts/ci-projects.mjs test   # 199 tests
node scripts/ci-projects.mjs build
```

### 7. Smoke test (khi API đang chạy)

```powershell
node apps/api/scripts/smoke.mjs http://localhost:3001
```

| Thư mục / tệp | Nội dung |
|---|---|
| [apps/web](apps/web/README.md) | Ranh giới Next.js/PWA và việc còn lại |
| [apps/api](apps/api/README.md) | Ranh giới NestJS/API/DB và việc còn lại |
| [docs](docs/README.md) | Yêu cầu, sơ đồ, kiến trúc và Scrum |
| [docs/RELEASE-NOTES-v1.0.0.md](docs/RELEASE-NOTES-v1.0.0.md) | Release notes v1.0.0 — tính năng, CI evidence, quick start |
| [docs/evidence/cd/rollback-guide.md](docs/evidence/cd/rollback-guide.md) | Hướng dẫn rollback/backup/restore |
| `tests/` | Chỗ cho test xuyên ứng dụng; unit test nằm trong từng app |
| `.github/workflows/` | [PR CI](docs/ci-pull-request.md): Install → Lint → Unit Test → Build và required gate |
| [.env.example](.env.example) | Mẫu local, chỉ có placeholder; API/Web có working directory riêng |
| `docker-compose.yml` | Chờ cấu hình Web/API/PostgreSQL tại #36 |

Cấu trúc bên trong Web/API, Prisma, kiểm thử và minh chứng đã được tạo bằng các thư mục giữ chỗ. Xem [cây thư mục và quy ước đặt mã nguồn](docs/repository-structure.md).

## Cấu hình

API đọc `apps/api/.env`; Web đọc `apps/web/.env.local`. Tạo từ mẫu gốc, thay mọi placeholder theo README ứng dụng. API kiểm tra cấu hình khi khởi động. VNPay cần bộ biến `VNPAY_*` của môi trường đang chạy. Không commit `.env`, token, mật khẩu, DB dump. `NEXT_PUBLIC_*` công khai trong browser, không chứa secret. DB URL host `localhost` dành cho ứng dụng trên máy; container phải dùng hostname service trong Compose.

Không dùng mẫu trên production; CI/hosting cấp secret từ secret store. Chưa có production URL/registry/deploy đã xác minh. Chỉ ghi migrate/seed/start/test/build/rollback hoạt động khi có code và evidence từ checkout sạch.

## Quy trình

- [Nhánh, commit và PR](CONTRIBUTING.md).
- [Backlog hai Sprint](docs/scrum/product-backlog.md), [Definition of Done](docs/scrum/definition-of-done.md).
- [Sprint 1](docs/scrum/sprint-01.md): nền tảng/menu thật/CI; [Sprint 2](docs/scrum/sprint-02.md): checkout/test/production/bàn giao.

PR có mã như `[A2-4.1] Repository, backlog và DoD`, liên kết issue, cách kiểm tra và gap. Chỉ ghi Done khi đạt DoD; có tài liệu không chứng minh code/test/deployment đã đạt.
