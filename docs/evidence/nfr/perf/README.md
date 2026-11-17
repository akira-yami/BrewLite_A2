# Chạy đo hiệu năng NFR-01

Các lệnh bên dưới dùng **Command Prompt (CMD)** trên Windows, chạy từ thư mục gốc `BrewLite_A2`. Cần Node.js 24, PostgreSQL local đang chạy và dependencies API đã cài (`npm ci --prefix apps/api`).

## 1. Tạo database test

Nếu database `brewlite_test_perf20` chưa tồn tại, mở Query Tool trong pgAdmin bằng tài khoản có quyền tạo DB và chạy:

```sql
CREATE DATABASE brewlite_test_perf20 OWNER brewlite;
```

Tên DB trên là ví dụ dùng xuyên suốt. Thay `MAT_KHAU_LOCAL` bằng mật khẩu của tài khoản PostgreSQL `brewlite`. API và script phải dùng chung DB test vì API ghi đơn trong lúc đo.

## 2. CMD thứ nhất — migrate, seed và bật API

```bat
set "DATABASE_URL=postgresql://brewlite:MAT_KHAU_LOCAL@localhost:5432/brewlite_test_perf20?schema=public"
npm --prefix apps/api run prisma:deploy
npm --prefix apps/api run db:seed
node scripts/seed-perf-nfr01.mjs
set "PORT=3001"
npm --prefix apps/api run start:dev
```

Chạy từng lệnh theo thứ tự và kiểm tra kết quả trước khi chạy lệnh tiếp theo. API cần cấu hình local hợp lệ trong `apps/api/.env`, gồm `JWT_SECRET`. Giữ terminal này mở. Nếu cổng 3001 đã có API dùng DB khác, dừng tiến trình đó trước hoặc chọn cổng khác và đổi URL ở bước 3.

## 3. CMD thứ hai — đo riêng tạo đơn với 20 client

```bat
set "DATABASE_URL=postgresql://brewlite:MAT_KHAU_LOCAL@localhost:5432/brewlite_test_perf20?schema=public"
set "API_BASE_URL=http://localhost:3001/api/v1"
curl.exe -f http://localhost:3001/api/v1/health
```

Sau khi health trả `status: ok`, chạy:

```bat
set "PERF_ORDERS_ONLY=1"
set "PERF_WARMUP_MS="
set "PERF_DURATION_MS="
set "PERF_RESULTS_FILE=nfr-01-orders-20-clients-local.json"
node scripts/run-load-test-nfr01.mjs
```

Lượt chuẩn dùng **20 client**, warm-up **30 giây** và đo **60 giây**. JSON mới nằm trong thư mục chứa README này. Dùng tên kết quả khác cho mỗi lượt cần giữ lại. Khi cần so sánh giữa các lượt, chuẩn bị lại dữ liệu và tồn kho trên DB test trước khi chạy.

## 4. Đo toàn bộ API trong kịch bản

Bật và cấu hình VNPay Sandbox cho **API local** theo [README API](../../../apps/api/README.md), rồi khởi động lại API với cùng DB test. Trong CMD thứ hai, giữ URL DB và API ở bước 3, đổi chế độ và tên file kết quả:

```bat
set "PERF_ORDERS_ONLY="
set "PERF_RESULTS_FILE=nfr-01-full-local.json"
node scripts/run-load-test-nfr01.mjs
```

Kịch bản chạy lần lượt danh sách món, chi tiết món, lịch sử đơn và tạo đơn. Phép đo thanh toán chạy riêng, ghi độ trễ bước API khởi tạo giao dịch và sinh liên kết VNPay.

## Đọc kết quả và xử lý lỗi

| Mục | Cách đọc |
|---|---|
| `statusCodes` | Với tạo đơn, `201` là thành công, `409` là xung đột. |
| `successPercentiles.p95` | p95 riêng của request thành công. Ngưỡng SRS là dưới 500 ms. |
| `errorRate5xxPercent` | Tỷ lệ lỗi 5xx và timeout. Ngưỡng SRS là dưới 1%. |
| `errorSamples` | Mẫu phản hồi lỗi và request ID để đối chiếu log API. |
| `passed` | Kết luận của script cho từng route. |

- `ECONNREFUSED` → kiểm tra API đang chạy và cổng trong `API_BASE_URL`.
- `relation "products" does not exist` → chạy `prisma:deploy` trên đúng DB test, rồi seed.
- Lỗi yêu cầu PostgreSQL test riêng → đặt lại `DATABASE_URL` và dùng API local. Tên `brewlite_test_perf20` đáp ứng kiểm tra của script.

[Báo cáo tạo đơn 20 client](nfr-01-orders-20-clients.md) · [Báo cáo toàn bộ NFR-01](nfr-01-load-test-report.md)
