# Minh chứng Kiểm thử Tự động Postman / Newman (API Test Collection)

Tài liệu này ghi nhận kết quả chạy bộ kiểm thử toàn diện **Postman Collection (BrewLite API)** bằng **Newman CLI** trên môi trường local.

## 1. Thông tin bộ kiểm thử

- **Postman Collection:** `postman/BrewLite_API.postman_collection.json`
- **Postman Environment:** `postman/BrewLite_Environment.postman_environment.json`
- **Tập tin báo cáo đầy đủ (JSON):** [`newman-report.json`](newman-report.json)
- **Tập tin nhật ký thực thi (Log):** [`postman-newman-test-run.log`](postman-newman-test-run.log)

---

## 2. Kết quả tổng quan

| Chỉ số | Chi tiết | Kết quả |
| :--- | :--- | :--- |
| **Tổng số Requests** | 50 endpoints / kịch bản API | **50 Executed, 0 Failed** |
| **Tổng số Assertions** | 81 kiểm tra điều kiện | **81 Passed, 0 Failed (100% PASS)** |
| **Thời gian chạy** | ~6.5 giây | **Hoàn thành thành công** |
| **Trạng thái chung** | **PASS TOÀN BỘ (0 failures)** | ✅ Đạt chuẩn kiểm thử tự động |

---

## 3. Các nhóm API đã kiểm thử

1. **System & Health**: Root welcome (`/api/v1/`), Health check (`/health` 200 OK).
2. **Auth & Access Control**: Đăng ký, đăng nhập (Customer, Barista, Operator), 401 khi token sai, 403 khi truy cập tài nguyên của người khác (`OwnershipGuard`).
3. **Catalog & Products**: Lấy danh sách sản phẩm, chi tiết sản phẩm, bắt lỗi UUID không hợp lệ (400 Bad Request).
4. **Coupons & Promotions**: Kiểm tra mã giảm giá hợp lệ, mã không áp dụng được (422), kiểm tra auth.
5. **Orders**: Tạo đơn hàng mới (`PENDING`), validate payload sai (số lượng 0 -> 400), danh sách đơn, chi tiết đơn, hủy đơn (`CANCELLED`).
6. **Payments & VNPay**: Tạo thanh toán, idempotency key chống trùng, xử lý hoàn tiền (`REFUNDED`), đối soát lỗi (409).
7. **Staff Orders (Barista Flow)**: Hàng đợi pha chế, phân quyền Barista vs Customer (403), chuyển trạng thái `PREPARING` -> `READY` -> `COMPLETED`.
8. **Staff Inventory**: Quản lý nguyên vật liệu, chặn Barista tự ý sửa kho (`403 Forbidden`).

---

## 4. Lệnh tái hiện kiểm thử

```powershell
# Chạy bộ test Postman bằng Newman qua script tự động
node scripts/run-api-tests.mjs
```
Hoặc dùng trực tiếp Newman CLI:
```powershell
npx --yes newman run postman/BrewLite_API.postman_collection.json -e postman/BrewLite_Environment.postman_environment.json --ignore-redirects
```
