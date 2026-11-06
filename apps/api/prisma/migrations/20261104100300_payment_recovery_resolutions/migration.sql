CREATE TABLE "payment_recovery_resolutions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payment_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "decision" "PaymentRecoveryDecision" NOT NULL,
  "evidence_reference" VARCHAR(120) NOT NULL,
  "incident_reference" VARCHAR(120) NOT NULL,
  "correlation_id" VARCHAR(100) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_recovery_resolutions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_recovery_resolutions_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_recovery_resolutions_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_recovery_resolutions_payment_id_idempotency_key_key"
  ON "payment_recovery_resolutions"("payment_id", "idempotency_key");
CREATE INDEX "payment_recovery_resolutions_payment_id_created_at_idx"
  ON "payment_recovery_resolutions"("payment_id", "created_at");
CREATE OR REPLACE FUNCTION reject_payment_recovery_resolution_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment_recovery_resolutions is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payment_recovery_resolutions_immutable"
BEFORE UPDATE OR DELETE ON "payment_recovery_resolutions"
FOR EACH ROW EXECUTE FUNCTION reject_payment_recovery_resolution_mutation();
