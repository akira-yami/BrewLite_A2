# Sơ đồ BrewLite A2

| Phạm vi | Nguồn | Bản xem |
|---|---|---|
| Use Case tổng thể | [PlantUML](use-case-overview.puml) | [SVG](use-case-overview.svg) |
| UC-06 Tạo đơn | [PlantUML](use-case-uc06.puml) | [SVG](use-case-uc06.svg) |
| UC-08 Thanh toán | [PlantUML](use-case-uc08.puml) | [SVG](use-case-uc08.svg) |
| Activity từ menu đến xác nhận đơn | [PlantUML](activity-checkout.puml) | [SVG](activity-checkout.svg) |
| Sequence checkout từ giỏ đến xác nhận và lịch sử | [PlantUML](sequence-checkout.puml) | [SVG](sequence-checkout.svg) |
| Chi tiết tạo đơn | [PlantUML](sequence-create-order.puml) | [SVG](sequence-create-order.svg) |
| Chi tiết thanh toán | [PlantUML](sequence-payment.puml) | [SVG](sequence-payment.svg) |
| Class domain | [PlantUML](class-domain.puml) | [SVG](class-domain.svg) |
| Deployment production | [PlantUML](deployment-production.puml) | [SVG](deployment-production.svg) |
| ERD PostgreSQL | [PlantUML](../../database/BrewLite.puml) | [SVG](../../database/BrewLite.svg) |

Checkout dùng khung `ref` để dẫn đến hai sequence riêng. Sequence UC-06 mô tả giao dịch tạo đơn và giữ nguyên liệu. Sequence UC-08 mô tả API thanh toán, gửi lại cùng key và callback VNPay.

Từ gốc repo, dùng JAR PlantUML 1.2026.8 từ bản phát hành GitHub. Script kiểm tra SHA-256 của JAR trước khi xuất SVG, PNG và cập nhật manifest.

```text
node scripts/render-diagrams.mjs path/to/plantuml-1.2026.8.jar docs/diagrams/manifest.json
node scripts/render-diagrams.mjs path/to/plantuml-1.2026.8.jar
node scripts/check-docs.mjs
```
