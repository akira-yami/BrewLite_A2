# ADR-006: Đồng bộ domain công thức/kho với BrewLite_A1

- Ngày: 04/11/2026. Quyết định theo yêu cầu người dùng: tương thích A1 và giữ UC-06/UC-08 tách biệt.
- Nguồn: [A1 @7beb0cb](https://github.com/akira-yami/BrewLite_A1/tree/7beb0cb06a2a89bc53a119bcb8d905cf596f548b), schema và service đọc cùng commit.
- Điều chỉnh phần giả định tồn variant trong ADR-002/004 và tài liệu Task 1–3 trước đây.

## Bối cảnh

SRS/kiến trúc cũ mô tả stock/version ở ProductVariant và loại kho nguyên liệu khỏi phạm vi. Code A1 hiện dùng Ingredient, RecipeItem/ToppingRecipeItem, InventoryReservationItem. Sơ đồ tổng thể đã tách UC-06: Tạo đơn và UC-08: Thực hiện thanh toán; tài liệu/sequence gộp trước đây không phản ánh ranh giới đó.

## Quyết định

1. Dùng domain A1 làm baseline: ProductVariant chỉ có catalog/size/price/active; Ingredient giữ stockQuantity/version với unit G/ML/PCS. BOM món là RecipeItem, BOM topping PREPACKAGED/PREPARED là ToppingRecipeItem.
2. Cộng nhu cầu ingredient trên mọi dòng/món/topping; cập nhật có điều kiện đủ tồn và nguyên liệu còn hoạt động theo ingredientId có thứ tự, tăng version theo mỗi lần ghi. InventoryReservation vẫn theo order/variant nhưng InventoryReservationItem lưu lượng nguyên liệu đã giữ để hoàn đúng khi công thức đổi. Enum expiry giữ EXPIRED theo schema A1.
3. Giữ tên model thật Coupon/CouponRedemption; Coupon là Promotion theo nghĩa đề bài. Giữ enum LoyaltyTransactionType và orderId nullable theo schema, không tự thêm chức năng redeem vào MVP.
4. OrderItem.unitPrice là giá variant, topping.unitPrice/quantity snapshot riêng. Tính lineTotal từ tổng giá món/topping mỗi ly rồi nhân số ly, không cộng topping hai lần.
5. UC-06 chỉ tạo PENDING/giữ nguyên liệu/coupon/history; UC-08 độc lập mới tạo Payment/consume/EARN. Không có include/extend giữa chúng. Coupon UC-07 extend UC-06; login UC-02 là tiền điều kiện. Giữ nguyên nguồn/PNG sơ đồ tổng thể của nhóm và tên UC đã có trong đó.

## Hệ quả và kiểm chứng

Cập nhật scope, AC/NFR fixture, kiến trúc/ADR, class/sequence, test plan/truy vết và backlog liên quan. Fixture tồn đủ 5 ly được diễn đạt bằng X=50, BOM X=10 thay cho ProductVariant.stock=5. Cần ca nguyên liệu dùng chung giữa variant/topping, thiếu BOM/ingredient inactive, đổi BOM sau reserve, rollback/cạnh tranh và hoàn theo snapshot.

UI quản trị kho/mua hàng/nhà cung cấp vẫn ngoài MVP; BOM/kho lõi đã thuộc phạm vi. A2 chưa có runtime/migration tương ứng, nên không nhận code hoặc test A1 là minh chứng A2. Các hành vi đích chưa xác minh từ A1 như recovery khi mất ACK, hủy PAID/hoàn tiền được ghi riêng, không suy ra từ schema.
