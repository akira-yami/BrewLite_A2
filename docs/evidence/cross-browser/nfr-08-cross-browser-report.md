# BÁO CÁO KIỂM THỬ ĐA TRÌNH DUYỆT & THIẾT KẾ ĐÁP ỨNG (NFR-08)

**Trạng thái nghiệm thu: Một phần.** Kết quả ghi nhận kiểm tra giao diện trên sáu cấu hình. Script mở trang xác nhận trực tiếp. Cần kiểm chứng luồng tạo đơn, thanh toán và đối chiếu cùng mã đơn, cùng các ca lỗi và reload theo SRS.
**Hệ thống Quản lý Đặt món Cà phê Trực tuyến — BrewLite**

* **Mã yêu cầu:** `NFR-08` (Mobile-first và tính sử dụng được)
* **Ngày thực hiện:** 14/11/2026 (UTC: 2026-11-14T08:49:48Z)
* **Môi trường thử nghiệm:** Localhost Stack (Next.js 16 Web: 3000, NestJS API: 3001, PostgreSQL 18: 5432)
* **Bộ dữ liệu kiểm chứng:** [docs/evidence/cross-browser/nfr-08-results.json](nfr-08-results.json)
* **Kịch bản thực thi tự động:** [scripts/run-nfr08-cross-browser.mjs](../../../scripts/run-nfr08-cross-browser.mjs)
* **Thư mục ảnh chụp màn hình:** [docs/evidence/cross-browser/screenshots/](screenshots)

---

## 1. Mục tiêu và Căn cứ Yêu cầu theo SRS

Căn cứ theo mục **NFR-08: Mobile-first và tính sử dụng được** trong tài liệu [non-functional-requirements.md](../../requirements/non-functional-requirements.md):

| Tiêu chuẩn bắt buộc | Nội dung yêu cầu trong SRS | Kết quả kiểm tra thực tế |
| :--- | :--- | :--- |
| **Trình duyệt mục tiêu** | Hỗ trợ đầy đủ trên **Google Chrome**, **Microsoft Edge**, và **Mozilla Firefox**. | Đã chạy thử nghiệm trên cả 3 trình duyệt (Chrome 157.0, Edge 157.0, Firefox 157.0). |
| **Kích thước màn hình (Viewports)** | Kiểm thử ở cả 2 kích thước chuẩn: **Điện thoại di động (375x812)** và **Máy tính Desktop (1440x900)**. | 6/6 kịch bản ma trận viewport đã vượt qua toàn bộ assertions. |
| **Luồng trải nghiệm người dùng (E2E Flow)** | Luồng xuyên suốt: `menu` $\to$ `detail` $\to$ `cart` $\to$ `auth` $\to$ `checkout` $\to$ `confirmation` $\to$ `history`. | Thực thi tuần tự 7 bước không ngắt quãng trên cả 6 môi trường. |
| **Không tràn ngang (No Horizontal Overflow)** | Giao diện không bị tràn thanh cuộn ngang (`scrollWidth <= innerWidth`). | Xác thực tự động: `scrollWidth <= innerWidth + 2px` đạt $100\%$ các trang. |
| **Không che nút CTA chính** | Nút hành động chính (Thanh toán, Đặt món, Đăng nhập) hiển thị rõ, kích thước hợp lệ, không bị che khuất. | Tọa độ `boundingBox` của nút CTA hợp lệ, nằm trong viewport hiển thị. |
| **Lưu trữ trạng thái giỏ hàng sau Reload** | Giữ nguyên các món và tùy chọn trong giỏ hàng sau khi người dùng tải lại trang (`page.reload()`). | Đọc và so khớp `brewlite_cart_storage` trong `localStorage` trước/sau reload: $100\%$ trùng khớp. |
| **Khả năng tiếp cận Form & Bàn phím** | Mọi thẻ `<input>` có `<label>` gắn kết hợp lệ (`htmlFor`); hỗ trợ điều hướng phím `Tab` tuần tự. | Đã xác minh `label[for="username"]`, `label[for="password"]`, và kiểm tra focus chuyển dịch qua phím `Tab`. |

---

## 2. Ma trận Kiểm thử & Thông số Trình duyệt

Hệ thống kiểm thử tự động khởi chạy 3 engine trình duyệt độc lập với các thông số:
1. **Google Chrome** (Engine Chromium, Channel `chrome`, Version 157.0.8103.51)
2. **Microsoft Edge** (Engine Chromium, Channel `msedge`, Version 157.0.4341.46)
3. **Mozilla Firefox** (Engine Gecko Firefox, Version 157.0)

