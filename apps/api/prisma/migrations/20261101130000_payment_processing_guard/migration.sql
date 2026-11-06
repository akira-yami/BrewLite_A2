-- Bảo đảm mỗi đơn hàng chỉ có tối đa một giao dịch thanh toán đang PROCESSING.
-- Nếu dữ liệu cũ đã có nhiều giao dịch PROCESSING trên cùng đơn, dừng migration để xử lý thủ công.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "payments"
        WHERE "status" = 'PROCESSING'
        GROUP BY "order_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce one PROCESSING payment per order: duplicate PROCESSING payments already exist';
    END IF;
END;
$$;

-- Partial unique index cho phép lưu nhiều payment FAILED/SUCCEEDED nhưng chỉ một payment PROCESSING.
CREATE UNIQUE INDEX "uq_one_processing_payment_per_order"
    ON "payments" ("order_id")
    WHERE "status" = 'PROCESSING';
