# Kế hoạch kiểm chứng FR/NFR BrewLite A2

Phiên bản 1.0 · 03/11/2026 · [A2-TV.1 / #41](https://github.com/akira-yami/BrewLite_A2/issues/41). Nguồn AC: [SRS FR](../requirements/srs.md), [SRS NFR](../requirements/non-functional-requirements.md). [Ma trận](../traceability-matrix.md) nối tới UC, diagram, issue và Code/API đích.

TC là kế hoạch kiểm chứng. [Ma trận truy vết](../traceability-matrix.md) dẫn đến các test A2 đã có. Trạng thái pass cần kết quả chạy gắn với revision và môi trường.

## Điều kiện chung

- DB PostgreSQL test riêng, không chạy concurrency/fault injection trên production hoặc DB dùng chung. Reset fixture giữa lượt, không reset khi đang đo. Ghi commit, version, seed, command, UTC và log đã che bí mật.
- Fixture tối thiểu: customer A/B, Barista; product/variant/topping active/inactive; BOM và ingredient có tồn đủ 0 hoặc 5 ly, có ingredient dùng chung giữa món/topping; coupon hợp lệ/hết hạn/hạn mức 1; mock Ví/Thẻ cho bộ test API và fixture callback/QueryDr cho VNPay. Không có dữ liệu thẻ thật.
- Unit cho hàm giá/normalization/state policy; HTTP test qua guard/validation thật; integration dùng PostgreSQL thật cho transaction/constraint/concurrency; browser E2E đi qua UI -> API -> DB, không stub API trong ca nghiệm thu end-to-end.
- Tra đường dẫn các ca đã hiện thực trong ma trận. Ghi rõ những phần được mô phỏng trong từng ca.

<a id="e2e-checkout"></a>
## E2E menu đến xác nhận đơn

[Ca checkout](../../tests/e2e/checkout-flow.spec.ts) mở menu trên Chromium ở kích thước màn hình 390 × 844, đăng nhập qua UI, chọn món và thanh toán. Playwright mô phỏng cổng VNPay và gửi callback có chữ ký thử nghiệm. Next.js và NestJS chạy local với PostgreSQL thật. Kết quả mong đợi là trang xác nhận hiển thị mã đơn khớp API và trạng thái `PAID`.

Sau khi cài dependencies cho hai app, đặt `DATABASE_URL` trỏ tới PostgreSQL local dành cho kiểm thử, với tên DB có hậu tố `_e2e`. Từ thư mục gốc, chạy:

```powershell
npm --prefix apps/api run prisma:deploy
Push-Location apps/api
npx tsx prisma/seed-e2e.ts
Pop-Location
Push-Location apps/web
npx playwright install chromium
Pop-Location
npm --prefix apps/web run test:e2e -- checkout-flow.spec.ts
```

Playwright tự khởi động Web và API trên các cổng 3100 và 3101. Báo cáo HTML nằm tại `apps/web/playwright-report/index.html`.

<a id="tc-fr-01"></a>
## TC-FR-01 - Menu (AT-FR-01.1/.2)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 01-A / .1 | GET products với product/variant active và inactive; mở menu | Chỉ dữ liệu bán được, thẻ tên/ảnh hoặc fallback/giá variant active; không đặt option inactive |
| 01-B / .2 | Component test response chậm, rỗng, 5xx/network; retry success | Loading/empty/error phân biệt; error có retry và sau thành công cập nhật menu |

<a id="tc-fr-02"></a>
## TC-FR-02 - Detail (AT-FR-02.1/.2)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 02-A / .1 | Chọn món; gọi API với ID active/inactive/không tồn tại/sai định dạng | Đúng tên/mô tả/ảnh/size/giá/topping; inactive/không có 404, ID sai 400; UI lỗi có quay về |
| 02-B / .2 | Không đủ nguyên liệu/thiếu BOM/ingredient inactive; thay tồn sau khi UI đã tải | Không thêm option hết tồn; backend kiểm tra lại catalog/tồn khi tạo đơn, không tin cache client |

<a id="tc-fr-03"></a>
## TC-FR-03 - Tùy chọn và giá (AT-FR-03.1/.2/.3)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 03-A / .1 | Một size, topping hợp lệ; đường/đá null và 0/25/50/75/100; API thử biên 0/100 | Null dùng chuẩn, 0 giữ nguyên; topping không lặp/sai sản phẩm; không đổi giá bởi đường/đá |
| 03-B / .2 | Note trắng/trim/500/501 ký tự; quantity 1/20/0/21/lẻ, thiếu size, topping trùng, >20 dòng, sugar/ice -1/101 | Note trống thành null, 500 hợp lệ, note áp dụng toàn quantity; mọi payload sai 400, DB không đổi |
| 03-C / .3 | Size 50.000 + topping 7.000, quantity 2; đổi note/đường/đá | 114.000 VND; UI tạm tính và backend unit pricing thống nhất |

<a id="tc-fr-04"></a>
## TC-FR-04 - Cart (AT-FR-04.1/.2/.3)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 04-A / .1 | Thêm/sửa/xóa, đổi thứ tự topping; khác variant/option/note; gộp >20 quantity | Gộp cùng dòng chuẩn hóa trong giới hạn; khác lựa chọn giữ riêng; tạm tính đúng; giỏ rỗng không checkout |
| 04-B / .2 | Reload, localStorage bị chặn/hỏng; checkout chưa login rồi login | Giữ lựa chọn/note khi dữ liệu hợp lệ, lỗi storage không crash; login xong quay checkout với giỏ |
| 04-C / .3 | Create/pay fail hoặc unknown; thêm món mới sau lúc checkout; sau đó xác nhận success | Fail/unknown giữ giỏ; success chỉ xóa phần thuộc đơn vừa trả tiền, giữ món thêm sau |

<a id="tc-fr-05"></a>
## TC-FR-05 - Auth/ownership (AT-FR-05.1/.2/.3/.4)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 05-A / .1 | Username hợp lệ và biên 3/50; sai bộ ký tự/2/51; password 6/100 và 5/101; duplicate; thêm role | Hợp lệ chỉ tạo CUSTOMER, không trả password/hash; sai input/role 400, trùng 409; không tự cấp BARISTA |
| 05-B / .2 | Login đúng/sai user/sai password; thiếu/sai/hết hạn JWT; customer gọi route quầy | Token có hạn; cùng thông báo 401 khi login sai; route protected 401, sai role 403 |
| 05-C / .3 | Reload/verify phiên, expiry, lỗi mạng tạm thời, logout | Phiên được kiểm tra hoặc login lại; giữ giỏ; network không bị diễn giải logout; logout xóa client session, không tuyên bố revoke JWT còn hạn |
| 05-D / .4 | B đọc/pay/cancel đơn A và replay key A; chụp DB trước/sau | Bị từ chối, không lộ nội dung/kết quả payment, DB không đổi; kiểm tra ownership trước replay |

<a id="tc-fr-06"></a>
## TC-FR-06 - Order/stock (AT-FR-06.1/.2/.3/.4)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 06-A / .1 | A tạo giỏ hợp lệ; thử áp userId/giá/total client | Mã đơn duy nhất, PENDING, expiry/reservation; chủ từ JWT, giá DB; field tự áp đặt không thay nghiệp vụ |
| 06-B / .2 | Sau mua đổi giá/tên catalog; lựa chọn null so với 0, note; có discount | Snapshot không đổi; subtotal - discount = total >=0, giữ tùy chọn/note đúng |
| 06-C / .3 | Nhiều dòng khác note cùng variant; thiếu stock; fault sau reserve/coupon trước commit | Cộng nhu cầu ingredient trên toàn giỏ gồm món/topping; snapshot lượng đã giữ theo reservation/ingredient; lỗi 409 khi hết hàng; rollback order/items/history/stock/reservation/coupon, không bản ghi dở dang |
| 06-D / .4 | BOM một ly X=10, tồn X=50, không nút thắt khác; 20 HTTP request đồng thời quantity=1, không restock | Đúng 5 order thành công, 15 từ chối nghiệp vụ, tồn X=0, tổng quantity ACTIVE reservation=5, snapshot X tổng=50, không âm; chạy NFR-04 ít nhất 3 lượt độc lập |

<a id="tc-fr-07"></a>
## TC-FR-07 - Payment (AT-FR-07.1/.2/.3/.4/.5)

Các ca mock bên dưới giữ tiêu chí baseline. Để kiểm chứng luồng hiện tại, chạy bộ [VNPay E2E](../../apps/web/tests/e2e/vnpay/README.md), gồm redirect, IPN, chữ ký, polling, gửi lặp và timeout. Quy tắc kết quả theo [UC-08](../requirements/uc-08-thanh-toan.md).

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 07-A / .1 | Pay E_WALLET/CARD; thiếu key/sai method; inject amount; đơn hết hạn/hủy | Amount từ order server; input sai 400; không pay reservation/đơn không hợp lệ, không charge |
| 07-B / .2 | Gateway success; fault DB khi finalize; kiểm tra ranh giới transaction | Success commit đồng thời SUCCEEDED/PAID/consume/history/một EARN/balance; gateway ngoài transaction dài; lỗi finalize không để side effect DB một phần, recovery theo 07-E |
| 07-C / .3 | Replay nối tiếp và 20 concurrent cùng key; đổi method/order cùng key; hai key cùng order | Một attempt/một charge mới; đang xử lý 409 PAYMENT_IN_PROGRESS; hoàn tất trả kết quả đã lưu; đổi payload 409 IDEMPOTENCY_KEY_REUSED; không success thứ hai kể cả key mới |
| 07-D / .4 | Decline xác định rồi retry key mới trước expiry; retry sau hủy/expiry | FAILED/PAYMENT_FAILED, không EARN, giữ reservation để retry; về PENDING trước attempt mới, không reserve lại; expired/cancelled bị từ chối |
| 07-E / .5 | Timeout, mất response, restart API, crash sau gateway success trước DB commit; lookup/replay cùng key | Khi chưa rõ trả tạm thời 503, UI báo đang kiểm tra; giữ PROCESSING để đối soát; không key mới/charge mới/hoàn tồn; recovery lookup bền vững và finalize đúng một lần, không giả FAILED |

<a id="tc-fr-08"></a>
## TC-FR-08 - Confirmation/history (AT-FR-08.1/.2/.3)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 08-A / .1 | Order vừa tạo nhưng chưa paid; pay success rồi refresh confirmation | Không suy success từ PENDING; hiển thị mã/kết quả/trạng thái server; refresh không create/pay mới |
| 08-B / .2 | A/B có đơn; list/detail/ID không có/ID của B; empty/error/retry | Chỉ đơn của mình, mới nhất trước, snapshot/tổng/timeline; 404 không tồn tại; đơn khác bị từ chối không lộ; UI empty/error phân biệt |
| 08-C / .3 | Barista cập nhật rồi khách reload; đổi catalog sau mua | Thấy tiến độ mới, giá/tên/option/note snapshot cũ không đổi; E2E menu tới history dùng API/DB thật |

<a id="tc-fr-09"></a>
## TC-FR-09 - State/cancel/expiry (AT-FR-09.1/.2/.3)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 09-A / .1 | Table-driven toàn bảng transition SRS; PENDING->READY, final->khác, lặp chính trạng thái | Chỉ cạnh hợp lệ; history trước/sau/UTC/actor; cạnh sai 409 ORDER_INVALID_TRANSITION, không đổi DB |
| 09-B / .2 | Customer thử progress, người khác cancel; cancel/expiry lặp; payment PROCESSING/unknown đua cancel/expiry | Chỉ BARISTA progress, chủ đơn cancel hợp lệ; unresolved payment không cancel/expire; release stock/coupon một lần khi đủ điều kiện |
| 09-C / .3 | PAID->CANCELLED đua PAID->PREPARING; kiểm tra payment/coupon/điểm | Chỉ một commit, request thua 409; không history/hoàn tồn kép. Nếu cancel thắng: hoàn tồn một lần, giữ payment success/coupon/điểm, không refund; luật cần PO review |

<a id="tc-fr-10"></a>
## TC-FR-10 - Coupon/loyalty (AT-FR-10.1/.2/.3)

| Ca | Thao tác / dữ liệu | Kết quả mong đợi |
|---|---|---|
| 10-A / .1 | Không coupon; một/hai mã, inactive, biên thời gian, min subtotal, sai phạm vi, hết hạn mức tổng/user | Tối đa một coupon tùy chọn; mã sai không giảm giá, cho sửa/bỏ trước đặt |
| 10-B / .2 | Quote rồi đổi quota; coupon limit=1 với hai create đồng thời; subtotal 114.000 giảm 10.000 hoặc vượt subtotal; hủy/expire/replay pay | Create kiểm tra/giữ lượt nguyên tử, không vượt quota; total 104.000 hoặc >=0; release đơn chưa paid/consume khi paid đúng một lần |
| 10-C / .3 | Success total=104.000, decline, payment replay/concurrent, cancel PAID | Theo tỷ lệ đề xuất floor(total/1000): 104 điểm, một EARN và balance cùng commit; fail không EARN, replay không cộng, cancel PAID giữ điểm. PO phải review tỷ lệ trước code |

<a id="tc-fr-11"></a>
## TC-FR-11 - Phân trang (AC FR-11, Should)

Nếu nhận vào release: fixture >=45 đơn của A và đơn B; mặc định 20, max 100, thứ tự ổn định ID/timestamp. Duyệt hai trang không trùng/mất trên dataset cố định, không lộ đơn B; tham số sai 400. Chưa có code/test; quyết định đưa vào release phải được ghi.

<a id="tc-fr-12"></a>
## TC-FR-12 - UI quầy (AC FR-12, Could)

Nếu triển khai: Barista xem đơn paid với option/note, progress đúng FR-09, loading/error; customer không vào được. Nếu hoãn, ghi backlog và vẫn chạy test API tiến độ Must ở TC-FR-09.

<a id="tc-fr-13"></a>
## TC-FR-13 - Refresh token (AC FR-13, Could)

Nếu triển khai: review HttpOnly/rotate/revoke và test HTTP token sai/hết hạn/reuse theo contract được chốt; không tự tạo contract mới trong matrix. Nếu hoãn, access token hết hạn phải login lại, giỏ còn nguyên theo TC-FR-05.

<a id="tc-fr-14"></a>
## TC-FR-14 - Realtime (AC FR-14, Could)

Nếu triển khai: chỉ chủ đơn nhận event, reconnect không mất trạng thái, reload vẫn đúng. Nếu hoãn, test reload TC-FR-08 vẫn Must; không coi thiếu WebSocket là thất bại của MVP.

<a id="tc-fr-15"></a>
## TC-FR-15 - Loại trừ tiền thật (AC FR-15, Won't)

Manual review code/config/demo: chỉ mock, không live key hoặc dữ liệu thẻ thật, không charge/refund tiền thật. Kết quả review lưu commit/config đã che bí mật và reviewer; hiện chưa thực hiện. Tích hợp thật phải thay scope/AC và ADR trước triển khai.

## NFR - kế hoạch đo theo nguồn chuẩn

Không thay ngưỡng SRS bằng con số của test plan. Các phép đo sau đều chưa chạy; evidence phải có đủ điều kiện ở SRS, không chỉ screenshot CI xanh.

<a id="tc-nfr-01"></a>
### TC-NFR-01 -> AT-NFR-01

Load riêng từng API với seed 100 products/300 variants/30 toppings/1.000 orders, warm-up 30s, 5 phút/20 client. Ghi p50/p95/p99/error/CPU/RAM; p95 <500ms, 5xx/timeout <1%. Không gộp gateway latency vào API thường hoặc dùng 4xx làm đẹp số. Payment đo riêng với độ trễ mock.

<a id="tc-nfr-02"></a>
### TC-NFR-02 -> AT-NFR-02

Theo TC-FR-05: DB chỉ hash bcrypt cost >=10, compare đúng; response/log không có password/hash/secret. Không đưa mật khẩu/hash/token thật vào evidence.

<a id="tc-nfr-03"></a>
### TC-NFR-03 -> AT-NFR-03

HTTP pipeline thật với bộ input sai SRS/TC-FR-03/05/06/07: 100% trả 400 và DB không đổi. Ca thiếu JWT thuộc NFR-10, không ép 400. UI cho sửa input; bypass UI vẫn bị backend chặn.

<a id="tc-nfr-04"></a>
### TC-NFR-04 -> AT-NFR-04

TC-FR-06-C/D và TC-FR-09: nguyên liệu đủ 5 ly/20 request ít nhất 3 lượt; fault sau reserve rollback; release/expiry/cancel race một lần. Lưu counts/status trước-sau; CHECK stock>=0 đơn lẻ không thay integration concurrency.

<a id="tc-nfr-05"></a>
### TC-NFR-05 -> AT-NFR-05

TC-FR-07-C/D/E, TC-FR-05-D và TC-FR-10-C: 20 same-key, replay/restart, khác payload/key cùng đơn, sai chủ, decline/timeout/fault finalize. Assert gateway call count, attempt, order, reservation, coupon, ledger/balance/history; tối đa một success/EARN, không side effect kép.

<a id="tc-nfr-06"></a>
### TC-NFR-06 -> AT-NFR-06

Reviewer clone sạch theo README; compose config/build/up, sau image build healthy <=180s, ghi cold build riêng; migrate/seed hai lần, health 200, menu/tạo/pay đơn thật; restart giữ volume và so đơn. Hiện Compose rỗng, chưa thể thực hiện.

<a id="tc-nfr-07"></a>
### TC-NFR-07 -> AT-NFR-07

Health DB sống 200, mất DB 503 có timeout; tạo 400/401/403/404/409/500/503, đối chiếu requestId response/log, kiểm tra redaction và không lộ stack/connection string. Dừng/bật DB chỉ ở môi trường test.

<a id="tc-nfr-08"></a>
### TC-NFR-08 -> AT-NFR-08

E2E thật success/chưa login/hết hàng/decline/unknown và UI states/reload trên Chrome/Edge/Firefox, 375x812 và 1440x900; ghi version/ngày/screenshot. Kiểm tra không tràn/che CTA, label/keyboard/focus modal, giữ lựa chọn/giỏ.

<a id="tc-nfr-09"></a>
### TC-NFR-09 -> AT-NFR-09

Sau startup: 30 phút/360 probe cách 5s, timeout 2s, ít nhất 99% 200 (tối đa 3 lỗi). Cửa sổ fault riêng: restart API và khôi phục DB, recovery <=60s tới chuỗi 3 probe 200; ID/snapshot đơn đã commit không mất. Lưu cả lỗi fault, không trộn với steady-state hoặc gọi là SLA 24/7.

<a id="tc-nfr-10"></a>
### TC-NFR-10 -> AT-NFR-10

HTTP JWT thiếu/sai chữ ký/hết hạn 401, sai role 403, cross-owner read/pay/cancel/replay không lộ/đổi dữ liệu. Review tracked history/image/CI log không secret; production HTTPS/certificate/no mixed content, API HTTPS và DB private theo hosting thật. Chưa có URL không được ghi production đạt.

<a id="tc-nfr-11"></a>
### TC-NFR-11 -> AT-NFR-11

Lưu PR/CI run pass và fail + cấu hình required checks/bypass của target branch. Release có quality gate/image SHA/digest/deploy/migrate/health/smoke/HTTPS/tag/notes/README; backup/restore DB test so đơn và rollback app tương thích schema <=10 phút không mất đơn. YAML đơn lẻ không chứng minh CI chặn merge hoặc CD đã chạy.

<a id="tc-nfr-12"></a>
### TC-NFR-12 -> AT-NFR-12

Trên HTTPS kiểm tra manifest/icon/start URL/scope/SW/cache; đã tải online rồi mở shell offline; menu/checkout/payment mất mạng giữ giỏ, có retry. Không cache auth/order/payment, không queue mutation/charge hoặc xác nhận giả; logout/đổi user không lộ cache; online lại tra cứu server. Ghi browser/version, không lấy khả năng cài PWA thay E2E.

## Khi bổ sung executable test

Giữ mã TC/AT trong tên case hoặc mô tả, link file/case thật từ matrix, rồi ghi command/result/run/evidence với commit và reviewer. Không đổi trạng thái thành Passed chỉ vì test file tồn tại. Nếu AC thay đổi, sửa SRS qua review trước và cập nhật matrix/test plan cùng PR; không hạ ngưỡng để hợp thức hóa kết quả.

Bổ sung ca BOM: hai variant và topping cùng dùng ingredient X, tổng nhu cầu cả giỏ vượt X dù từng lựa chọn đủ; thiếu BOM/inactive ingredient; đổi công thức sau reserve rồi release vẫn hoàn đúng InventoryReservationItem. OrderItem.unitPrice là giá variant và topping snapshot riêng, không cộng topping hai lần. UC-06 chỉ kiểm tra tạo PENDING; test payment nằm nhóm UC-08 độc lập.