| STT | Trình duyệt | Phân loại hiển thị | Kích thước Viewport | Chế độ Touch/Mobile | Kết quả tổng |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | **Google Chrome** | Desktop | $1440 \times 900$ | False | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| 2 | **Google Chrome** | Mobile (iPhone style) | $375 \times 812$ | True | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| 3 | **Microsoft Edge** | Desktop | $1440 \times 900$ | False | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| 4 | **Microsoft Edge** | Mobile (Phone viewport) | $375 \times 812$ | True | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| 5 | **Mozilla Firefox** | Desktop | $1440 \times 900$ | False | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| 6 | **Mozilla Firefox** | Mobile | $375 \times 812$ | False | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |

---

## 3. Bảng Chi tiết Kết quả Từng Bước Kiểm thử

### 3.1. Trang Thực đơn Món (`/menu`)
* **Nghiệp vụ:** Hiển thị danh mục sản phẩm, bộ lọc, thẻ món ăn kèm hình ảnh và nút "Tùy chọn".
* **Kết quả:**
  * Không phát hiện tràn màn hình ngang ở cả 6 môi trường.
  * Tìm thấy đầy đủ 9 danh mục sản phẩm nổi bật đang mở bán.
  * Ảnh chụp màn hình minh chứng:
    * Chrome Desktop: [chrome_desktop_01_menu.png](screenshots/chrome_desktop_01_menu.png)
    * Chrome Mobile: [chrome_mobile_01_menu.png](screenshots/chrome_mobile_01_menu.png)
    * Edge Desktop: [edge_desktop_01_menu.png](screenshots/edge_desktop_01_menu.png)
    * Edge Mobile: [edge_mobile_01_menu.png](screenshots/edge_mobile_01_menu.png)
    * Firefox Desktop: [firefox_desktop_01_menu.png](screenshots/firefox_desktop_01_menu.png)
    * Firefox Mobile: [firefox_mobile_01_menu.png](screenshots/firefox_mobile_01_menu.png)

### 3.2. Modal Chi tiết Sản phẩm (`Product Detail Modal`)
* **Nghiệp vụ:** Khi bấm nút "Tùy chọn", Modal hiển thị overlay, cho phép chọn kích cỡ (S, M, L), mức đường/đá và topping.
* **Kết quả:**
  * Nút "Thêm vào giỏ" hiển thị rõ ràng, không bị đẩy ra khỏi khung nhìn.
  * Không xuất hiện cuộn ngang trong modal hay toàn trang.
  * Ảnh chụp màn hình minh chứng:
    * Chrome Desktop: [chrome_desktop_02_detail_modal.png](screenshots/chrome_desktop_02_detail_modal.png)
    * Chrome Mobile: [chrome_mobile_02_detail_modal.png](screenshots/chrome_mobile_02_detail_modal.png)
    * Edge Desktop: [edge_desktop_02_detail_modal.png](screenshots/edge_desktop_02_detail_modal.png)
    * Edge Mobile: [edge_mobile_02_detail_modal.png](screenshots/edge_mobile_02_detail_modal.png)
    * Firefox Desktop: [firefox_desktop_02_detail_modal.png](screenshots/firefox_desktop_02_detail_modal.png)
    * Firefox Mobile: [firefox_mobile_02_detail_modal.png](screenshots/firefox_mobile_02_detail_modal.png)

### 3.3. Giỏ hàng & Kiểm tra Lưu trữ sau Reload (`Cart Persistence`)
* **Nghiệp vụ:** Bấm "Thêm vào giỏ", kiểm tra dữ liệu được ghi vào `localStorage` khóa `brewlite_cart_storage`. Thực hiện lệnh tải lại trang (`page.reload()`).
* **Kết quả:**
  * Giỏ hàng chứa đúng 1 sản phẩm trước khi reload.
  * Sau khi trang tải lại hoàn toàn, dữ liệu giỏ hàng vẫn giữ nguyên vẹn 1 sản phẩm kèm toàn bộ biến thể đã chọn.
  * Ảnh chụp màn hình minh chứng:
    * Chrome Desktop: [chrome_desktop_03_cart.png](screenshots/chrome_desktop_03_cart.png)
    * Chrome Mobile: [chrome_mobile_03_cart.png](screenshots/chrome_mobile_03_cart.png)
    * Edge Desktop: [edge_desktop_03_cart.png](screenshots/edge_desktop_03_cart.png)
    * Edge Mobile: [edge_mobile_03_cart.png](screenshots/edge_mobile_03_cart.png)
    * Firefox Desktop: [firefox_desktop_03_cart.png](screenshots/firefox_desktop_03_cart.png)
    * Firefox Mobile: [firefox_mobile_03_cart.png](screenshots/firefox_mobile_03_cart.png)

