# UC-08: Thực hiện thanh toán

Phiên bản 1.0 · 06/11/2026 · [A2-1.3.2 / #6](https://github.com/akira-yami/BrewLite_A2/issues/6).

[Nguồn PlantUML use-case](../diagrams/use-case-uc08.puml) · [SVG](../diagrams/use-case-uc08.svg) · [PNG](../diagrams/use-case-uc08.png) · [Chỉnh sửa trực tuyến (draw.io)](https://app.diagrams.net/#G1iec3HEIGhhwMGesnvXXwvqJSkOI5Z0jw#%7B%22pageId%22%3A%22GQHZdUctXlZdyJI08YLY%22%7D)

![UC-08: Thực hiện thanh toán](../diagrams/use-case-uc08.png)

[Nguồn PlantUML sequence](../diagrams/sequence-payment.puml) · [SVG](../diagrams/sequence-payment.svg) · [PNG](../diagrams/sequence-payment.png) · [Xem sơ đồ trực tuyến (draw.io)](https://app.diagrams.net/#G1iec3HEIGhhwMGesnvXXwvqJSkOI5Z0jw#%7B%22pageId%22%3A%22wp84j0caUSDRGD1WpoII%22%7D)

## 1. Phạm vi và tác nhân

| Thuộc tính | Đặc tả |
|---|---|
| Tên chuẩn | UC-08: Thực hiện thanh toán, đúng sơ đồ tổng thể của nhóm |
| Mục tiêu | Chủ đơn thanh toán đơn hàng PENDING/PAYMENT_FAILED bằng Ví hoặc Thẻ mô phỏng một cách an toàn: không charge lặp, không ghi side-effect kép, kết quả chưa rõ được đối soát trước khi giải phóng tài nguyên |
| Actor chính | Khách hàng (CUSTOMER) — chủ đơn hàng; có JWT hợp lệ |
| Actor thứ cấp | Mock Payment Gateway — cộng tác tích hợp, nhận yêu cầu charge và trả success / decline / timeout; không có JWT role, không phải tài khoản nghiệp vụ |
| Trigger | Khách chọn Thanh toán sau khi đơn đang ở trạng thái PENDING hoặc PAYMENT_FAILED |
| Tiền điều kiện | Có phiên CUSTOMER hợp lệ (UC-02 là tiền điều kiện); đơn hàng tồn tại, thuộc chủ đơn này, còn ở PENDING/PAYMENT_FAILED và chưa hết hạn; không có attempt PROCESSING chưa đối soát trên cùng order; client gửi `Idempotency-Key` duy nhất trên header |
| Hậu điều kiện thành công | Payment `SUCCEEDED` + Order `PAID` + reservation `CONSUMED` + coupon `CONSUMED` (nếu có) + một bản ghi `EARN` và cập nhật `loyaltyBalance` — tất cả cùng commit nguyên tử; idempotency key được ghi nhận; phần giỏ đã checkout bị xóa sau xác nhận |
| Bảo đảm khi lỗi | Gateway decline xác định → Payment `FAILED`, Order `PAYMENT_FAILED`, không cộng điểm, tồn vẫn giữ để retry; timeout/lỗi chưa rõ → giữ Payment `PROCESSING`, không giải phóng tồn, UI báo đang kiểm tra; mọi lỗi DB trước commit → rollback, không ghi side-effect |
| Ngoài phạm vi UC-08 | Không tạo order hoặc reservation mới (đã có từ UC-06); không phát hành JWT; không có UI quầy Barista; không hoàn tiền thật; không retry payment trước khi chuyển về PENDING bằng key mới |

UC-06: Đặt hàng là tiền điều kiện tạo ra orderId được dùng trong UC-08. **UC-08 là use case độc lập, không include/extend với UC-06.** UC-07: Áp dụng coupon đã được consume tại bước finalize của UC-08 nếu coupon ở trạng thái RESERVED. UC-09: Xem xác nhận và lịch sử đơn hàng là bước tiếp theo của người dùng. Sơ đồ tổng thể [UC-01..10](use-case-overview.md) là nguồn tên/actor chuẩn.

## 2. Luồng chính — Gateway thành công

| Bước | Hành động | Kết quả |
|---|---|---|
| M1 | Khách chọn phương thức (E_WALLET / CARD) và nhấn Thanh toán | Client sinh `Idempotency-Key` mới, khóa nút chờ; amount hiển thị lấy từ đơn server |
| M2 | Web gửi `POST /api/v1/payments` + Bearer JWT + `Idempotency-Key` header, body `{orderId, method}` | Không gửi amount/userId; mọi trường tự áp đặt không thay kết quả |
| M3 | API kiểm tra JWT/CUSTOMER/DTO, chuẩn hóa orderId/method, tính request hash server-side từ `orderId + method` | 401/403/400 nếu sai, không ghi DB |
| M4 | **Kiểm tra ownership trước replay**: API xác minh `orderId` thuộc `principal.id`; nếu không từ chối 403 | Chặn replay của người khác trước khi kiểm tra idempotency |
| M5 | **Kiểm tra idempotency**: tra key trong DB; nếu key đã tồn tại và đã hoàn tất → trả kết quả đã lưu, dừng tại đây (replay path) | Không gọi gateway lần hai, không ghi thêm |
| M6 | **Transaction ngắn khóa order**: mở tx, khóa bản ghi order, kiểm tra trạng thái PENDING/PAYMENT_FAILED, không có attempt PROCESSING, INSERT Payment `PROCESSING` với key/hash | Unique constraint trên key ngăn race; nếu có attempt PROCESSING → 409 |
| M7 | **Gọi gateway ngoài transaction**: PaymentsService gọi `gateway.charge(key, amount, method)` — mock adapter | Gateway trả success / decline / timeout (hoặc lỗi mạng); mock lưu kết quả bền vững theo key |
| M8 | Gateway trả `success` | Tiếp tục M9 |
| M9 | **Transaction finalize**: khóa order và attempt, cập nhật Payment `SUCCEEDED`, Order `PAID`; consume InventoryReservation(s) → `CONSUMED`; consume CouponRedemption → `CONSUMED` (nếu có); INSERT LoyaltyTransaction `EARN` với `floor(total/1000)` điểm; UPDATE User.loyaltyBalance; INSERT OrderStatusHistory(PENDING/PAYMENT_FAILED → PAID); COMMIT | Partial unique `uq_one_successful_payment_per_order` và `uq_earn_per_order` là hàng rào cuối tại DB |
| M10 | API trả `201 Created` với snapshot kết quả payment/order | Web xóa phần giỏ đã checkout, chuyển sang màn xác nhận UC-09 |

## 3. Luồng thay thế

| Mã | Tại bước / tình huống | Xử lý |
|---|---|---|
| A1 | M5: key đã tồn tại, attempt đã `SUCCEEDED` hoặc `FAILED` | Trả lại kết quả đã lưu (status 200); không charge mới, không ghi thêm |
| A2 | M5: key đã tồn tại, attempt đang `PROCESSING` nhưng gateway chưa trả kết quả | 409 `PAYMENT_IN_PROGRESS`; client giữ giỏ, cho tra cứu lại cùng key |
| A3 | M7: Gateway trả `decline` xác định | Tiếp tục E3 |
| A4 | M3: đơn đang ở `PAYMENT_FAILED`, khách muốn retry | Khách phải tạo key mới; API chuyển đơn về `PENDING` trước khi tạo attempt mới; không reserve tồn lần hai vì reservation vẫn ACTIVE |
| A5 | M6: nhiều request cùng key đồng thời (20 concurrent) | Unique constraint trên `idempotency_key` → chỉ một INSERT thành công; các request còn lại nhận 409 |
| A6 | M3: `orderId` và key hợp lệ nhưng key đã dùng với orderId/method khác | 409 `IDEMPOTENCY_KEY_REUSED`; không charge |

## 4. Ngoại lệ

| Mã | Tình huống | Phản hồi / bảo đảm |
|---|---|---|
| E1 | JWT thiếu/sai/hết hạn hoặc role không phải CUSTOMER | 401/403; không ghi DB |
| E2 | DTO sai: thiếu key header, sai method, orderId không phải UUID, thiếu body | 400; không tạo attempt |
| E3 | Gateway từ chối xác định (decline) | Payment `FAILED`, Order `PAYMENT_FAILED`, INSERT history; không cộng điểm; trả `PAYMENT_FAILED` 200/201 |
| E4 | Đơn không thuộc principal (ownership fail) | 403; kiểm tra trước replay, không tiết lộ nội dung đơn; DB không đổi |
| E5 | Đơn không ở PENDING/PAYMENT_FAILED (sai trạng thái, đã PAID, CANCELLED, COMPLETED...) | 409 `ORDER_NOT_PAYABLE`; không tạo attempt |
| E6 | Đơn đã hết hạn reservation | 409 `ORDER_EXPIRED`; không tạo attempt; UI đưa về giỏ để đặt lại |
| E7 | Gateway timeout / lỗi mạng / kết quả chưa xác định | Giữ attempt `PROCESSING`, trả 503 tạm thời; client UI báo đang kiểm tra, không charge mới, không hoàn tồn; recovery tra cứu mock bằng key rồi finalize đúng một lần |
| E8 | DB lỗi trước commit tại bước finalize | Rollback Payment/Order/history; attempt có thể vẫn PROCESSING; tiếp theo theo E7 (đối soát); không ghi side-effect kép |
| E9 | Đơn đã `PAID` (có payment success), nhận attempt mới dù key khác | 409; partial unique `uq_one_successful_payment_per_order` là hàng rào DB; không charge thêm |
| E10 | Offline / mất kết nối ở client | Client giữ giỏ, không queue mutation; khi online tra cứu trạng thái order từ UC-09 trước khi retry |

## 5. Truy vết và nghiệm thu

| FR / AC | Luồng | Ca kiểm chứng |
|---|---|---|
| AT-FR-05.4 | M4, E4 | B không được pay/replay đơn A; ownership kiểm tra trước idempotency |
| AT-FR-07.1 | M2/M3, E1/E2 | Thiếu key/method sai → 400; inject amount → không thay đổi; đơn hết hạn/hủy → từ chối |
| AT-FR-07.2 | M7/M9 | Gateway success → tất cả side-effect cùng commit; gateway gọi ngoài tx dài; lỗi finalize → không side-effect kép |
| AT-FR-07.3 | A1/A2/A5/A6, M5/M6 | 20 same-key concurrent → 1 attempt, 1 charge; đã hoàn tất trả replay; PROCESSING → 409; khác payload → 409 REUSED |
| AT-FR-07.4 | A3/E3, A4 | Decline → FAILED/PAYMENT_FAILED; retry key mới chuyển về PENDING; không reserve lại |
| AT-FR-07.5 | E7/E8 | Timeout → 503 tạm thời; giữ PROCESSING; recovery qua lookup bền vững; không charge mới |
| AT-FR-10.3 | M9 | `floor(total/1000)` điểm; 1 EARN/order; không EARN khi FAILED; replay không cộng thêm |
| NFR-05 | M5/M6/M9/E7/E8 | Gateway call count, attempt/order/reservation/coupon/ledger; tối đa 1 SUCCEEDED và 1 EARN |

Fixture: customer A và B, order hợp lệ với reservation ACTIVE, mock gateway có bộ đếm call và lookup bền vững; coupon limit=1. Ca đồng thời: 20 request cùng key/payload → 1 attempt. Ca restart: crash sau gateway success trước DB commit → recovery lookup → finalize đúng một lần. Ca sai chủ: B dùng orderId A và key A → 403. Ca decline retry: FAILED → key mới → về PENDING → attempt mới, không reserve lại. Các phép thử là kế hoạch, chưa chạy trên A2.

Xem [SRS FR-07/10](srs.md), [NFR-05](non-functional-requirements.md), [ADR-004](../architecture/adr/004-payment-inventory-consistency.md), [kiến trúc §5.2](../architecture/system-architecture.md), [test plan TC-FR-07](../testing/test-plan.md#tc-fr-07). UC-06: Đặt hàng tại [#5/PR #50](uc-06-dat-hang.md); sequence UC-08 riêng tại [#9](https://github.com/akira-yami/BrewLite_A2/issues/9).

## 6. Kết xuất

Java + PlantUML 1.2026.8, từ root repository:

```powershell
java '-Djava.awt.headless=true' '-DPLANTUML_LIMIT_SIZE=16000' -jar C:/tools/plantuml-1.2026.8.jar -charset UTF-8 -tsvg docs/diagrams/use-case-uc08.puml
java '-Djava.awt.headless=true' '-DPLANTUML_LIMIT_SIZE=16000' -jar C:/tools/plantuml-1.2026.8.jar -charset UTF-8 -tpng docs/diagrams/use-case-uc08.puml
java '-Djava.awt.headless=true' '-DPLANTUML_LIMIT_SIZE=16000' -jar C:/tools/plantuml-1.2026.8.jar -charset UTF-8 -tsvg docs/diagrams/sequence-payment.puml
java '-Djava.awt.headless=true' '-DPLANTUML_LIMIT_SIZE=16000' -jar C:/tools/plantuml-1.2026.8.jar -charset UTF-8 -tpng docs/diagrams/sequence-payment.puml
```

Commit source và bản xuất cùng PR; kiểm tra nhãn, lifeline, nhánh alt/opt và quan hệ actor. Sơ đồ tổng thể gốc của nhóm được giữ nguyên.
