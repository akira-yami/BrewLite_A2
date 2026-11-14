# BÁO CÁO KIỂM CHỨNG PWA NGOẠI TUYẾN & PHỤC HỒI KẾT NỐI (NFR-12)

**Trạng thái nghiệm thu: Một phần.** Lần chạy lưu ảnh xác minh banner và giỏ local khi đổi trạng thái mạng. Cần chạy lại trên revision có vỏ ngoại tuyến mới và kiểm tra checkout/payment, logout và tra cứu trạng thái đơn từ server sau kết nối lại.
**Hệ thống Quản lý Đặt món Cà phê Trực tuyến — BrewLite**

* **Mã yêu cầu:** `NFR-12` (Hướng PWA và hành vi khi mất mạng)
* **Ngày thực hiện:** 14/11/2026 (UTC: 2026-11-14T08:54:34Z)
* **Môi trường thử nghiệm:** Chrome Mobile Viewport $375 \times 812\text{px}$ (Next.js 16 Web: 3000, NestJS API: 3001)
* **Dữ liệu thô đối chứng:** [docs/evidence/pwa/nfr-12-pwa-results.json](nfr-12-pwa-results.json)
* **Kịch bản kiểm thử tự động:** [scripts/run-nfr12-pwa-test.mjs](../../../scripts/run-nfr12-pwa-test.mjs)
* **Service Worker cài đặt:** [apps/web/public/sw.js](../../../apps/web/public/sw.js)
* **Component giám sát kết nối:** [apps/web/src/features/pwa/OfflineBanner.tsx](../../../apps/web/src/features/pwa/OfflineBanner.tsx)
* **Web App Manifest:** [apps/web/src/app/manifest.json](../../../apps/web/src/app/manifest.json)

---

## 1. Mục tiêu và Căn cứ Nghiệm thu theo SRS

Căn cứ theo mục **NFR-12: Hướng PWA và hành vi khi mất mạng** trong tài liệu [non-functional-requirements.md](../../requirements/non-functional-requirements.md):

| Tiêu chuẩn bắt buộc | Nội dung yêu cầu trong SRS | Kết quả kiểm tra thực tế | Đánh giá |
| :--- | :--- | :--- | :---: |
| **Web App Manifest** | Cung cấp manifest hợp lệ, định nghĩa tên ứng dụng, icon, `start_url`, `display: standalone` và `scope`. | Đã định nghĩa và phục vụ hợp lệ tại `/manifest.json`, icon chuẩn $192\text{px}$ và $512\text{px}$. | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| **Vỏ ngoại tuyến và Service Worker** | Hiện trang dự phòng khi điều hướng mất mạng và tránh lưu dữ liệu nhạy cảm. | `sw.js` chỉ cache trang `/offline.html` và bỏ qua API, request ghi và request khác origin. | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| **Hành vi khi mất mạng (Offline)** | Hiển thị cảnh báo trực quan; giữ nguyên giỏ hàng cục bộ trong `localStorage`. | Banner cảnh báo màu hổ phách xuất hiện; giỏ hàng giữ nguyên vẹn 1 món với đầy đủ tùy chọn. | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| **Không gian lận / Không charge tự động giả mạo** | Không tự ý tạo xác nhận đơn hàng giả, không xếp hàng tự động trừ tiền khi đang offline. | Service worker không có hàng đợi ghi. Chưa chạy ca checkout/payment offline. | Chưa kiểm chứng đầy đủ |
| **Hành vi khi có mạng trở lại (Reconnect)** | Tự động bắt sự kiện `online`, hiển thị thông báo khôi phục và cho phép tiếp tục đặt món. | Đã quan sát banner khôi phục. Chưa kiểm tra tra cứu giao dịch sau kết nối lại. | Một phần |

---

## 2. Kiến trúc PWA & Cơ chế Bảo vệ Offline của BrewLite

### 2.1. Manifest

Bản hiện tại lấy cấu hình từ [manifest](../../../apps/web/src/app/manifest.json), với tên BrewLite — Cà phê & Trà, scope `/`, start URL `/menu` và hai icon PNG 192/512 px.

