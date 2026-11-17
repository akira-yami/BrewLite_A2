# Diễn tập rollback bốn lớp — 14/11/2026

Chạy local trên hai Git worktree tách biệt, dùng các bản build từ tag `v1.0.2` (`53b9321`) và `v1.0.1` (`2ea3371`). API, Web và PostgreSQL test dùng cổng loopback riêng. Thời gian dưới đây đo chuyển tiến trình local.

| Lớp | Đã thực hiện | Kết quả |
|---|---|---|
| Web | Dừng bản Web mới, khởi động bản Web từ tag cũ trên cùng cổng. | Health và menu HTTP 200 sau 1,403 giây. |
| API | Dừng bản API mới, khởi động bản API từ tag cũ trên cùng DB. | Health HTTP 200, smoke 4/4, tổng 3,898 giây. Đơn tạo trước khi chuyển vẫn đọc được với trạng thái PENDING. |
| Prisma và PostgreSQL | Backup DB test. Áp dụng migration tạo bảng thử, rồi áp dụng migration bù xóa bảng đó. Restore backup vào DB test thứ hai. | Bảng thử được gỡ. ID và trạng thái của cả 3 đơn khớp khi đối chiếu DB trước, sau migration bù và sau restore. |
| Git tag | Checkout hai tag vào worktree riêng và build, chuyển thực thi từ bản mới về bản cũ. | Web và API chạy bản build từ commit `2ea3371`. |

- [Kết quả JSON kèm log smoke và SHA đầy đủ](results.json)
- [Script diễn tập](../../../../scripts/run-release-rollback-local.mjs)
- [Runbook Railway](../rollback-guide.md)

Hai tag có cùng lịch sử migration. Migration bù được kiểm tra riêng trên một bảng thử, trong worktree tạm. Lượt chạy xác minh chuyển revision local và bảo toàn dữ liệu thử. Chưa thao tác rollback trên Railway hoặc đo thời gian chuyển traffic production.
