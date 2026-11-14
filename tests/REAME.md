```bat
set "SMOKE_DATABASE_URL=postgresql://brewlite:MAT_KHAU_LOCAL@localhost:5432/brewlite_foundation_smoke_local?schema=public"
npm --prefix apps/api run test:integration
```

## 1. Unit test api & web

```bat
npm --prefix apps/api test
npm --prefix apps/web test
```

## 2. Migration, integration và API E2E

```bat
set "SMOKE_DATABASE_URL=postgresql://brewlite:MAT_KHAU_LOCAL@localhost:5432/brewlite_foundation_smoke_local?schema=public"

npm --prefix apps/api run test:integration
npm --prefix apps/api run test:migration
npm --prefix apps/api run test:e2e
```

## 3. Browser E2E bằng playwright

```bat
set "DATABASE_URL=postgresql://brewlite:MAT_KHAU_LOCAL@localhost:5432/brewlite_local_e2e?schema=public"
npm --prefix apps/api run prisma:deploy

pushd apps\api
node --import=tsx prisma/seed-e2e.ts
popd

pushd apps\web
npx playwright install chromium
popd

npm --prefix apps/web run test:e2e
```

## Công thức chung để test bất kì nghiệp vụ nào

| Bộ test | `THU_MUC_APP` | `TEN_SCRIPT` |
|---|---|---|
| Unit API | `apps/api` | `test` |
| Integration API | `apps/api` | `test:integration` |
| E2E API | `apps/api` | `test:e2e` |
| E2E trình duyệt | `apps/web` | `test:e2e` |
| E2E VNPay | `apps/web` | `test:e2e:vnpay` |

```bat
npm --prefix THU_MUC_APP run TEN_SCRIPT -- TEN_FILE -t "DOAN_TEN_CA" > "test-evidence\TEN_LOG.log" 2>&1
```
