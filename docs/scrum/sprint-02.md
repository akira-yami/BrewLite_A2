# Sprint 2 - Checkout, kiểm chứng và delivery

Trạng thái: kế hoạch; chưa có ngày/capacity/SP/kết quả. Owner/AC ở [backlog](product-backlog.md); kế thừa increment và gap thật của Sprint 1.

## Goal và phạm vi

Khách hoàn thành đơn end-to-end qua mock Ví/Thẻ, xem confirmation/history của mình. Giá/tồn/coupon/loyalty/trạng thái nhất quán khi concurrent/retry/timeout; có test, local stack, production HTTPS và bàn giao.

Phạm vi đề xuất #25–#41: detail/cart/checkout/history/auth/orders/payment/side effect; unit/integration/E2E; migration/Compose/CD/rollback/HTTPS/release; truy vết. Không tách Sprint thứ ba từ A1. FR-11 Should sau Must, FR-12..14 Could chờ capacity, FR-15 Won't.

## Thứ tự / phối hợp

1. Chốt schema/contract/ADR. #35 migration/seed (Hoàng) làm sớm cùng #27 auth (Huy), #28 orders (Khang), #29 payment (Kiệt). Chốt phân công inventory/promotions/loyalty theo backlog trước code.
2. #25 detail (Hoàng), #26 cart/checkout/history (Khải) tích hợp theo contract; #28/#29 thống nhất transaction/reservation/idempotency. Không để cuối Sprint mới nối UI/API.
3. #30–#33 test đi cùng nghiệp vụ; #34 browser E2E (Khải). Bao phủ sai chủ/rollback/same-key/different-key/timeout/restart/coupon hạn mức/một EARN.
4. #36 Compose/health/persistence (Hoàng), #37 CD (Khang), #38 migration/backup/rollback (Kiệt), #39 HTTPS (Khải) dùng hosting thực tế từ #16; không migration phá dữ liệu để ép rollback.
5. #41 (Khang) cập nhật truy vết theo từng PR; #40 release/demo (Kiệt) chỉ nghiệm thu khi đủ evidence.

Rủi ro: concurrency, payment unknown, scope lớn, hosting chưa chốt. Spike DB/recovery và E2E tăng dần, chốt hạ tầng trước CD; ghi dependency thật khi Blocked. Không tự giảm Must/AC để vừa Sprint.

## Review / exit

Demo happy path/chưa login/hết hàng/decline/unknown; nguyên liệu đủ 5 ly/20 request, idempotency, transition sai, ownership, coupon/loyalty. Evidence E2E/browser/NFR, checkout sạch, CI/CD, HTTPS/health, image/release/migration và restore/rollback. Đối chiếu [DoD](definition-of-done.md) và [biên bản Review & Retrospective Sprint 2](sprint2-review-retro.md).