### 2.2. Hành vi service worker

- Component đăng ký `/sw.js` khi Web chạy bản production trong ngữ cảnh hỗ trợ service worker.
- Cache `brewlite-shell-v2` chứa `/offline.html`. Điều hướng GET cùng origin ưu tiên mạng và dùng trang này khi fetch thất bại.
- Worker bỏ qua `/api/`, request khác origin và request ghi. Giỏ được duy trì trong localStorage bởi cart store.

## 3. Bảng Kết quả Kiểm chứng Chi tiết

Quá trình kiểm thử tự động với Playwright mô phỏng thiết bị di động ($375 \times 812\text{px}$) gồm 4 giai đoạn liên hoàn:

| Giai đoạn | Thao tác mô phỏng | Hiện tượng & Dữ liệu ghi nhận | Đánh giá |
| :---: | :--- | :--- | :---: |
| **Pha 1: Online** | Khách hàng mở menu trực tuyến, chọn 1 ly "Cà phê sữa Cầu Đất" size M, thêm vào giỏ. | * Giỏ hàng `brewlite_cart_storage` ghi nhận 1 sản phẩm.<br>* Service Worker kích hoạt thành công (`scope: http://localhost:3000/`, `active: true`). | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| **Pha 2: Mất mạng** | Ngắt kết nối mạng hoàn toàn (`context.setOffline(true)`). Phát sự kiện `offline`. | * Banner cảnh báo màu hổ phách xuất hiện cố định ở đầu trang.<br>* Nội dung: *"Mất kết nối mạng. Bạn đang ở chế độ ngoại tuyến. Giỏ hàng vẫn được lưu cục bộ; thanh toán trực tuyến cần có kết nối mạng. Thử lại"*. | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| **Pha 3: Kiểm tra giỏ** | Kiểm tra trạng thái dữ liệu giỏ hàng trong `localStorage` khi đang offline. | * Giỏ hàng trong `localStorage` vẫn giữ nguyên $100\%$ sản phẩm và cấu hình.<br>* Không bị mất giỏ hay bị xóa phiên. | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |
| **Pha 4: Phục hồi** | Kết nối mạng trở lại (`context.setOffline(false)`). Phát sự kiện `online`. | * Banner chuyển sang thông báo màu xanh lá dịu mắt.<br>* Nội dung: *"Đã khôi phục kết nối mạng. Bạn có thể tiếp tục đặt món. Đóng"*. | <span style="color:green;font-weight:bold;">✅ ĐẠT</span> |

---

## 4. Hình ảnh Minh chứng Thực tế

1. **Trạng thái Mất kết nối Mạng (Offline Alert Banner):**
   * Hiển thị banner cảnh báo màu hổ phách cảnh báo người dùng về việc tạm dừng thanh toán trực tuyến nhưng bảo toàn giỏ hàng.
   * Minh chứng hình ảnh: [nfr-12-offline-banner.png](nfr-12-offline-banner.png)

2. **Trạng thái Khôi phục Kết nối Mạng (Online Reconnect Banner):**
   * Hiển thị thông báo phục hồi màu xanh lá xác nhận Internet đã hoạt động trở lại.
   * Minh chứng hình ảnh: [nfr-12-reconnect-banner.png](nfr-12-reconnect-banner.png)

---

## 5. Kết luận Nghiệm thu NFR-12

Các ảnh xác minh banner và việc giữ giỏ local. Ca tra cứu trạng thái giao dịch sau kết nối lại vẫn cần kiểm chứng.

## Kiểm tra lại vỏ ngoại tuyến trên bản build production local

Chrome 157.0.8103.51, localhost ngày 2026-11-14. Trình duyệt nhận manifest với start URL /menu. Service worker kiểm soát trang và cache chỉ có /offline.html. Khi ngắt mạng, điều hướng vào /menu, /checkout và /orders/confirmation đều hiển thị trang ngoại tuyến. Bật mạng và bấm mở lại menu đưa trình duyệt về /menu.

Còn thiếu lần chạy trên URL HTTPS của bản nộp và tình huống truy vấn trạng thái thanh toán sau khi kết nối lại.
