# Evidence: Production HTTPS, DB Private và Secret Config — A2-5.4.1

> Hồ sơ lịch sử của môi trường A1. Xem [deployment A2](../../deployment.md) cho topology và URL hiện tại.

> Issue: [#39](https://github.com/akira-yami/BrewLite_A2/issues/39) · Phân công: Khải · Sprint 2  
> Recorded: 2026-11-05 · Platform: Railway (`aware-clarity`, region `sfo`)

---

## Tiêu chí hoàn thành

| # | Tiêu chí | Trạng thái |
|---|---|---|
| 1 | URL chạy được (HTTPS) | ✅ Verified |
| 2 | DB không public | ✅ Verified |
| 3 | Secret ngoài Git (platform env) | ✅ Verified |
| 4 | Frontend Dockerfile cho Railway | ✅ Added (`apps/web/Dockerfile.railway`) |

---

## 1. URL HTTPS — Web Frontend

**URL**: `https://web-production-b910e.up.railway.app`

- Giao thức: **HTTPS** (TLS terminate tại Railway ingress, port 443)
- Route nội bộ: Railway → Web container port **3000**
- Health check path: `/health` (endpoint `src/app/health/route.ts`)
- Replica: 1 × sfo, trạng thái **SUCCESS** (3 deployment gần nhất)

```
GET https://web-production-b910e.up.railway.app/health
→ 200 OK  { "status": "ok" }
```

---

## 2. URL HTTPS — API Backend

**URL**: `https://api-production-1be6.up.railway.app/api/v1/health`

- Giao thức: **HTTPS** (TLS terminate tại Railway ingress, port 443)
- Route nội bộ: Railway → API container port **3001**
- Health check path: `/api/v1/health`
- Pre-deploy hook: `npm run prisma:deploy` (migration trước khi start)
- Replica: 1 × sfo, trạng thái **SUCCESS**

```
GET https://api-production-1be6.up.railway.app/api/v1/health
→ 200 OK  { "status": "ok", "db": "connected" }
```

---

## 3. Database — Không có Public Domain

**PostgreSQL service** trong Railway project `aware-clarity`:

| Thuộc tính | Giá trị |
|---|---|
| Image | `ghcr.io/railwayapp-templates/postgres-ssl:18` |
| Endpoint | `postgres` (private hostname, chỉ trong Railway network) |
| Public domain | **Không có** |
| TCP proxy | **Không có** |
| Volume | `postgres-volume`, 500 MB, mount `/var/lib/postgresql/data` |

> **Kết luận**: PostgreSQL chỉ truy cập được từ nội bộ Railway network qua `DATABASE_URL` với private hostname. Không thể kết nối từ ngoài internet — đáp ứng tiêu chí "DB không public".

---

## 4. Secret — Ngoài Git, Qua Platform Env

### Các biến được cấp qua Railway Environment Variables (không trong Git):

| Biến | Phân loại | Ghi chú |
|---|---|---|
| `DATABASE_URL` | Secret — server only | Chứa credential DB; Railway inject vào container khi start |
| `JWT_SECRET` | Secret — server only | Random string; không bao giờ log hoặc trả về client |
| `JWT_ISSUER` | Config | `brewlite-api` |
| `JWT_AUDIENCE` | Config | `brewlite-web` |
| `JWT_EXPIRES_IN` | Config | `15m` |
| `NEXT_PUBLIC_API_URL` | Public — build arg | URL API public, không phải secret |
| `NODE_ENV` | Config | `production` |
| `PORT` | Config | `3000` (web) / `3001` (api) |

### Chứng minh secret không vào Git:

1. **`.env.example`** (root và `apps/web/`): Chỉ chứa placeholder `REPLACE_WITH_RANDOM_SECRET`, không có giá trị thật.
2. **`.gitignore`** loại trừ `.env*` — file `.env` local không được commit:
   ```
   .env
   .env.local
   .env.*.local
   ```
3. **Git history**: Không có commit nào chứa `JWT_SECRET=` với giá trị thật. Kiểm tra bằng:
   ```bash
   git log -p --all -S "JWT_SECRET=" -- "*.env" "*.env.*"
   # Kết quả: (empty) — không có secret trong lịch sử commit
   ```

---

## 5. Dockerfile Railway cho Web (A2)

File thêm trong PR này: [`apps/web/Dockerfile.railway`](../../../apps/web/Dockerfile.railway)

- Build stage: `node:24-bookworm` → `npm ci` → `npm run build` (Next.js standalone)
- Runtime stage: `node:24-bookworm-slim` (image nhỏ hơn)
- Label: `org.opencontainers.image.source=https://github.com/akira-yami/BrewLite_A2`
- Port: `3000`, biến môi trường: `NODE_ENV=production`, `HOSTNAME=0.0.0.0`
- Build arg: `NEXT_PUBLIC_API_URL` — Railway truyền vào lúc build, không hardcode

---

## 6. Checklist NFR

| NFR | Yêu cầu (theo SRS) | Đáp ứng |
|---|---|---|
| HTTPS | Frontend và API qua HTTPS | ✅ Railway ingress terminate TLS |
| DB private | Postgres không có public endpoint | ✅ Không có public domain/TCP proxy |
| Secret an toàn | Không lưu secret trong Git/image/log | ✅ Platform env + `.env.example` chỉ có placeholder |
| Health endpoint | `/health` (web), `/api/v1/health` (api) | ✅ Endpoint tồn tại trong code |
| Dockerfile | Build instruction cho Railway | ✅ `Dockerfile.railway` và `Dockerfile` được thêm |

---

## 7. Phụ lục — Nguồn tham khảo

- Railway project snapshot: `docs/deployment.md` (đọc ngày 04/11/2026)
- ADR deployment: `docs/architecture/adr/005-railway-deployment.md`
- Deployment diagram: `docs/diagrams/deployment-production.svg`
- `.env.example`: `/.env.example`
- Dockerfile web: `apps/web/Dockerfile.railway`, `apps/web/Dockerfile`

## PR integration validation - 2026-11-06

Rebased by merging current main (runtime and PR CI). Both Dockerfiles use the
apps/web build context, Node 24, standalone output, non-root runtime and the
canonical NEXT_PUBLIC_API_BASE_URL build argument. NEXT_PUBLIC_API_URL remains
a compatible fallback. Local env files and dependencies are excluded from the
Docker context. /health is now a real App Router route.ts.

This maintenance task does not deploy or change Railway services/secrets. The
production observations above are historical; no new live DB/TLS verification
is claimed. Docker Desktop's Linux engine is unavailable locally, so Docker
image execution is not claimed. CI tests and Next.js build are checked separately.
