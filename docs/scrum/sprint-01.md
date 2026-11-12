# Sprint 1 - Nền tảng và menu

Trạng thái: kế hoạch; chưa ghi nhận ngày bắt đầu/kết thúc, capacity/SP hoặc kết quả review. Owner/AC ở [backlog](product-backlog.md).

## Goal và phạm vi

Checkout sạch chạy Web Next.js đọc catalog thật từ NestJS/PostgreSQL, menu mobile-first có loading/empty/error, hồ sơ thiết kế có version và CI kiểm tra PR.

Cam kết đề xuất: #17 repository/quy trình (Khang), #18 hồ sơ Task 1–3 (Khải), #21 catalog/seed và #22 menu và #23 test (Hoàng), #24 CI (Khang). #19/#20 là cặp trùng cần xác nhận, không tính capacity lần hai.

## Thứ tự / dependency

1. Review Task 1–3 và contract catalog; #17 chuẩn hóa cấu trúc/README/env/quy trình.
2. #21 khởi tạo API/DB/migration/seed tối thiểu; #22 khởi tạo Web theo contract. UI có thể dùng fixture khi làm song song, nghiệm thu phải gọi API thật.
3. #23 test API/menu/UI states/build; #24 thiết lập khi có lockfile/lệnh thật, xác minh pass/fail và required checks chặn lỗi.
4. #18 quản lý tạo phẩm/phiên bản xuyên Sprint; cập nhật README bằng lệnh đã chạy từ checkout sạch.

Rủi ro: lệch contract, chưa có runtime, CI trước scripts, seed không lặp an toàn. Giảm thiểu bằng tích hợp dọc catalog/menu, contract sớm, clean checkout. Spike transaction/payment nếu cần để giảm rủi ro Sprint 2, không ghi nghiệp vụ hoàn tất từ spike.

## Review / exit

Demo menu dữ liệu thật và UI states; lưu lint/test/build/CI run, required checks và clean-checkout. Đối chiếu [DoD](definition-of-done.md), FR-01/02 và NFR liên quan. Xem [biên bản Review & Retrospective Sprint 1](sprint1-review-retro.md) để tra các mốc và bằng chứng đã ghi nhận. Phần không đạt đưa lại backlog có lý do, không tự ghi Done.