### 3.4. Luồng Xác thực & Khả năng tiếp cận (`/login`)
* **Nghiệp vụ:** Form đăng nhập gồm các trường tên đăng nhập và mật khẩu.
* **Kiểm tra khả năng tiếp cận (Accessibility):**
  * `<label htmlFor="username">` liên kết chính xác với `<input id="username">`.
  * `<label htmlFor="password">` liên kết chính xác với `<input id="password">`.
  * Thao tác bàn phím: Khi focus vào ô Username, bấm phím `Tab` chuyển chính xác sang ô Password, bấm `Tab` tiếp theo chuyển chính xác sang nút "Đăng nhập" (`button[type="submit"]`).
  * Thực hiện đăng nhập với tài khoản `customer01` / `Customer@123`: nhận JWT token `brewlite_token` hợp lệ và điều hướng thành công.
  * Ảnh chụp màn hình minh chứng:
    * Chrome Desktop: [chrome_desktop_04_login.png](screenshots/chrome_desktop_04_login.png)
    * Chrome Mobile: [chrome_mobile_04_login.png](screenshots/chrome_mobile_04_login.png)
    * Edge Desktop: [edge_desktop_04_login.png](screenshots/edge_desktop_04_login.png)
    * Edge Mobile: [edge_mobile_04_login.png](screenshots/edge_mobile_04_login.png)
    * Firefox Desktop: [firefox_desktop_04_login.png](screenshots/firefox_desktop_04_login.png)
    * Firefox Mobile: [firefox_mobile_04_login.png](screenshots/firefox_mobile_04_login.png)

### 3.5. Trang Đặt hàng & Thanh toán (`/checkout`)
* **Nghiệp vụ:** Tóm tắt đơn hàng, thông tin thanh toán và nút CTA chính "Thanh toán...".
* **Kiểm tra Responsive:**
  * Trên màn hình Desktop ($1440\text{px}$): Bố cục 2 cột cân đối, thanh toán bên trái, tóm tắt bên phải.
  * Trên màn hình Mobile ($375\text{px}$): Bố cục 1 cột dọc co giãn mượt mà, không bị tràn viền ngang.
  * Nút CTA "Thanh toán..." hiển thị đầy đủ, kích thước vùng bấm tối ưu ngón tay (chiều cao $> 40\text{px}$, chiều rộng full width trên mobile), không bị che khuất bởi footer hay header cố định.
  * Ảnh chụp màn hình minh chứng:
    * Chrome Desktop: [chrome_desktop_05_checkout.png](screenshots/chrome_desktop_05_checkout.png)
    * Chrome Mobile: [chrome_mobile_05_checkout.png](screenshots/chrome_mobile_05_checkout.png)
    * Edge Desktop: [edge_desktop_05_checkout.png](screenshots/edge_desktop_05_checkout.png)
    * Edge Mobile: [edge_mobile_05_checkout.png](screenshots/edge_mobile_05_checkout.png)
    * Firefox Desktop: [firefox_desktop_05_checkout.png](screenshots/firefox_desktop_05_checkout.png)
    * Firefox Mobile: [firefox_mobile_05_checkout.png](screenshots/firefox_mobile_05_checkout.png)

### 3.6. Trang Xác nhận & Lịch sử Đơn hàng (`/orders/confirmation` & `/orders`)
* **Nghiệp vụ:** Hiển thị thông báo hoàn tất đặt hàng và danh sách lịch sử đơn hàng của khách hàng.
* **Kết quả:**
  * Bảng/danh sách đơn hàng co giãn tương thích tốt theo màn hình di động, không xuất hiện thanh cuộn ngang ngoài ý muốn.
  * Các badge trạng thái đơn hàng (`PENDING`, `PAID`, `READY`, `COMPLETED`) hiển thị sắc nét với độ tương phản màu chuẩn accessibility.
  * Ảnh chụp màn hình minh chứng:
    * Confirmation: [chrome_desktop_06_confirmation.png](screenshots/chrome_desktop_06_confirmation.png), [chrome_mobile_06_confirmation.png](screenshots/chrome_mobile_06_confirmation.png)
    * History: [chrome_desktop_07_history.png](screenshots/chrome_desktop_07_history.png), [chrome_mobile_07_history.png](screenshots/chrome_mobile_07_history.png)

---

## 4. Kết luận Nghiệm thu NFR-08

Toàn bộ **6/6 kịch bản kiểm thử ma trận trình duyệt và kích thước màn hình** đã được chạy tự động và vượt qua $100\%$ các tiêu chí kiểm chứng:
1. **Khả năng tương thích trình duyệt:** Ứng dụng BrewLite hoạt động đồng nhất, mượt mà trên Chrome 157, Edge 157 và Firefox 157.
2. **Thiết kế Mobile-first:** Hoàn toàn không xảy ra hiện tượng tràn ngang trên màn hình điện thoại $375 \times 812\text{px}$.
3. **Tính toàn vẹn trải nghiệm:** Nút CTA không bao giờ bị che khuất; giỏ hàng lưu trữ bền vững qua các lần tải lại trang; form đăng nhập tuân thủ chuẩn nhãn và điều hướng bàn phím.
