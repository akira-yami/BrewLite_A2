# Biên bản Sprint Review & Retrospective — Sprint 1

> **Dự án** BrewLite – Assignment 2: Requirements to Deployment  
> **Mục tiêu Sprint** Tạo nền kỹ thuật và demo MVP menu trên Web Next.js, API NestJS và PostgreSQL.   

Căn cứ đánh giá gồm [kế hoạch Sprint 1](sprint-01.md), [Product Backlog](product-backlog.md), [Definition of Done](definition-of-done.md) và lịch sử PR/CI của [akira-yami/BrewLite_A2](https://github.com/akira-yami/BrewLite_A2).

## 1. Checklist nghiệm thu Sprint 1

| Tiêu chí | Trạng thái đối chiếu | Bằng chứng |
| --- | --- | --- |
| Repository, backlog hai Sprint và Definition of Done | Đã merge | Issue #17 đóng lúc **21:50 ngày 03/11** sau khi PR #47 merge. [Issue #17](https://github.com/akira-yami/BrewLite_A2/issues/17) · [PR #47](https://github.com/akira-yami/BrewLite_A2/pull/47) |
| Catalog API và dữ liệu seed | Đã merge | PR #57 merge lúc **10:35 ngày 06/11**, cung cấp danh sách và chi tiết sản phẩm. Issue #21 đóng lúc **10:38**. [Issue #21](https://github.com/akira-yami/BrewLite_A2/issues/21) · [PR #57](https://github.com/akira-yami/BrewLite_A2/pull/57) |
| Menu mobile-first và kiểm thử API/UI | Đã merge | PR #59 merge lúc **11:35 ngày 06/11**. PR #62 bổ sung test API và menu lúc **11:41**. [Issue #22](https://github.com/akira-yami/BrewLite_A2/issues/22) · [Issue #23](https://github.com/akira-yami/BrewLite_A2/issues/23) · [PR #59](https://github.com/akira-yami/BrewLite_A2/pull/59) · [PR #62](https://github.com/akira-yami/BrewLite_A2/pull/62) |
| CI Install → Lint → Unit Test → Build | Có log đạt và log lỗi | Run `42158544330` lỗi tại bước validate khi runtime chưa đầy đủ. Run `42160719475` qua quality gate với **12 test API, 6 test Web** và 10 test của CI runner. Số liệu gắn với lần chạy này. [Run lỗi](https://github.com/akira-yami/BrewLite_A2/actions/runs/42158544330) · [Run đạt](https://github.com/akira-yami/BrewLite_A2/actions/runs/42160719475) · [Hồ sơ CI](../evidence/ci/A2-4.4.md) |
| Quản lý tài liệu Task 1–3 | Hoàn thiện sau mốc MVP menu | Issue #18 đóng lúc **21:41 ngày 09/11**. Activity diagram được bổ sung qua PR #97 lúc **23:13 ngày 10/11**. [Issue #18](https://github.com/akira-yami/BrewLite_A2/issues/18) · [PR #97](https://github.com/akira-yami/BrewLite_A2/pull/97) |
| Demo và phản hồi nghiệm thu | Chờ nhóm xác nhận | Hồ sơ CI ghi nhận menu local trả HTTP 200. Nhóm bổ sung bản ghi demo, nhận xét và kết luận của người nghiệm thu. [Hồ sơ CI](../evidence/ci/A2-4.4.md) |

## 2. Nội dung Review theo hạng mục

### 2.1. Khang (`akira-yami`) — Repository, backlog và CI

Đối chiếu cấu trúc `apps/web`, `apps/api`, `docs` và quy trình PR. Mở hai run CI để xem lần phát hiện lỗi và lần quality gate thành công. [PR #47](https://github.com/akira-yami/BrewLite_A2/pull/47) · [PR #63](https://github.com/akira-yami/BrewLite_A2/pull/63)

### 2.2. Hoàng (`Fatcatmmb-sudo`) — Catalog, seed và menu

Kịch bản demo là nạp dữ liệu seed, mở `/menu` ở viewport mobile, đối chiếu danh sách và chi tiết món với API rồi kiểm tra các trạng thái loading, rỗng, lỗi và thử lại. Ca kiểm thử menu nằm cùng ứng dụng Web. [Catalog PR #57](https://github.com/akira-yami/BrewLite_A2/pull/57) · [Menu PR #59](https://github.com/akira-yami/BrewLite_A2/pull/59) · [Test PR #62](https://github.com/akira-yami/BrewLite_A2/pull/62)

### 2.3. Hồ sơ thiết kế và truy vết

Đối chiếu tài liệu đã quản lý phiên bản với phạm vi demo menu. Ma trận truy vết và Activity diagram có PR riêng, trong đó Activity diagram được merge sau mốc MVP. [Ma trận truy vết](../traceability-matrix.md) · [PR #48](https://github.com/akira-yami/BrewLite_A2/pull/48) · [PR #97](https://github.com/akira-yami/BrewLite_A2/pull/97)

## 3. Sprint Retrospective

### 3.1. Điểm làm tốt

- Backlog và DoD có trước các PR catalog, menu và test, giúp truy từ tiêu chí nghiệm thu tới đầu ra. [Issue #17](https://github.com/akira-yami/BrewLite_A2/issues/17) · [DoD](definition-of-done.md)
- Lịch sử CI lưu được cả lỗi cấu hình runtime lẫn lần chạy thành công. [Hồ sơ CI](../evidence/ci/A2-4.4.md)

### 3.2. Khó khăn và tồn tại

- CI ban đầu lỗi do thiếu manifest và lockfile của ứng dụng. Khi đổi cấu trúc repo hoặc scripts, cần kiểm chứng pipeline từ checkout sạch. [Run `42158544330`](https://github.com/akira-yami/BrewLite_A2/actions/runs/42158544330)
- Một số tạo phẩm thiết kế được cập nhật sau ngày merge MVP menu. Cần giữ liên kết giữa bản demo và đúng revision tài liệu dùng để đối chiếu. [Issue #18](https://github.com/akira-yami/BrewLite_A2/issues/18) · [PR #97](https://github.com/akira-yami/BrewLite_A2/pull/97)

### 3.3. Hành động đề xuất cho Sprint 2

| Người phụ trách đề xuất | Hành động | Tiêu chí kiểm tra |
| --- | --- | --- |
| Khang (`akira-yami`) | Duy trì required check và cập nhật truy vết khi contract checkout đổi. | PR có link Issue, quality gate và cập nhật ma trận khi tác động FR/UC. |
| Hoàng (`Fatcatmmb-sudo`) | Chuẩn bị migration và seed có thể chạy lại từ DB trống. | Ghi lệnh và kết quả migrate/seed trên PostgreSQL riêng. [Issue #35](https://github.com/akira-yami/BrewLite_A2/issues/35) |
| Khải (`Khai-Doan`) và Kiệt (`htk2k6-hash`) | Tích hợp cart–checkout–payment theo contract và chạy browser E2E sau khi nối API. | Có báo cáo xác nhận mã đơn và test retry thanh toán gắn với commit. [Issue #34](https://github.com/akira-yami/BrewLite_A2/issues/34) · [Issue #31](https://github.com/akira-yami/BrewLite_A2/issues/31) |

## 4. Backlog và rủi ro chuyển tiếp

| Rủi ro | Đầu mối theo Issue | Việc đối chiếu trong Sprint 2 |
| --- | --- | --- |
| Hai đơn cạnh tranh cùng tồn nguyên liệu | Khang và Hoàng. [Orders #28](https://github.com/akira-yami/BrewLite_A2/issues/28) · [Inventory #32](https://github.com/akira-yami/BrewLite_A2/issues/32) | Kiểm tra số đơn được chấp nhận và tồn còn lại sau các request đồng thời. |
| Gửi lại thanh toán sau timeout | Kiệt. [Payment #31](https://github.com/akira-yami/BrewLite_A2/issues/31) | Đối chiếu idempotency key, trạng thái đơn và số giao dịch sau khi gửi lại. |
| Phiên hết hạn giữa lúc checkout | Huy và Khải. [Auth #27](https://github.com/akira-yami/BrewLite_A2/issues/27) · [Checkout #26](https://github.com/akira-yami/BrewLite_A2/issues/26) | Kiểm tra đăng nhập lại và tiếp tục giỏ hàng theo hành vi đã đặc tả. |

## 5. Kết luận Review

MVP menu, catalog, test cơ bản và CI có PR hoặc run để đối chiếu. Hồ sơ thiết kế có các mốc hoàn thiện sau MVP được ghi trong checklist. Quyết định nghiệm thu, phản hồi và xác nhận của nhóm đang chờ bổ sung. [Biên bản Sprint 2](sprint2-review-retro.md)
