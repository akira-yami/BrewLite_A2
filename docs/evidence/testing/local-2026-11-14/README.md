# Minh chứng kiểm thử local — 14/11/2026

Các ảnh do nhóm cung cấp ghi nhận kết quả chạy local. Ảnh không hiển thị commit SHA, nên bảng ghi nhận theo lượt chạy trong ảnh.

| Bộ test | Lệnh | Kết quả | Ảnh |
|---|---|---|---|
| API · Vitest mặc định | `npm --prefix apps/api test` | 525/525 pass trên 50 file | [Tổng kết API](api-unit.png) |
| Web · Unit/component | `npm --prefix apps/web test` | 103/103 pass, 0 fail, 0 skip | [Tổng kết Web](web-unit.png) |
| API E2E | `npm --prefix apps/api run test:e2e` | 32/32 pass trên 4 file, gồm 2 ca checkout | [Tổng kết API E2E](api-e2e.png) |
| Browser E2E · Playwright | `npm --prefix apps/web run test:e2e` | 19/19 pass, 0 fail, 0 flaky, 0 skip | [Ảnh báo cáo Playwright](browser-e2e.png) |

Cách chạy và chuẩn bị DB test được mô tả trong [kế hoạch kiểm thử](../../../testing/test-plan.md). Kết quả migration và integration của lượt kiểm chứng trước nằm trong [hồ sơ Task 5.2](../../a2-delivery.md#task-52--kiểm-thử-luồng-nghiệp-vụ).
