# Biên bản Sprint Review & Retrospective — Sprint 2

> **Dự án** BrewLite – Assignment 2: Requirements to Deployment  
> **Mục tiêu Sprint** Hoàn thành checkout từ menu đến xác nhận đơn, kiểm thử tích hợp và bàn giao bản phát hành.  
> **Mốc đối chiếu** Checkout VNPay merge ngày **10/11/2026**, tag `v1.0.0` ghi lúc **22:26:04 ngày 12/11/2026**, giờ Việt Nam (UTC+7).  
> **Lịch họp** **22:00 ngày 12/11/2026** (UTC+7).  

Căn cứ đánh giá gồm [kế hoạch Sprint 2](sprint-02.md), [Definition of Done](definition-of-done.md), [kế hoạch kiểm thử](../testing/test-plan.md) và lịch sử PR/CI/CD của [akira-yami/BrewLite_A2](https://github.com/akira-yami/BrewLite_A2).

## 1. Checklist nghiệm thu Sprint 2

| Tiêu chí | Trạng thái đối chiếu | Bằng chứng |
| --- | --- | --- |
| Auth, Orders, cart và checkout | Đã merge | Auth #27 và mock payment #29 đóng ngày **08/11**. Orders #28 đóng ngày **09/11**. PR #89 và #90 tích hợp payment và UI checkout lúc **03:31** và **03:35 ngày 10/11**. [Auth #27](https://github.com/akira-yami/BrewLite_A2/issues/27) · [Orders #28](https://github.com/akira-yami/BrewLite_A2/issues/28) · [Payment PR #89](https://github.com/akira-yami/BrewLite_A2/pull/89) · [Checkout PR #90](https://github.com/akira-yami/BrewLite_A2/pull/90) |
| Browser E2E menu đến xác nhận | Đã kiểm chứng local | Issue #34 đóng lúc **11:35 ngày 06/11**. Lượt chạy bổ sung ngày **12/11** qua **3/3 ca checkout**, gồm ca mới từ menu đến xác nhận và hai ca hiện có. Browser dùng API NestJS và PostgreSQL riêng, với callback VNPay mô phỏng. [Issue #34](https://github.com/akira-yami/BrewLite_A2/issues/34) · [Ca mới](../../apps/web/tests/e2e/delivery/checkout-flow.spec.ts) · [Cách tái chạy](../testing/test-plan.md#e2e-checkout) |
| Migration, seed và Compose local | Đạt trên CI | Checkout sạch healthy sau 23 giây kể từ khi image sẵn sàng. Chạy lại 21 migration và seed thành công. Đơn thử vẫn PAID sau khi dựng lại stack với cùng volume. [CI và artifact Compose](https://github.com/akira-yami/BrewLite_A2/actions/runs/43571751138) |
| PWA manifest | Đã kiểm chứng trên bản build local | `/menu` có liên kết đến `/manifest.json`, manifest mở `/menu` ở chế độ `standalone` và hai icon 192×192, 512×512 trả HTTP 200. Kiểm chứng offline shell của NFR-12 còn chờ. [Manifest](../../apps/web/src/app/manifest.json) · [NFR-12](../requirements/non-functional-requirements.md) |
| Tag, release notes và hướng dẫn rollback | Có trên GitHub | [Release v1.0.2](https://github.com/akira-yami/BrewLite_A2/releases/tag/v1.0.2) trỏ tới commit 53b9321, có link CI/CD và ZIP minh chứng. [Hướng dẫn rollback](../evidence/cd/rollback-guide.md) |
| Production HTTPS và CD của revision phát hành | Đạt | Railway CD #11 triển khai Web/API cho commit 53b9321 thành công. Pre-deploy không còn migration chờ áp dụng. Smoke API, Web health và menu đều đạt. [Run CD](https://github.com/akira-yami/BrewLite_A2/actions/runs/43572616665) · [Ảnh và log](https://github.com/akira-yami/BrewLite_A2/pull/103) |

## 2. Nội dung Review theo hạng mục

| Phụ trách theo GitHub | Đầu ra đối chiếu | Dẫn chứng |
| --- | --- | --- |
| Khang (`akira-yami`) | API tạo đơn, trạng thái và lịch sử. Thiết lập Railway cho Web/API và cấu hình CD. | [Orders PR #76](https://github.com/akira-yami/BrewLite_A2/pull/76) · [Railway PR #91](https://github.com/akira-yami/BrewLite_A2/pull/91) |
| Hoàng (`Fatcatmmb-sudo`) | Tùy chọn món, kiểm thử tồn kho và Docker Compose local. | [Tùy chọn PR #65](https://github.com/akira-yami/BrewLite_A2/pull/65) · [Tồn kho PR #67](https://github.com/akira-yami/BrewLite_A2/pull/67) · [Compose PR #75](https://github.com/akira-yami/BrewLite_A2/pull/75) |
| Huy (`Tang18xJan`) | Xác thực JWT, phân quyền và tích/đổi điểm loyalty. | [Auth PR #74](https://github.com/akira-yami/BrewLite_A2/pull/74) · [Loyalty PR #86](https://github.com/akira-yami/BrewLite_A2/pull/86) · [Đổi điểm PR #93](https://github.com/akira-yami/BrewLite_A2/pull/93) |
| Khải (`Khai-Doan`) | Giao diện giỏ, checkout, lịch sử và browser E2E. | [Checkout PR #90](https://github.com/akira-yami/BrewLite_A2/pull/90) · [E2E #34](https://github.com/akira-yami/BrewLite_A2/issues/34) |
| Kiệt (`htk2k6-hash`) | Mock payment, idempotency VNPay, kiểm thử Payment và hồ sơ bàn giao. | [Mock PR #69](https://github.com/akira-yami/BrewLite_A2/pull/69) · [Test PR #71](https://github.com/akira-yami/BrewLite_A2/pull/71) · [VNPay PR #89](https://github.com/akira-yami/BrewLite_A2/pull/89) · [Bàn giao PR #73](https://github.com/akira-yami/BrewLite_A2/pull/73) |

**Kịch bản demo.** Từ `/menu`, đăng nhập, chọn món, thêm vào giỏ và mở checkout. Mô phỏng thanh toán thành công, kiểm tra màn hình xác nhận có mã đơn khớp API và trạng thái `PAID`, sau đó mở lịch sử. Ca mới tự động hóa luồng đến trang xác nhận. Bước xem lịch sử có thể đối chiếu với [test Orders session](../../apps/web/tests/e2e/orders-session.spec.ts).

## 3. Sprint Retrospective

### 3.1. Điểm làm tốt

- Các PR checkout và payment có thể truy về Issue tương ứng. Luồng browser kiểm tra được cả mã đơn và trạng thái cuối từ API. [Issue #83](https://github.com/akira-yami/BrewLite_A2/issues/83) · [Issue #84](https://github.com/akira-yami/BrewLite_A2/issues/84) · [Ca E2E](../../apps/web/tests/e2e/delivery/checkout-flow.spec.ts)
- Hồ sơ bàn giao có tag, release notes, URL health và runbook rollback để đối chiếu khi triển khai. [Release notes v1.0.2](https://github.com/akira-yami/BrewLite_A2/releases/tag/v1.0.2) · [Hồ sơ Railway](../evidence/cd/railway-a2-setup.md)

### 3.2. Khó khăn và tồn tại

- Issue browser E2E đóng trước khi PR checkout VNPay merge. Báo cáo regression cần gắn đúng revision đã tích hợp để nhóm đọc được kết quả của luồng hiện hành. [Issue #34](https://github.com/akira-yami/BrewLite_A2/issues/34) · [PR #89](https://github.com/akira-yami/BrewLite_A2/pull/89) · [PR #90](https://github.com/akira-yami/BrewLite_A2/pull/90)
- Lần CD của bản v1.0.0 gặp lỗi deploy. Đợt bàn giao v1.0.2 đã có run CD thành công và lưu deployment ID, migration log cùng smoke test theo SHA. [Run CD #11](https://github.com/akira-yami/BrewLite_A2/actions/runs/43572616665)

### 3.3. Hành động đề xuất trước bàn giao

| Người phụ trách đề xuất | Hành động | Tiêu chí kiểm tra |
| --- | --- | --- |
| Khang (`akira-yami`) | Đã xác minh CD của bản bàn giao. | SHA 53b9321, deployment ID và smoke trong [hồ sơ CD](https://github.com/akira-yami/BrewLite_A2/pull/103). |
| Khải (`Khai-Doan`) và Kiệt (`htk2k6-hash`) | Chạy regression checkout sau khi chốt revision bàn giao. | Có báo cáo E2E kèm commit, môi trường, kết quả xác nhận đơn và retry. [Issue #34](https://github.com/akira-yami/BrewLite_A2/issues/34) · [Issue #40](https://github.com/akira-yami/BrewLite_A2/issues/40) |
| Khải (`Khai-Doan`) | Kiểm tra cài đặt PWA và hành vi khi ngắt mạng ở menu/checkout. | Ghi trình duyệt, kết quả giữ giỏ và tra cứu trạng thái khi kết nối lại. [NFR-12](../requirements/non-functional-requirements.md) |

## 4. Tình trạng bàn giao

Ngày **12/11/2026**, danh sách GitHub của nhóm ghi nhận **0 Issue mở**. Manifest và ca browser E2E bổ sung đã được kiểm tra trên workspace sau mốc tag. Bằng chứng chạy của revision phát hành được đối chiếu qua các run CI/CD ở checklist. [GitHub Issues](https://github.com/akira-yami/BrewLite_A2/issues?q=is%3Aissue+is%3Aopen)

| Việc còn cần xác nhận | Bằng chứng để chốt |
| --- | --- |
| Demo Sprint 2 | Ngày giờ, người thực hiện, URL hoặc bản ghi demo, phản hồi và kết luận nghiệm thu. |
| Gói nộp | Link tag, release notes, README, hướng dẫn rollback, báo cáo kiểm thử và hai biên bản. |

## 5. Kết luận Review

Luồng checkout từ menu đến xác nhận đã qua E2E. [Release v1.0.2](https://github.com/akira-yami/BrewLite_A2/releases/tag/v1.0.2) gắn với commit 53b9321 đã qua Railway CD và smoke. Nội dung demo và quyết định nghiệm thu Sprint 2 còn chờ nhóm xác nhận. [Biên bản Sprint 1](sprint1-review-retro.md)
