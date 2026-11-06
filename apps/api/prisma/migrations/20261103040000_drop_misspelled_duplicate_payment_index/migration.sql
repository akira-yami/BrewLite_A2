-- The previous deduplication migration used a misspelled index name.
-- Drop the exact index created by 20261102110000_one_processing_payment_per_order.
-- Keep the canonical guard created by 20261101130000_payment_processing_guard.
DROP INDEX IF EXISTS "payments_one_processing_per_order_key";
