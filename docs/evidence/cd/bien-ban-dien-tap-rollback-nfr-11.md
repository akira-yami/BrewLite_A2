# Diễn tập khôi phục PostgreSQL và khởi động lại API — NFR-11

**Lượt khảo sát ban đầu.** Kịch bản đã ghi nhận một lần backup/restore và kiểm tra khởi động lại API. Kết quả 6,25 giây là thời gian khởi động lại từ cùng bản build. Lượt đổi revision tiếp theo được ghi ở cuối tài liệu.

- [Kết quả đo đã lưu](nfr-11-drill-results.json)
- [Script backup/restore cho DB test cục bộ](../../../scripts/run-rollback-drill-nfr11.mjs)
- [Runbook rollback](rollback-guide.md)
- [Minh chứng CD của 53b9321](railway-53b9321/README.md)

Khi diễn tập trên DB test, ghi ID và SHA của cả hai bản deploy, triển khai bản mới, chuyển sang bản cũ tương thích schema, rồi ghi health check, smoke và kết quả đối chiếu số lượng/ID đơn trước và sau. Script backup/restore yêu cầu hai database local riêng tên `brewlite_test_*`, DB đích trống và `pg_dump`/`pg_restore` trên PATH. Dump tạm được dọn sau khi đối chiếu. Quy trình đổi revision thực hiện theo runbook.

## Diễn tập bổ sung ngày 14/11/2026

Đã kiểm tra đổi revision thật trên local từ `v1.0.2` về `v1.0.1` cho Web và API, áp dụng migration bù và phục hồi dữ liệu vào DB test riêng. Xem [biên bản và log của lượt diễn tập bốn lớp](rollback-local-2026-11-14/README.md).
