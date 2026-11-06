-- A single Order may have at most one outstanding gateway attempt.
-- This is the database-level invariant that prevents concurrent idempotency keys
-- from creating multiple independently payable VNPay redirects.
CREATE UNIQUE INDEX "payments_one_processing_per_order_key"
  ON "payments"("order_id")
  WHERE "status" = 'PROCESSING';
