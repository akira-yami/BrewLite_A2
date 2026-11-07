# BrewLite API - NestJS / PostgreSQL

Requires Node **24.x** and npm. Run in `apps/api`:

```powershell
npm ci
npm run lint
npm test
npm run build
```

`npm ci` generates Prisma Client into ignored `src/generated/prisma`. These CI
commands do not connect to a database or run migrations. `npm run typecheck`
also checks unit test types. Unit tests mock the repository; they do not prove
PostgreSQL transactions, migration correctness or browser E2E behavior.

## Local runtime

Create `apps/api/.env` using the root sample. Set `DATABASE_URL` to your own
local PostgreSQL database, `PORT=3001`, `CORS_ORIGIN=http://localhost:3000`.
Both Prisma CLI and API load `.env` from the working directory `apps/api`.

```powershell
npm run db:migrate
npm run db:seed
npm run build
npm start
```

Migrate and seed write to the database. Use only your local/test database;
these commands have not been verified against PostgreSQL in this CI task.
The existing schema/seed still need their separate acceptance under #35.

Routes: `GET /api/v1/products`, `GET /api/v1/products/:id`. Invalid UUIDs
return 400; a missing product returns 404. Startup requires a database because
Prisma connects during module initialization. Missing DATABASE_URL fails clearly.
Rebuild after source changes before starting again.

Only CatalogModule is enabled. Auth/order/payment/health/deployment remain
separate issues. See [PR CI](../../docs/ci-pull-request.md).

## Migration và rollback

Tất cả migration là **forward-only** — không dùng `prisma migrate revert` hoặc xóa
migration đã apply. Để rollback schema, tạo migration mới đảo ngược thay đổi.

```powershell
# Xem trạng thái migration hiện tại (cần DATABASE_URL)
npm run db:status

# Apply migration lên DB target (production/staging)
npm run db:migrate
# hoặc alias dùng trong Railway pre-deploy:
npm run prisma:deploy

# Kiểm tra API sau deploy/rollback
node scripts/smoke.mjs http://localhost:3001
# hoặc với production URL:
node scripts/smoke.mjs https://api-production-1be6.up.railway.app
```

**Railway pre-deploy command:** `npm run prisma:deploy` — chạy tự động trước khi
Railway start container mới. Migration fail → deploy dừng, traffic giữ revision cũ.

Hướng dẫn đầy đủ về backup/restore, rollback app revision và evidence NFR-11:
[docs/evidence/cd/rollback-guide.md](../../docs/evidence/cd/rollback-guide.md)

## Catalog test suites

`npm test` discovers unit tests in both `src/**/*.spec.ts` and `test/**/*.spec.ts`.
`npm run test:integration` explicitly runs `test/**/*.integration-spec.ts`. It
requires `SMOKE_DATABASE_URL` pointing to a disposable database whose name starts
with `brewlite_foundation_smoke`. The seed suite writes test fixtures and refuses
other database names. Never use production or a shared DB. The integration suite
is not part of unit CI and has not been executed in this maintenance task.
