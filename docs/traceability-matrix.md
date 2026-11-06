# Ma trận truy vết BrewLite A2

Phiên bản 1.0 · 03/11/2026 · Phụ trách: Khang · [A2-TV.1 / #41](https://github.com/akira-yami/BrewLite_A2/issues/41).

## Baseline và cách đọc

- Đối chiếu `main` tại `d600b26`: có [FR-01..15 và AC](requirements/srs.md), [NFR-01..12](requirements/non-functional-requirements.md), [UC-01..10](requirements/use-case-overview.md), [nguồn UC tổng quát](diagrams/use-case-overview.drawio) và [PNG](diagrams/use-case-overview.png). `apps/web`, `apps/api`, `tests` chỉ có `.gitkeep`; chưa có code/API hoặc test tự động chạy được.
- Kiến trúc/ADR đang ở [PR #46 / issue #12](https://github.com/akira-yami/BrewLite_A2/pull/46); backlog/DoD ở [PR #47 / issue #17](https://github.com/akira-yami/BrewLite_A2/pull/47). Hai PR độc lập, chưa coi nội dung đó là đã merge. Issue implementation/test dưới đây được chọn theo backlog đề xuất, không thay phân công trên GitHub.
- **Đặc tả có**: có tài liệu đọc được. **Kế hoạch**: mới ánh xạ tới UC/issue/API đích và ca kiểm chứng; **chưa triển khai/chưa chạy** không có nghĩa pass. **Hoãn** cho Could/Should chưa đưa vào release; **ngoài MVP** cho Won't. Chỉ ghi **Đạt** khi có code/test thật, kết quả, review và nghiệm thu theo DoD.
- Tham khảo cách truy vết trong `docs/tham_khao/BrewLite/docs/traceability-matrix.md` và `testing/test-strategy.md` (A1, chỉ có ở máy làm việc). Không sao chép đường dẫn runtime, commit/PR hoặc kết quả A1 sang A2. Ma trận này dùng SRS A2 làm nguồn mã/AC và không phụ thuộc thư mục tham khảo khi clone.

## FR -> UC / story -> diagram -> Code/API -> test

Mọi đường dẫn code trong dấu backtick là **vị trí dự kiến**, chưa phải file tồn tại. API tương đối dưới `/api/v1`, chưa được triển khai hoặc đóng băng contract. Link test trỏ tới **ca kiểm chứng được đặc tả**, không phải executable test. Diagram hiện có là UC tổng quát; các sơ đồ chi tiết còn thiếu được dẫn tới issue chịu trách nhiệm để không tạo link tệp hỏng.

| FR / ưu tiên | UC / issue triển khai (story) | Diagram hiện có và phần cần bổ sung | Code/API đích - chưa có runtime | Test plan / AC bao phủ | Trạng thái / gap |
|---|---|---|---|---|---|
| FR-01 / Must | UC-03; [#21 catalog](https://github.com/akira-yami/BrewLite_A2/issues/21), [#22 menu](https://github.com/akira-yami/BrewLite_A2/issues/22) | [UC tổng quát](diagrams/use-case-overview.png), nguồn ở đầu tài liệu | `apps/api/src/modules/catalog`, `apps/web/src/features/catalog`; GET /products | [TC-FR-01](testing/test-plan.md#tc-fr-01): AT-FR-01.1/.2; [#23](https://github.com/akira-yami/BrewLite_A2/issues/23) | Đặc tả có; API/UI/test chưa có |
| FR-02 / Must | UC-04; [#21](https://github.com/akira-yami/BrewLite_A2/issues/21), [#25 detail](https://github.com/akira-yami/BrewLite_A2/issues/25) | [UC](diagrams/use-case-overview.png); class còn thiếu [#10](https://github.com/akira-yami/BrewLite_A2/issues/10) | `catalog` API/feature; GET /products/:id | [TC-FR-02](testing/test-plan.md#tc-fr-02): AT-FR-02.1/.2; #23/#34 | Chưa có detail API/UI/test |
| FR-03 / Must | UC-04; [#25](https://github.com/akira-yami/BrewLite_A2/issues/25), validate lại ở [#28](https://github.com/akira-yami/BrewLite_A2/issues/28) | [UC](diagrams/use-case-overview.png); class #10, activity [#7](https://github.com/akira-yami/BrewLite_A2/issues/7) chưa có | `catalog` UI, `orders` DTO/pricing; GET /products/:id, POST /orders | [TC-FR-03](testing/test-plan.md#tc-fr-03): AT-FR-03.1/.2/.3; #30/#34 | Chưa có option/pricing/validation test |
| FR-04 / Must | UC-05; [#26 cart/checkout](https://github.com/akira-yami/BrewLite_A2/issues/26) | [UC](diagrams/use-case-overview.png); activity #7 chưa có | `apps/web/src/features/cart`, `src/stores`; local cart -> POST /orders | [TC-FR-04](testing/test-plan.md#tc-fr-04): AT-FR-04.1/.2/.3; #34 | Chưa có cart/persist/browser test |
| FR-05 / Must | UC-01/02, bảo vệ UC-06..10; [#27 auth](https://github.com/akira-yami/BrewLite_A2/issues/27) | [UC](diagrams/use-case-overview.png); sequence JWT [#8](https://github.com/akira-yami/BrewLite_A2/issues/8) chưa có | `apps/api/src/modules/auth`, `src/common`, web `features/auth`; register/login/me, JWT/role/ownership | [TC-FR-05](testing/test-plan.md#tc-fr-05): AT-FR-05.1/.2/.3/.4; [#33](https://github.com/akira-yami/BrewLite_A2/issues/33) | Chưa có auth/guard/ownership runtime/test |
| FR-06 / Must | UC-06; [#28 orders](https://github.com/akira-yami/BrewLite_A2/issues/28), [#35 schema](https://github.com/akira-yami/BrewLite_A2/issues/35) | [UC](diagrams/use-case-overview.png); activity #7, sequence #8, class #10 chưa có | `apps/api/src/modules/orders`, `inventory`, `promotions`, `prisma`; POST /orders | [TC-FR-06](testing/test-plan.md#tc-fr-06): AT-FR-06.1/.2/.3/.4; [#30](https://github.com/akira-yami/BrewLite_A2/issues/30), [#32](https://github.com/akira-yami/BrewLite_A2/issues/32) | Chưa có create/reservation/rollback/concurrency |
| FR-07 / Must | UC-08; [đặc tả UC-08](requirements/uc-08-thanh-toan.md); [#6](https://github.com/akira-yami/BrewLite_A2/issues/6), [#9](https://github.com/akira-yami/BrewLite_A2/issues/9), [#29 payment](https://github.com/akira-yami/BrewLite_A2/issues/29) | [UC-08 diagram](diagrams/use-case-uc08.png); sequence UC-08 riêng: [sequence-payment.puml](diagrams/sequence-payment.puml) / [PNG](diagrams/sequence-payment.png); **sequence checkout thống nhất** (UC-06→08→09): [sequence-checkout.puml](diagrams/sequence-checkout.puml) / [SVG](diagrams/sequence-checkout.svg) / [PNG](diagrams/sequence-checkout.png) | `apps/api/src/modules/payments`, gateway port/mock; POST /payments + Idempotency-Key | [TC-FR-07](testing/test-plan.md#tc-fr-07): AT-FR-07.1/.2/.3/.4/.5; [#31](https://github.com/akira-yami/BrewLite_A2/issues/31) | **Đặc tả có**: UC-08 + use-case diagram + sequence checkout thống nhất (A2-2.2.2); code/test chưa có |
| FR-08 / Must | UC-09; [#28](https://github.com/akira-yami/BrewLite_A2/issues/28), [#26](https://github.com/akira-yami/BrewLite_A2/issues/26) | [UC](diagrams/use-case-overview.png); activity #7 và các sequence độc lập UC-06 (#8), UC-08 (#9) có phản hồi cuối riêng | `orders` API, web `features/orders/checkout`; GET /orders/me, GET /orders/:id | [TC-FR-08](testing/test-plan.md#tc-fr-08): AT-FR-08.1/.2/.3; #30/[#34](https://github.com/akira-yami/BrewLite_A2/issues/34) | Chưa có confirmation/history/ownership/E2E |
| FR-09 / Must | UC-10 Barista; nhánh hủy UC-06/08/09; [#28](https://github.com/akira-yami/BrewLite_A2/issues/28) | [UC](diagrams/use-case-overview.png); class #10/activity #7 cần giữ enum và nhánh | `orders`, `inventory`, expiry job; cancel/status API đích theo kiến trúc | [TC-FR-09](testing/test-plan.md#tc-fr-09): AT-FR-09.1/.2/.3; #30/#32 | Chưa có state machine/cancel/expiry/race |
| FR-10 / Must | UC-07/08; [đặc tả UC-08](requirements/uc-08-thanh-toan.md) (EARN và coupon consume); [#28 coupon/reserve](https://github.com/akira-yami/BrewLite_A2/issues/28), [#29 consume/earn](https://github.com/akira-yami/BrewLite_A2/issues/29) | [sequence UC-08](diagrams/sequence-payment.png) thể hiện coupon CONSUMED và EARN; class #10 chưa có | `promotions`, `loyalty`, `prisma`; coupon ở checkout, EARN hậu điều kiện pay | [TC-FR-10](testing/test-plan.md#tc-fr-10): AT-FR-10.1/.2/.3; #30/#31/#33 | **Đặc tả có**: EARN/coupon trong UC-08 sequence; code/test chưa có; PO review tỷ lệ điểm |
| FR-11 / Should | Mở rộng UC-09; [#28](https://github.com/akira-yami/BrewLite_A2/issues/28)/#26 nếu nhận vào Sprint | UC-09 ở [sơ đồ](diagrams/use-case-overview.png) chưa đặc tả phân trang | GET /orders/me pagination; route contract cần chốt | [TC-FR-11](testing/test-plan.md#tc-fr-11): AC FR-11 (SRS mục FR-11..15) | Kế hoạch bổ sung, chưa có code/test |
| FR-12 / Could | Mở rộng UC-10, UI quầy đầy đủ | UC-10 ở [sơ đồ](diagrams/use-case-overview.png); UI mở rộng chưa có | Web `features/barista` dự kiến; API trạng thái FR-09 vẫn Must | [TC-FR-12](testing/test-plan.md#tc-fr-12): AC FR-12 | Hoãn; chưa có issue implementation UI riêng |
| FR-13 / Could | Mở rộng UC-02, refresh token | UC-02 ở [sơ đồ](diagrams/use-case-overview.png); refresh không nằm trong sơ đồ MVP | Auth refresh/rotate/revoke, contract chưa chọn | [TC-FR-13](testing/test-plan.md#tc-fr-13): AC FR-13 | Hoãn; access JWT/đăng nhập lại vẫn Must |
| FR-14 / Could | Mở rộng UC-09, realtime | UC-09 ở [sơ đồ](diagrams/use-case-overview.png); realtime chưa có | SSE/WebSocket chưa chọn; không thay GET lấy trạng thái | [TC-FR-14](testing/test-plan.md#tc-fr-14): AC FR-14 | Hoãn; reload trạng thái FR-08 vẫn Must |
| FR-15 / Won't | Ngoài MVP; mock thuộc UC-08 | Không có sơ đồ payment thật | Không triển khai live gateway/refund, không lưu thẻ thật | [TC-FR-15](testing/test-plan.md#tc-fr-15): AC FR-15, review loại trừ | Ngoài MVP; vẫn kiểm tra demo/config chỉ mock |

FR-11..15 không có mã `AT-FR-xx.n` riêng trong SRS; dùng nguyên AC ở bảng bổ sung, không tự tạo mã AC giả. TC là mã ca kiểm chứng mới của tài liệu này, không đổi nghĩa FR/UC/AC.

## NFR -> thiết kế -> kiểm chứng

Tất cả NFR đang **chưa đo**. Mô tả phép đo, dataset và ngưỡng đầy đủ ở [SRS NFR](requirements/non-functional-requirements.md); các mã AT-NFR-01..12 ở đó được giữ nguyên. Kiến trúc đích ở PR #46 chưa phải evidence thực thi.

| NFR | FR / điểm thiết kế cần giữ | Ca kiểm chứng dự kiến | Issue phối hợp / gap |
|---|---|---|---|
| NFR-01 | FR-01/02/06/08; API/DB/index | [TC-NFR-01](testing/test-plan.md#tc-nfr-01) -> AT-NFR-01, p95/error theo từng endpoint | #23/#30/#40; chưa có load script/kết quả |
| NFR-02 | FR-05; bcrypt >=10, không lộ password/hash | [TC-NFR-02](testing/test-plan.md#tc-nfr-02) -> AT-NFR-02 | #27/#33; chưa có auth/test |
| NFR-03 | FR-03/05/06/07; DTO, giá/quyền server | [TC-NFR-03](testing/test-plan.md#tc-nfr-03) -> AT-NFR-03 | #30/#31/#33; chưa có HTTP pipeline/test |
| NFR-04 | FR-06/09/10; transaction/reservation/lock | [TC-NFR-04](testing/test-plan.md#tc-nfr-04) -> AT-NFR-04 | #30/#32; chưa có DB/concurrency/rollback |
| NFR-05 | FR-07/09/10; key/hash, unique, recovery | [TC-NFR-05](testing/test-plan.md#tc-nfr-05) -> AT-NFR-05 | #31/#33; chưa có gateway/DB/restart test |
| NFR-06 | FR-01..10; Compose/migrate/seed/persistent storage | [TC-NFR-06](testing/test-plan.md#tc-nfr-06) -> AT-NFR-06 | #35/#36; Compose hiện rỗng |
| NFR-07 | Mọi FR lõi; readiness/log/requestId/redaction | [TC-NFR-07](testing/test-plan.md#tc-nfr-07) -> AT-NFR-07 | #15/#36; chưa có health/log runtime |
| NFR-08 | FR-01..08; mobile/browser/keyboard/UI states | [TC-NFR-08](testing/test-plan.md#tc-nfr-08) -> AT-NFR-08 | #23/#34; chưa có browser E2E |
| NFR-09 | FR-06..09; recovery và persistent data | [TC-NFR-09](testing/test-plan.md#tc-nfr-09) -> AT-NFR-09 | #36/#38; chưa có probe/fault evidence |
| NFR-10 | FR-05..09; JWT/ownership/HTTPS/private DB/secrets | [TC-NFR-10](testing/test-plan.md#tc-nfr-10) -> AT-NFR-10 | #27/#33/#39; chưa có runtime/production URL |
| NFR-11 | CI gates, release/migration/rollback | [TC-NFR-11](testing/test-plan.md#tc-nfr-11) -> AT-NFR-11 | #24/#37–#40; chưa có CI/CD/required-check/release evidence |
| NFR-12 | FR-04/05/07/08; PWA shell, không offline mutation | [TC-NFR-12](testing/test-plan.md#tc-nfr-12) -> AT-NFR-12 | #14/#26/#34; chưa có manifest/SW/cache test |

## Quy tắc cập nhật và nghiệm thu

1. Khi issue thiết kế merge, thay tham chiếu issue bằng link **tệp nguồn và bản xuất thật**, kiểm tra enum với SRS. Hiện còn thiếu UC trọng tâm, activity, sequence, class và deployment (#5–#16); UC tổng quát không thay thế các sơ đồ này.
2. Khi có code/API, thay đường dẫn dự kiến bằng link tới file/route thật, ghi commit/PR. Không link đến path chưa tồn tại hoặc lấy source A1 làm implementation A2.
3. Khi viết test, nối TC/AT tới executable test và tên ca; khi chạy mới thêm run/artifact, command, môi trường/dataset, expected/actual, UTC, pass/fail và reviewer. Evidence có thể lưu `docs/testing/evidence/<commit>/<TC-ID>/` sau khi thực thi; hiện **chưa có** thư mục evidence hoặc kết quả.
4. Khi FR/AC/enum/contract đổi, cập nhật cả hàng matrix, test plan, sơ đồ và code/test liên quan cùng PR. Could/Should chỉ ghi hoãn khi release scope được review; Must không mất nghĩa vì còn thiếu code/issue.
5. Kiểm tra trước merge: đủ 15 FR và 12 NFR, AC của từng FR có ca dự kiến, link local/anchor tồn tại; phân biệt gap thiết kế/code/test/evidence. Đạt kiểm tra hồ sơ không đồng nghĩa đã kiểm thử sản phẩm.

| Trường evidence khi thực thi | Nội dung bắt buộc |
|---|---|
| Truy vết | FR/NFR, UC, AT/TC, issue và commit/PR |
| Thực thi | Test file/case, command hoặc bước manual, môi trường/phiên bản/dataset, thời điểm UTC |
| Kết quả | Expected, actual, pass/fail, link CI/log/screenshot đã che bí mật |
| Review | Reviewer, phản hồi và kết luận nghiệm thu; nếu thiếu ghi chưa ghi nhận |

Cập nhật nhất quán 04/11/2026: UC-06: Đặt hàng riêng PR #50, sequence UC-06 riêng PR #51; UC-08: Thực hiện thanh toán thuộc #6/#9. Class/BOM/kho Ingredient và schema A1 @7beb0cb ở PR #52, deployment Railway ở PR #53. FR-06/NFR-04 và TC liên quan dùng fixture nguyên liệu đủ 5 ly, không dùng cột stock của variant. Source A1 không là evidence runtime A2. Đặc tả UC-08: Thực hiện thanh toán hoàn chỉnh tại PR [#6](https://github.com/akira-yami/BrewLite_A2/issues/6), 06/11/2026; use-case diagram và sequence đã xuất SVG/PNG; FR-07/FR-10 cập nhật trạng thái "Đặc tả có".

Cập nhật 07/11/2026 (A2-2.2.2 / #9): Bổ sung sequence checkout thống nhất UC-06 → UC-08 → UC-09 tại [`docs/diagrams/sequence-checkout.puml`](diagrams/sequence-checkout.puml) ([SVG](diagrams/sequence-checkout.svg), [PNG](diagrams/sequence-checkout.png)). Sơ đồ bổ sung đầy đủ các nhánh còn thiếu so với sequence-payment riêng: payment success/fail, retry sau PAYMENT_FAILED bằng key mới (A4), idempotency 20-concurrent (A5), offline client (E10), đơn đã PAID nhận attempt mới (E9), recovery timeout (E7/E8) và phản hồi cuối màn xác nhận UC-09. Bảng màu đơn sắc #000000/#FFFFFF/#F8F9FA/#E9ECEF/#DEE2E6/#ADB5BD nhất quán toàn bộ sơ đồ.
