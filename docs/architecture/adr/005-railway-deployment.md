# ADR-005: Railway cho topology production BrewLite A2

- Ngày: 04/11/2026. Quyết định nền tảng: Railway theo xác nhận của người dùng.
- Truy vết: [#16](https://github.com/akira-yami/BrewLite_A2/issues/16), [deployment](../../deployment.md), NFR-06/07/09/10/11.

## Bối cảnh

Nhóm đã có project Railway `aware-clarity` với Web/API/Postgres nhưng source đang là BrewLite_A1. A2 mới có hồ sơ/khung, chưa có runtime/Dockerfile hay release. Cần phân biệt topology thực tế và cam kết deploy A2.

## Quyết định

Dùng Railway làm nền tảng đích cho Web Next.js, API NestJS và Postgres có volume. Web/API dùng HTTPS domain riêng qua edge, DB nội bộ, migration trước API start, env/secrets phía platform, log stdout và readiness. Mock payment nằm trong API. Không dựng CDN độc lập hoặc registry app/CI push image khi chưa có cấu hình tương ứng.

Giữ snapshot topology A1 hiện có làm căn cứ thiết kế, ghi rõ repo/source/volume/ports/probes và staged changes. Khi có runtime A2, triển khai qua #37–#39 rồi cập nhật snapshot/source mapping/digest/smoke. ADR này không tự authorize apply pending patch, thay source hoặc deploy lên dịch vụ đang chạy.

## Lý do và trade-off

Railway phù hợp nền tảng nhóm đã chọn và đang dùng, cung cấp build từ Dockerfile, domains/env, private DB và volume. Một replica mỗi service phù hợp demo nhưng không chứng minh HA/SLA; quota/disk/chi phí phải theo dõi. Tách Web/API domain cần CORS/public API URL đúng; giá trị public URL gắn vào bundle cần rebuild khi đổi. Backup/restore, migration an toàn và rollback vẫn là trách nhiệm của nhóm.

VPS tự quản cho phép kiểm soát mạng/registry nhưng tăng vận hành TLS/backup/monitoring. Chia Vercel frontend và nền tảng API/DB khác cũng hợp lệ nhưng tăng tích hợp nhiều nhà cung cấp; không chọn vì nhóm xác nhận Railway.

## Kiểm chứng và hệ quả

Trước nghiệm thu: runtime A2/Node/env đồng bộ, CI pass/fail và gate thật; repo/branch/commit/image khớp deploy; HTTPS/health/smoke, persistence/restore/rollback và NFR có evidence. Hiện chỉ có snapshot cấu hình A1; không ghi A2 đã release hoặc NFR đã đạt. Theo yêu cầu 04/11/2026, SRS/class/kiến trúc A2 được đồng bộ mô hình công thức/kho nguyên liệu A1 ở PR #52; snapshot production vẫn có source A1, chưa chứng minh deployment A2.
