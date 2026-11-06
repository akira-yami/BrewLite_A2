-- Keep the original PROCESSING-payment invariant and remove the duplicate
-- index introduced by the following migration on 2026-11-02.
-- This is a forward-only correction: never rewrite migrations already applied.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'payments'
          AND indexname = 'uq_one_processing_payment_per_order'
    ) THEN
        RAISE EXCEPTION
            'Required PROCESSING-payment guard index uq_one_processing_payment_per_order is missing';
    END IF;
END;
$$;

DROP INDEX IF EXISTS "payments_one_processing_payment_per_order_key";
