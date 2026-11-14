# BrewLite - Bối cảnh, stakeholder và phạm vi

Phiên bản: 1.1 | Ngày: 04/11/2026 | Phụ trách: Khang | Truy vết: [A2-1.1 / Issue #1](https://github.com/akira-yami/BrewLite_A2/issues/1).

## 1. Vấn đề nghiệp vụ và mục tiêu

Tại quầy đồ uống, việc ghi nhận món, size, topping và ghi chú bằng trao đổi thủ công có thể làm sai đơn; khách khó biết số tiền cuối cùng và tiến độ pha chế. Khi nhiều khách đặt cùng lúc, hệ thống cần tránh bán vượt tồn. Mạng chậm hoặc thao tác thanh toán lặp có thể tạo giao dịch, điểm thưởng hoặc lượt dùng coupon trùng.

BrewLite cung cấp luồng: **xem menu -> chọn tùy chọn -> giỏ hàng -> xác thực -> đặt đơn -> thanh toán VNPay Sandbox -> xác nhận và theo dõi đơn**. Backend quyết định giá, chủ đơn, tồn kho và trạng thái. Nhân viên quầy cập nhật tiến độ qua chức năng được phân quyền.

Mục tiêu nghiệm thu là hoàn thành một đơn end-to-end với số tiền/tùy chọn đúng, không thu lặp khi gửi lại thanh toán, không lộ đơn của người khác; nhóm có thể tái tạo môi trường local và bàn giao bản production truy cập được. Tiêu chí chi tiết thuộc SRS, không suy ra rằng các mục tiêu đã đạt chỉ vì có tài liệu.

## 2. Stakeholder và kỳ vọng

| Mã | Stakeholder | Mục tiêu và kỳ vọng | Cách xác nhận |
|---|---|---|---|
| ST-01 | Khách hàng | Chọn đúng món/tùy chọn; biết tổng tiền; đặt, thanh toán và theo dõi đơn của mình; có thông báo lỗi và cách thử lại | Demo trên mobile, chạy AC menu/cart/checkout/history và ca thanh toán thất bại |
| ST-02 | Nhân viên quầy / Barista | Nhận đúng nội dung đơn đã thanh toán; cập nhật tiến độ theo thứ tự; không bị chuyển trạng thái trái quyền | Review state machine và kiểm thử API bằng role `BARISTA` |
| ST-03 | Quản lý cửa hàng / đại diện PO | Không bán quá tồn; tiền, coupon và điểm nhất quán; phạm vi MVP rõ ràng | Review quy tắc nghiệp vụ, test đồng thời và Sprint Review; chưa có màn quản trị riêng |
| ST-04 | Giảng viên / khách hàng nghiệm thu | Truy được yêu cầu tới thiết kế, code, test; có lịch sử PR, demo và URL production hoạt động | Đối chiếu rubric, ma trận truy vết, CI/CD, release và demo |
| ST-05 | Nhóm phát triển | Contract thống nhất, trách nhiệm rõ, tích hợp được qua PR và tái tạo môi trường | Review chéo tài liệu, CI, hướng dẫn local/test/deploy/rollback |
| ST-06 | Đơn vị thanh toán (VNPay) | Nhận đúng amount từ server; phân biệt thành công, từ chối và kết quả chưa xác định; xử lý request lặp an toàn | Test redirect, callback và xử lý kết quả chưa xác định |

Các kỳ vọng trên được phân tích từ đề và tài liệu tham khảo; cần xác nhận qua review/demo. Stakeholder không mặc nhiên là actor hay role: quản lý/giảng viên/nhóm phát triển không có tài khoản nghiệp vụ trong MVP; gateway là actor tích hợp, không phải role.

## 3. Phạm vi sản phẩm

### 3.1. Trong MVP (in-scope)

MVP cuối Assignment 2 bao gồm cả hai Sprint. MVP Sprint 1 là phần chạy được để xem menu, không phải toàn bộ sản phẩm cuối kỳ.

| Mã | Phạm vi | Mốc và căn cứ |
|---|---|---|
| IN-01 | API menu/detail và màn hình menu mobile-first, dữ liệu seed, loading/empty/error | Sprint 1; A2 mục 6.3 |
| IN-02 | Chi tiết, một size và nhiều topping hợp lệ; đường/đá và ghi chú theo baseline tham khảo | Sprint 2; A2 mục 7.1, kế thừa A1 |
| IN-03 | Giỏ client: thêm/sửa/xóa, tạm tính, lưu local và giữ lựa chọn khi reload | Sprint 2; FR-04 |
| IN-04 | Đăng ký khách hàng, đăng nhập JWT; kiểm soát role và chủ sở hữu | Sprint 2; FR-05 |
| IN-05 | Tạo đơn `PENDING`; server tính giá, snapshot, giữ nguyên liệu theo công thức món/topping nguyên tử và rollback khi lỗi | Sprint 2; FR-06, baseline A1 |
| IN-06 | VNPay Sandbox trên Web và Ví/Thẻ giả lập trong test API; lưu payment attempt, idempotency, lỗi/retry và kết quả chưa xác định | Sprint 2; FR-07 |
| IN-07 | Xác nhận, chi tiết và lịch sử của chính khách hàng; trạng thái đơn và cập nhật tiến độ qua API nhân viên | Sprint 2; FR-08/09; UI quầy đầy đủ là mở rộng |
| IN-08 | State machine, chống oversell, coupon và cộng loyalty một lần sau thanh toán thành công | Kế thừa yêu cầu A1; FR-09/10, không bỏ chỉ vì A2 không liệt kê lại từng quy tắc |
| IN-09 | Migration/seed, Docker Compose web/API/DB local, health/log, test unit/integration/E2E | A2 mục 7.2 |
| IN-10 | CI chặn merge khi lint/test/build lỗi; CD, image phiên bản, production HTTPS, DB riêng, smoke/rollback và hướng dẫn bàn giao | A2 mục 6.4, 7.3-7.4 |

### 3.2. Mở rộng và ngoài phạm vi (out-of-scope)

| Mã | Nội dung | Quyết định và lý do |
|---|---|---|
| OUT-01 | UI quầy hoàn chỉnh, dashboard quản trị menu/kho/báo cáo | Could, sau MVP; backend chuyển trạng thái và RBAC vẫn bắt buộc |
| OUT-02 | Refresh token, realtime WebSocket/push | Could; MVP dùng access token và tải lại trạng thái; phải xử lý hết hạn phiên |
| OUT-03 | Thu tiền thật, hoàn tiền/đối soát ngân hàng, Momo/VNPay/Stripe production | Won't trong MVP. Luồng tích hợp được kiểm chứng với VNPay Sandbox hoặc mock test. |
| OUT-04 | Giao hàng, nhiều chi nhánh, đa tiền tệ, thuế/hóa đơn điện tử | Won't trong MVP; tập trung nhận món tại một quầy |
| OUT-05 | Mua hàng, nhà cung cấp và UI quản trị kho đầy đủ | Won’t trong MVP; kho Ingredient và công thức món/topping đã thuộc lõi đặt hàng |
| OUT-06 | Đặt đơn/thanh toán khi offline | Won't trong MVP; hướng PWA không được tạo xác nhận thanh toán giả khi mất mạng |

Production HTTPS và CI/CD **thuộc phạm vi bắt buộc A2**, dù một số tài liệu A1 chỉ ghi là đề xuất. Production A2 chạy trên Railway. Xem [snapshot và URL](../deployment.md).

## 4. Giả định

| Mã | Giả định baseline | Tác động khi thay đổi |
|---|---|---|
| AS-01 | Một cửa hàng, nhận tại quầy, tiền nguyên `VND` | Đổi mô hình cửa hàng, phân quyền và tính tiền |
| AS-02 | Catalog/Barista được cấp bằng seed; đăng ký công khai chỉ tạo `CUSTOMER` | Cần bổ sung use case quản trị/cấp quyền nếu mở đăng ký nhân viên |
| AS-03 | Giỏ lưu local trên thiết bị; đăng nhập trước tạo đơn | Đồng bộ đa thiết bị cần API và chính sách hòa giải giỏ |
| AS-04 | Tồn tại Ingredient.stockQuantity/version; RecipeItem/ToppingRecipeItem quy đổi món/topping sang nguyên liệu; reservation item lưu lượng đã giữ; một coupon/đơn | Đồng bộ schema A1 @7beb0cb; không có stock/version trên ProductVariant |
| AS-05 | Mỗi payment là một lần thử; tối đa một `SUCCEEDED` và một loyalty `EARN` mỗi đơn | Thay đổi chính sách payment/loyalty và kiểm thử idempotency |
| AS-06 | Reservation có hạn; thất bại xác định còn cho retry đến hạn; kết quả chưa xác định phải đối soát trước khi giải phóng tồn | Cần chốt timeout/TTL bằng cấu hình và thiết kế Task 2-3 |
| AS-07 | Kế thừa luật hủy `PAID` trước khi nhận pha: hoàn tồn đúng một lần, giữ payment/coupon/điểm đã ghi, không hoàn tiền mock | Đây là lựa chọn của baseline A1 cần PO review; thay đổi phải cập nhật SRS/state machine/test trước code |

## 5. Ràng buộc

| Mã | Ràng buộc | Căn cứ / cách kiểm chứng |
|---|---|---|
| CO-01 | Next.js theo hướng mobile-first/PWA, NestJS, PostgreSQL; công nghệ bổ sung không thay ba thành phần này | A2 mục 1.1; review kiến trúc và dependency |
| CO-02 | Thực hiện Task 1 -> 2 -> 3 -> 4 -> 5; tạo phẩm trước phải có lịch sử trên repo trước nghiệm thu task sau | A2 mục 1, 8; kiểm tra PR/commit và truy vết |
| CO-03 | Mỗi yêu cầu có ID, MoSCoW, AC kiểm chứng được; sơ đồ lưu nguồn và bản xuất | A2 mục 3-4; review SRS/diagram |
| CO-04 | Tạo đơn/thanh toán xác thực server; không tin giá, amount hoặc userId từ client | Baseline nghiệp vụ; integration test và ca giả mạo payload |
| CO-05 | Production web HTTPS, API/health truy cập được, DB không public trực tiếp, secret ngoài Git/log | A2 mục 7.4; kiểm tra deployment và secret scan |
| CO-06 | Có migration/seed, Compose local, CI/CD, test và hướng dẫn clone/run/test/build/deploy/rollback | A2 mục 6-7; tái tạo từ checkout sạch |

## 6. Rủi ro ban đầu

| Mã | Rủi ro / tác động | Khả năng / mức độ | Giảm thiểu và cách phát hiện | Phụ trách theo vai trò |
|---|---|---|---|---|
| RK-01 | API/UI/sơ đồ lệch contract, tích hợp muộn | Cao / Cao | Chốt ID/enum, review chéo, ghi thay đổi qua PR và cập nhật truy vết | Cả nhóm, người review contract |
| RK-02 | Đặt đồng thời bán vượt tồn; rollback thiếu dữ liệu | Trung bình / Cao | Transaction, cập nhật nguyên tử, test nhiều request trên PostgreSQL thật | Phụ trách Orders/Inventory |
| RK-03 | Request lặp/timeout làm charge, cộng điểm hoặc dùng coupon hai lần | Cao / Cao | Key + request hash bền vững, kiểm tra ownership trước replay, test retry/race và phục hồi | Phụ trách Payments |
| RK-04 | Lộ secret, mật khẩu hoặc đơn của người khác | Trung bình / Cao | Hash/JWT/RBAC/ownership, HTTPS, secret scan và test truy cập chéo | Phụ trách Auth, người review |
| RK-05 | Dịch vụ production ngủ/hết quota; deploy sai cấu hình hoặc migration gây mất dữ liệu | Trung bình / Cao | Chọn hosting sớm tại Task 3, health/smoke, backup/restore và rollback có diễn tập | Phụ trách Delivery |
| RK-06 | Tài liệu cũ được hiểu nhầm là minh chứng code/test A2 đã chạy | Cao / Cao | Ghi nguồn/ngày/commit, tách yêu cầu khỏi kết quả đo; chỉ đánh dấu đạt khi có evidence | Phụ trách tài liệu, reviewer |

## 7. Điều kiện chốt phạm vi

Review xác nhận đủ sáu nhóm stakeholder; phân biệt MVP cuối kỳ với Sprint 1; FR/NFR/use case dùng cùng actor, enum và luật nghiệp vụ. Các giả định AS-01..07 được coi là baseline đề xuất, chưa phải kết quả stakeholder phê duyệt. Thay đổi phạm vi phải nêu lý do, FR/NFR/UC bị ảnh hưởng và cách kiểm chứng trong PR; cập nhật tài liệu trước nghiệm thu task kế tiếp.

Tài liệu liên quan theo issue: [SRS chức năng #2](https://github.com/akira-yami/BrewLite_A2/issues/2), [NFR #3](https://github.com/akira-yami/BrewLite_A2/issues/3), [use case tổng quát #4](https://github.com/akira-yami/BrewLite_A2/issues/4). Bốn issue này không thay thế đặc tả use case trọng tâm của A2 mục 3.3 hoặc các tạo phẩm Task 2-5.

Cập nhật 04/11/2026 theo yêu cầu đồng bộ A1: UC-06: Tạo đơn và UC-08: Thực hiện thanh toán tách biệt; công thức/kho nguyên liệu thuộc phạm vi lõi. Xem [ADR-006](../architecture/adr/006-a1-recipe-inventory.md).
