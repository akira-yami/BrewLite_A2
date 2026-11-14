# Hướng dẫn Video Demo & Tài khoản Trải nghiệm — BrewLite A2

> **Dự án:** BrewLite – Assignment 2 (Requirements to Deployment)  
> **Môn học:** Công nghệ Phần mềm — Đại học Sài Gòn (SGU)  
> **Học kỳ:** I – Năm học 2026–2027  

---

## 1. Video Demo Trực tiếp Luồng End-to-End

Toàn bộ video demo luồng nghiệp vụ trên môi trường Production thực tế được lưu trữ tại Google Drive:

👉 **[BẤM VÀO ĐÂY ĐỂ MỞ THƯ MỤC VIDEO DEMO (GOOGLE DRIVE)](https://drive.google.com/drive/folders/1R0mMpga32tXJx-Pg-UcuiGaUncPrsqSE?hl=vi)**

### Kịch bản minh chứng trong Video:
1. **Khám phá Menu & Lọc sản phẩm:** Tải danh mục đồ uống trực quan, lọc món theo nhóm (Cà phê, Trà, v.v.), tìm kiếm sản phẩm theo tên.
2. **Chi tiết món & Tùy chọn:** Chọn Size (M, L), chọn độ ngọt/đá, thêm Topping (Trân châu trắng, Thạch sương sáo, Kem cheese).
3. **Giỏ hàng:** Xem giỏ hàng, cập nhật số lượng món, áp dụng mã giảm giá Coupon, kiểm tra tính toán tổng tiền chính xác.
4. **Xác thực:** Đăng ký tài khoản mới và đăng nhập tài khoản khách hàng bằng JWT.
5. **Đặt đơn & Thanh toán:** Gửi yêu cầu đặt đơn `POST /orders`, tiến hành thanh toán qua Cổng thanh toán (VNPay / Mock Gateway có Idempotency-Key).
6. **Xác nhận & Lịch sử đơn:** Nhận mã đơn hàng, xem trạng thái đơn và kiểm tra lịch sử đơn hàng của tài khoản.
7. **Cổng Barista (Nhân viên):** Đăng nhập quyền BARISTA, kiểm tra số lượng tồn kho nguyên liệu (`/barista/inventory`) và cập nhật trạng thái chế biến đơn hàng.

---

## 2. Đường dẫn Hệ thống Production Trực tuyến

Hệ thống chạy container Docker trên **Railway** qua HTTPS. Trạng thái theo revision và bằng chứng CD nằm trong [hồ sơ nghiệm thu](../docs/evidence/a2-delivery.md).

* 🚀 **Ứng dụng Web (Frontend Next.js):** [https://web-a2-production.up.railway.app/menu](https://web-a2-production.up.railway.app/menu)
* 💓 **Máy chủ API (Backend NestJS Health Check):** [https://api-a2-production.up.railway.app/api/v1/health](https://api-a2-production.up.railway.app/api/v1/health)

---

## 3. Tài khoản Demo Trải nghiệm

Form đăng nhập dùng **tên đăng nhập**. Trên production, khách có thể tự đăng ký hoặc dùng tài khoản demo do nhóm cung cấp. Khi nghiệm thu nghiệp vụ nhân viên, nhận thông tin tài khoản Barista trực tiếp từ nhóm.

Khi chạy Compose local với bước seed, catalog mẫu có sẵn và hai tài khoản demo là `customer01` và `barista01`. Cấu hình và mật khẩu demo local xem trong [mẫu môi trường](../.env.example).
