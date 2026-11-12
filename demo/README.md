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

Hệ thống được đóng gói container Docker và triển khai tự động qua Continuous Delivery lên nền tảng **Railway** với HTTPS:

* 🚀 **Ứng dụng Web (Frontend Next.js):** [https://web-a2-production.up.railway.app/menu](https://web-a2-production.up.railway.app/menu)
* 💓 **Máy chủ API (Backend NestJS Health Check):** [https://api-a2-production.up.railway.app/api/v1/health](https://api-a2-production.up.railway.app/api/v1/health)

---

## 3. Tài khoản Demo Trải nghiệm

Dữ liệu mẫu đã được nạp sẵn vào cơ sở dữ liệu để phục vụ việc kiểm thử và nghiệm thu:

| Vai trò | Email đăng nhập | Mật khẩu | Quyền hạn và phạm vi trải nghiệm |
|:---|:---|:---|:---|
| **Khách hàng (Customer)** | `customer@brewlite.test` | Liên hệ nhóm | Xem menu, tùy chọn món, tạo đơn hàng, thanh toán, xem lịch sử đơn của bản thân |
| **Nhân viên quầy (Barista)** | `barista@brewlite.test` | Liên hệ nhóm | Quản lý công thức pha chế, kiểm tra tồn kho nguyên liệu BOM, cập nhật trạng thái đơn |
| **Quản trị viên (Admin)** | `admin@brewlite.test` | Liên hệ nhóm | Toàn quyền kiểm soát hệ thống |
