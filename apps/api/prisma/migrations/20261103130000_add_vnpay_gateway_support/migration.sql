ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'VNPAY';

ALTER TABLE "payments"
  ADD COLUMN "gateway_reference" VARCHAR(100),
  ADD COLUMN "payment_url" VARCHAR(2048);

CREATE UNIQUE INDEX "payments_gateway_reference_key"
  ON "payments"("gateway_reference");
