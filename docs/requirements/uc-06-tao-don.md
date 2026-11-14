# UC-06: Tạo đơn

Phiên bản 1.1 · 04/11/2026 · [A2-1.3.1 / #5](https://github.com/akira-yami/BrewLite_A2/issues/5).

[Nguồn PlantUML](../diagrams/use-case-uc06.puml) · [SVG](../diagrams/use-case-uc06.svg) · [PNG](../diagrams/use-case-uc06.png).

![UC-06: Tạo đơn](../diagrams/use-case-uc06.svg)

## 1. Phạm vi và tác nhân

| Thuộc tính | Đặc tả |
|---|---|
| Tên chuẩn | UC-06: Tạo đơn, đúng sơ đồ tổng thể của nhóm |
| Mục tiêu | Tạo order PENDING với giá/snapshot server và giữ đủ nguyên liệu theo công thức món, topping |
| Actor | Khách hàng (CUSTOMER). Nhân viên quầy và Mock Payment Gateway không tham gia UC-06 |
| Trigger | Khách chọn Đặt hàng sau khi kiểm tra giỏ |
| Tiền điều kiện | Giỏ có dữ liệu; trước khi gửi API phải có phiên CUSTOMER hợp lệ. Backend kiểm tra lại active catalog, công thức, nguyên liệu, coupon và DB; hiển thị còn hàng ở client không là cam kết tồn |
| Hậu điều kiện thành công | Order/items/topping snapshots, reservation và lượng nguyên liệu snapshot, coupon RESERVED nếu có, history NULL -> PENDING cùng commit; total do server tính, trả orderId và hạn giữ tồn |
| Bảo đảm khi lỗi | Lỗi xác định trước commit rollback toàn bộ, gồm Ingredient.stockQuantity/version; UI giữ giỏ. Mất response/ACK commit là kết quả chưa rõ, không tự tạo lại |
| Ngoài phạm vi UC-06 | Không gọi gateway, không tạo Payment, không chuyển PAID/PAYMENT_FAILED, không consume reservation hoặc cộng điểm |

UC-07: Áp dụng coupon là phần mở rộng tùy chọn của UC-06. UC-02: Đăng nhập là tiền điều kiện khi chưa có phiên. **UC-08: Thực hiện thanh toán** là use case độc lập sử dụng orderId sau UC-06; không gộp, không có include/extend giữa UC-06 và UC-08. UC-09: Xem xác nhận và lịch sử đơn hàng hỗ trợ tra cứu sau đặt hoặc khi mất response. Sơ đồ tổng thể [UC-01..10](use-case-overview.md) là nguồn tên/actor chuẩn.

## 2. Luồng chính

| Bước | Hành động | Kết quả |
|---|---|---|
| M1 | Khách kiểm tra size/topping/đường/đá/note/quantity, nhập coupon nếu có | Web tạm tính, giữ giỏ; thiếu phiên đi qua UC-02 rồi quay lại |
| M2 | Web gửi POST /api/v1/orders với JWT, items, couponCode? | Không gửi giá/userId/status làm dữ liệu quyết định nghiệp vụ; khóa nút trong lúc chờ |
| M3 | API kiểm tra JWT/CUSTOMER/DTO và chuẩn hóa | 1..20 dòng; quantity 1..20 sau gộp; topping hợp lệ/không trùng; sugar/ice null hoặc 0..100, 0 khác null; note trim <=500, trống thành null |
| M4 | Orders mở transaction ReadCommitted, kiểm tra user active, đọc catalog, RecipeItem và ToppingRecipeItem kèm Ingredient | Giá/tên từ DB. Tổng nhu cầu từng ingredient bằng công thức món và mỗi topping được chọn nhân quantity qua mọi dòng; kiểm tra cả nguyên liệu dùng chung giữa variant/topping |
| M5 | Nếu có coupon: khóa/kiểm tra và tính discount; tạo Order PENDING/items/topping snapshots | OrderItem.unitPrice là giá variant; topping snapshot có unitPrice và quantity=1 mỗi ly. lineTotal=(giá variant + tổng giá topping mỗi ly) x quantity; total=subtotal-discount >=0 |
| M6 | Inventory giữ nguyên liệu theo ingredientId tăng dần | UPDATE Ingredient WHERE isActive AND stockQuantity>=need, giảm stockQuantity/tăng version. Tạo InventoryReservation mỗi order/variant và InventoryReservationItem lưu lượng từng ingredient đã giữ, gồm cả topping |
| M7 | Giữ coupon RESERVED nếu có, ghi history NULL -> PENDING rồi commit | Tất cả thao tác cùng transaction client; một lỗi không để dữ liệu dở dang |
| M8 | API trả 201 với snapshot/tổng tiền/orderId/expiry | Web hiển thị đơn đã đặt ở PENDING; chưa xóa giỏ vì chưa thanh toán; UC-06 kết thúc. Checkout tiếp tục sang UC-08 trong cùng thao tác thanh toán nếu tạo đơn thành công |

Công thức kho theo [A1 commit 7beb0cb](https://github.com/akira-yami/BrewLite_A1/tree/7beb0cb06a2a89bc53a119bcb8d905cf596f548b): ProductVariant không có stock/version; Ingredient mới là nơi lưu tồn. availableServings chỉ được tính từ công thức. Đường/đá/note là snapshot, code tham chiếu chưa đổi lượng BOM theo các mức này. Không diễn giải mức đường/đá thành công thức mới ngoài implementation.

## 3. Luồng thay thế

| Mã | Tại bước / tình huống | Xử lý |
|---|---|---|
| A1 | M1–M3: chưa login hoặc hết phiên | Giữ giỏ, UC-02 rồi tiếp tục; request 401 không ghi order |
| A2 | M4–M7: không có coupon | discount=0, không tạo CouponRedemption |
| A3 | M3: khác note/tùy chọn trên cùng variant | Giữ item riêng nhưng cộng nhu cầu ingredient trên toàn đơn; cùng mọi lựa chọn thì gộp trong giới hạn |
| A4 | M6: cập nhật tồn có điều kiện thất bại hoặc transaction gặp xung đột ghi/deadlock | Rollback và đọc/tính lại toàn transaction; tối đa 3 attempt tổng cộng, TTL lấy từ config theo phút. Không retry lỗi hết nguyên liệu hoặc chỉ retry phần ghi |

## 4. Ngoại lệ

| Mã | Tình huống | Phản hồi / bảo đảm |
|---|---|---|
| E1 | Thiếu/sai/hết hạn JWT hoặc không phải CUSTOMER | 401/403, không ghi DB |
| E2 | DTO/UUID/quantity/note/topping trùng hoặc trường giả mạo | 400, không tạo order; hiển thị lỗi, giữ giỏ |
| E3 | Variant/topping inactive, không thuộc product, không có công thức hoặc ingredient inactive | Không cho đặt; phân biệt option sai 400 và không đủ khả năng cung ứng 409 theo API contract |
| E4 | Thiếu ingredient sau cộng toàn bộ món/topping, dù từng variant riêng có vẻ còn hàng | 409 OUT_OF_STOCK, rollback toàn bộ order/items/reservation/items/coupon/history/stockQuantity/version |
| E5 | Coupon sai/hết hạn/hết lượt/không đạt minimum | 422 COUPON_NOT_APPLICABLE theo contract hiện hành; không tự bỏ mã để đặt giá khác |
| E6 | Hết retry conflict | 409 INVENTORY_CONFLICT, không giả báo hết hàng; không có ghi dở dang |
| E7 | DB lỗi xác định trước commit | Rollback; 500 chung với requestId, không lộ stack/connection string |
| E8 | Mất response hoặc không rõ ACK commit | Không giả rollback, không tự POST /orders lại vì endpoint chưa idempotent. Giữ giỏ, kiểm tra UC-09 trước khi khách chủ động đặt lại |
| E9 | Offline/storage lỗi | Giữ giỏ nếu có thể, báo lỗi, không queue order hoặc tạo xác nhận giả |

## 5. Truy vết và nghiệm thu

| FR / AC | Luồng | Ca kiểm chứng |
|---|---|---|
| AT-FR-03.1..3 | M1/M3/M5, E2 | Null/0, note 500/501, quantity/topping; 50.000 + 7.000 x2 =114.000 |
| AT-FR-04.1..2 | M1/M8, A1/A3, E8/E9 | Gộp/tách/persist, login giữ giỏ; không xóa giỏ chỉ vì order 201 |
| AT-FR-05.2..3 | M3, E1 | JWT/role/phiên, backend từ chối request trái quyền |
| AT-FR-06.1..4 | M2–M8, A2/A4, E3–E8 | Giá/chủ server, snapshot/BOM, rollback và concurrency trên PostgreSQL |
| AT-FR-10.1..2 | M5/M7, A2, E5 | Coupon optional, quota giữ nguyên tử, tổng không âm; consume/loyalty thuộc UC-08 |

Fixture cạnh tranh: một món cần 10 đơn vị ingredient X, tồn X=50, không topping hoặc ingredient khác là nút thắt; 20 request đồng thời mua 1 ly, đủ budget retry cho test. Đúng 5 order commit, tồn X=0, tổng quantity reservation ACTIVE=5, snapshot giữ X tổng=50. Thêm ca hai variant và topping cùng dùng X để bắt lỗi kiểm tra tồn riêng lẻ, ca đổi BOM sau reserve để chứng minh hoàn đúng snapshot. Các phép thử là kế hoạch, không phải kết quả đã chạy trên A2.

Xem [SRS](srs.md), [NFR](non-functional-requirements.md), [kiến trúc](../architecture/system-architecture.md), [test plan](../testing/test-plan.md). Thay đổi mô hình kho/các tên UC được cập nhật ở PR #52; sequence chỉ UC-06 ở PR #51. UC-08 được theo dõi riêng tại #6/#9.

## 6. Kết xuất

Java + PlantUML 1.2026.8, từ root repository:

```powershell
java '-Djava.awt.headless=true' '-DPLANTUML_LIMIT_SIZE=16000' -jar C:/tools/plantuml-1.2026.8.jar -charset UTF-8 -tsvg docs/diagrams/use-case-uc06.puml
java '-Djava.awt.headless=true' '-DPLANTUML_LIMIT_SIZE=16000' -jar C:/tools/plantuml-1.2026.8.jar -charset UTF-8 -tpng docs/diagrams/use-case-uc06.puml
```

Commit nguồn/bản xuất cùng PR, kiểm tra nhãn và quan hệ extend. Sơ đồ tổng thể gốc của nhóm được giữ nguyên.
