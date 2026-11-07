-- Migration: payment idempotency constraints
-- Ref: ADR-004, FR-07, AT-FR-07.2/.3
--
-- 1. Partial unique index: only one SUCCEEDED payment per order.
--    This is the DB-level guard against duplicate payment success
--    even under concurrent finalization.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_order_succeeded_unique"
  ON "payments" ("order_id")
  WHERE ("status" = 'SUCCEEDED');

-- 2. Partial unique index: only one EARN loyalty transaction per order.
--    Guards against duplicate loyalty EARN even if finalize is called twice.
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_transactions_order_earn_unique"
  ON "loyalty_transactions" ("order_id")
  WHERE ("type" = 'EARN' AND "order_id" IS NOT NULL);

-- 3. CHECK constraint: payment amount must be positive.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- 4. CHECK constraint: idempotency_key must not be empty.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_idempotency_key_nonempty" CHECK (length("idempotency_key") > 0);
