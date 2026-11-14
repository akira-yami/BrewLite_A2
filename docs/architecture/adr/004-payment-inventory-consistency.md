# ADR-004: Reservation và payment attempt bền vững

- Ngày: 03/11/2026. Cập nhật theo checkout A2 ngày 10/11/2026.
- Truy vết: [#12](https://github.com/akira-yami/BrewLite_A2/issues/12), [kiến trúc](../system-architecture.md); FR-06/07/09/10, NFR-04/05.

## Bối cảnh

Nhiều khách mua phần tồn cuối; client gửi lại payment hoặc mất response. Gateway và DB không thể commit chung một transaction. Unique payment key đơn lẻ không ngăn hai key khác nhau trả tiền cùng order.

## Quyết định

1. Tạo order/items/history, giảm Ingredient.stockQuantity bằng cập nhật nguyên tử có điều kiện đủ tồn và còn hoạt động trong transaction Read Committed, tăng version sau khi trừ, reserve inventory/coupon cùng transaction ngắn. Cộng nhu cầu ingredient theo BOM món/topping toàn giỏ, cập nhật theo ingredientId ổn định; reservation mỗi order/variant và snapshot lượng ingredient ở InventoryReservationItem. Lỗi rollback tất cả.
2. Mỗi payment attempt có key unique và hash từ orderId, method và amount. Trạng thái gồm PROCESSING, SUCCEEDED, FAILED, MANUAL_REVIEW và REFUNDED. Kiểm tra JWT/chủ đơn trước replay. Khóa order để chỉ một attempt đang xử lý, kể cả khác key; DB thêm partial unique success/order và EARN/order.
3. Checkout tạo attempt VNPay và URL trong transaction ngắn. IPN hoặc Return hợp lệ trong Sandbox chốt payment, order, history, reservation, coupon và loyalty trong cùng transaction.
4. Cùng key/hash trả kết quả đã ghi, gồm URL nếu VNPay còn PROCESSING. Key mới gặp attempt đang xử lý trả 409 PAYMENT_IN_PROGRESS. Key trùng với payload khác trả 409 IDEMPOTENCY_KEY_REUSED. Decline xác định giữ tồn đến hạn retry, key mới và không reserve lần hai. Order PAID không có payment success thứ hai.
5. Khi chưa có kết quả, Web tra trạng thái theo key. Callback trùng dùng trạng thái đã ghi. Thành công muộn có thể chuyển MANUAL_REVIEW. Luồng đối soát có role riêng, QueryDr theo cấu hình và audit.
6. Expiry/cancel/pay cùng khóa order và kiểm tra attempt đang xử lý. Chỉ ACTIVE reservation được consume/RELEASED/EXPIRED một lần; release/expiry hoàn theo snapshot InventoryReservationItem; hết hạn chỉ áp dụng đơn chưa paid không có payment chưa rõ. Hủy PAID trước PREPARING theo SRS giữ payment/coupon/điểm, hoàn tồn một lần, không hoàn tiền mock. Luật hủy và tỷ lệ điểm vẫn chờ PO review.

## Lý do và phương án khác

DB constraint/transaction sống qua restart và nhiều instance; mutex/cache memory không đáp ứng. Trừ tồn sau payment có thể để khách đã trả tiền nhưng hết hàng. Giữ DB transaction khi gọi gateway làm lock dài và vẫn không giải quyết atomic commit với hệ ngoài. Mock Ví/Thẻ cho phép test API với kết quả xác định. Luồng ứng dụng dùng chữ ký callback, khóa đơn và audit để chốt và đối soát VNPay.

## Hệ quả và kiểm chứng

Các nhánh hết hạn và đối soát dùng khóa đơn. Xem [UC-08](../../requirements/uc-08-thanh-toan.md) cho hành vi hiện tại. TTL reservation là cấu hình phải review trước code, không tự lấy giá trị cũ A1 làm yêu cầu A2.

Integration trên PostgreSQL thật bắt buộc: BOM X=10, tồn X=50/20 request; fault sau reserve; same-key 20 request/replay/restart; khác payload; khác key cùng order; sai chủ; decline retry; timeout; crash sau gateway success trước finalize; expiry/cancel/payment race; PAID cancel/prepare race; một coupon consume và một EARN. Có thiết kế/constraint không thay bằng chứng các phép thử này đã chạy.

Cập nhật 04/11/2026: UC-06: Tạo đơn và UC-08: Thực hiện thanh toán là use case độc lập. Phần payment của ADR này chỉ áp dụng UC-08, không gộp vào sequence UC-06. [ADR-006](006-a1-recipe-inventory.md) điều chỉnh giả định kho.
