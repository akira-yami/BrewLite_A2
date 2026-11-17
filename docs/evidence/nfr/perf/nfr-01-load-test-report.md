# Báo cáo đo tải hiệu năng API — NFR-01

Các kết quả dưới đây tổng hợp từ ảnh terminal của nhiều lượt đo local. Mỗi API đọc và tạo đơn trong bảng dùng 20 client đồng thời, warm-up 30 giây và đo chính thức 60 giây. Ngưỡng SRS cho các API chính là p95 dưới 500 ms và tỷ lệ 5xx/timeout dưới 1%.

| API | Mẫu và mã HTTP | Request/giây | p95 | 5xx/timeout |
|---|---|---:|---:|---:|
| [GET /products](screenshots/01-get-products.png) | 6.409 HTTP 200 | 106,6 | 306,26 ms | 0% |
| [GET /products/:id](screenshots/02-get-product-detail.png) | 40.035 HTTP 200 | 667 | 52,18 ms | 0% |
| [GET /orders/me](screenshots/03-get-order-history.png) | 54.125 HTTP 200 | 901,9 | 39,11 ms | 0% |
| [POST /orders](screenshots/04-post-orders.png) | 9.833 HTTP 201 | 163,6 | 189,08 ms | 0% |

Bốn API trên đạt hai ngưỡng trong các lượt có ảnh. Hai ảnh danh sách món ghi cùng số liệu, nên dùng một ảnh. Chi tiết món dùng ảnh đã lưu từ trước. [Chi tiết lượt đo tạo đơn](nfr-01-orders-20-clients.md)

## Thanh toán đo riêng

[Ảnh lượt Mock Gateway](screenshots/05-mock-payment-run.png) ghi bước script thực hiện chuỗi 100 lượt thử và snapshot DB sau khi đo. Ảnh chưa hiển thị mã HTTP hoặc độ trễ thanh toán.

[JSON của lượt VNPay riêng](nfr-01-results.json) ghi **100 HTTP 200**, p95 **5,02 ms** và 0 lỗi 5xx cho bước khởi tạo liên kết. Phép đo này kết thúc khi API sinh liên kết thanh toán. Các thông số API đọc trong JSON thuộc lượt khác với bảng ảnh trên.

## Tái chạy

[Hướng dẫn chạy](README.md) · [Script đo tải](../../../scripts/run-load-test-nfr01.mjs) · [SRS phi chức năng](../../requirements/non-functional-requirements.md)

## Hiệu năng tải trang menu trên Railway production

PageSpeed Insights đo trang [menu production](https://web-a2-production.up.railway.app/menu) bằng Lighthouse trên hai cấu hình. Đây là số liệu tải trang trong trình duyệt. Số liệu p95 API dưới tải nằm ở bảng NFR-01 phía trên.

| Cấu hình | Performance | FCP | LCP | TBT | CLS | Speed Index |
|---|---:|---:|---:|---:|---:|---:|
| [Desktop](screenshots/pagespeed-menu-desktop.png) | 100/100 | 200 ms | 500 ms | 0 ms | 0,001 | 700 ms |
| [Mobile](screenshots/pagespeed-menu-mobile.png) | 87/100 | 1.400 ms | 3.700 ms | 20 ms | 0 | 4.300 ms |

[PageSpeed Desktop](https://pagespeed.web.dev/analysis/https-web-a2-production-up-railway-app-menu/ea42ju245z?form_factor=desktop) · [PageSpeed Mobile](https://pagespeed.web.dev/analysis/https-web-a2-production-up-railway-app-menu/ea42ju245z?form_factor=mobile)
