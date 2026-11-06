CREATE TABLE "payment_recovery_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payment_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "provider_request_id" VARCHAR(32) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "incident_reference" VARCHAR(120) NOT NULL,
  "correlation_id" VARCHAR(100) NOT NULL,
  "status" "PaymentRecoveryRequestStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "provider_outcome" VARCHAR(64),
  "provider_response_code" VARCHAR(10),
  "provider_transaction_no" VARCHAR(100),
  "error_code" VARCHAR(100),
  "lease_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "payment_recovery_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_recovery_requests_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_recovery_requests_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_recovery_requests_provider_request_id_key"
  ON "payment_recovery_requests"("provider_request_id");
CREATE UNIQUE INDEX "payment_recovery_requests_payment_id_idempotency_key_key"
  ON "payment_recovery_requests"("payment_id", "idempotency_key");
CREATE INDEX "payment_recovery_requests_payment_id_created_at_idx"
  ON "payment_recovery_requests"("payment_id", "created_at" DESC);
CREATE INDEX "payment_recovery_requests_status_lease_expires_at_idx"
  ON "payment_recovery_requests"("status", "lease_expires_at");

CREATE TABLE "payment_recovery_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recovery_request_id" UUID,
  "payment_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "actor_type" "PaymentRecoveryActorType" NOT NULL,
  "gateway_reference" VARCHAR(100),
  "correlation_id" VARCHAR(100) NOT NULL,
  "incident_reference" VARCHAR(120) NOT NULL,
  "before_state" "PaymentStatus" NOT NULL,
  "after_state" "PaymentStatus" NOT NULL,
  "provider_outcome" VARCHAR(64) NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_recovery_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_recovery_audits_request_id_fkey"
    FOREIGN KEY ("recovery_request_id") REFERENCES "payment_recovery_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_recovery_audits_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_recovery_audits_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "payment_recovery_audits_payment_id_created_at_idx"
  ON "payment_recovery_audits"("payment_id", "created_at");
CREATE INDEX "payment_recovery_audits_correlation_id_idx"
  ON "payment_recovery_audits"("correlation_id");

CREATE OR REPLACE FUNCTION reject_payment_recovery_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment_recovery_audits is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_recovery_audits_immutable"
BEFORE UPDATE OR DELETE ON "payment_recovery_audits"
FOR EACH ROW EXECUTE FUNCTION reject_payment_recovery_audit_mutation();

DROP INDEX IF EXISTS "uq_one_processing_payment_per_order";
CREATE UNIQUE INDEX "uq_one_processing_payment_per_order"
  ON "payments" ("order_id")
  WHERE "status" IN ('PROCESSING', 'MANUAL_REVIEW');
