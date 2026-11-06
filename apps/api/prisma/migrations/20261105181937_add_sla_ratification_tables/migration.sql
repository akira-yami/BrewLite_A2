-- CreateEnum
CREATE TYPE "SLADocumentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SLAWorkflowStatus" AS ENUM ('PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SLAIncidentSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SLASignatureType" AS ENUM ('DIGITAL', 'EMAIL_CONFIRMATION', 'MANUAL');

-- CreateEnum
CREATE TYPE "SLAFeedbackType" AS ENUM ('COMMENT', 'CONCERN', 'SUGGESTION', 'BLOCKING_ISSUE');

-- AlterTable
ALTER TABLE "payment_recovery_audits" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payment_recovery_requests" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payment_recovery_resolutions" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "sla_documents" (
    "id" UUID NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "status" "SLADocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "executive_summary" TEXT NOT NULL,
    "metrics_definitions" JSONB NOT NULL,
    "lifecycle_slas" JSONB NOT NULL,
    "monitoring_config" JSONB NOT NULL,
    "incident_procedures" JSONB NOT NULL,
    "responsibilities" JSONB NOT NULL,
    "dependencies" JSONB NOT NULL,
    "review_config" JSONB NOT NULL,
    "review_period_days" INTEGER NOT NULL DEFAULT 90,
    "validity_period_days" INTEGER NOT NULL DEFAULT 180,
    "approved_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sla_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_approval_workflows" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "status" "SLAWorkflowStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "required_approvals" INTEGER NOT NULL DEFAULT 2,
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sla_approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_approvals" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature_type" "SLASignatureType" NOT NULL,
    "signature_value" VARCHAR(500) NOT NULL,
    "signature_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "signature_ip_address" VARCHAR(45),
    "comments" TEXT,

    CONSTRAINT "sla_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_review_feedback" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "feedback_type" "SLAFeedbackType" NOT NULL,
    "section" VARCHAR(255),
    "content" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_review_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_metrics_validations" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "validated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overall_status" VARCHAR(50) NOT NULL,
    "metric_validations" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,

    CONSTRAINT "sla_metrics_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_test_evidence" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "evidence_type" VARCHAR(50) NOT NULL,
    "source" VARCHAR(1000) NOT NULL,
    "description" TEXT NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL,
    "metrics" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_test_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sla_documents_status_idx" ON "sla_documents"("status");

-- CreateIndex
CREATE INDEX "sla_documents_created_by_id_idx" ON "sla_documents"("created_by_id");

-- CreateIndex
CREATE INDEX "sla_documents_expires_at_idx" ON "sla_documents"("expires_at");

-- CreateIndex
CREATE INDEX "sla_approval_workflows_document_id_idx" ON "sla_approval_workflows"("document_id");

-- CreateIndex
CREATE INDEX "sla_approval_workflows_status_idx" ON "sla_approval_workflows"("status");

-- CreateIndex
CREATE INDEX "sla_approval_workflows_submitted_by_id_idx" ON "sla_approval_workflows"("submitted_by_id");

-- CreateIndex
CREATE INDEX "sla_approvals_workflow_id_idx" ON "sla_approvals"("workflow_id");

-- CreateIndex
CREATE INDEX "sla_approvals_approver_id_idx" ON "sla_approvals"("approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "sla_approvals_workflow_id_approver_id_key" ON "sla_approvals"("workflow_id", "approver_id");

-- CreateIndex
CREATE INDEX "sla_review_feedback_workflow_id_idx" ON "sla_review_feedback"("workflow_id");

-- CreateIndex
CREATE INDEX "sla_review_feedback_reviewer_id_idx" ON "sla_review_feedback"("reviewer_id");

-- CreateIndex
CREATE INDEX "sla_review_feedback_resolved_idx" ON "sla_review_feedback"("resolved");

-- CreateIndex
CREATE INDEX "sla_metrics_validations_document_id_idx" ON "sla_metrics_validations"("document_id");

-- CreateIndex
CREATE INDEX "sla_metrics_validations_validated_at_idx" ON "sla_metrics_validations"("validated_at");

-- CreateIndex
CREATE INDEX "sla_test_evidence_document_id_idx" ON "sla_test_evidence"("document_id");

-- CreateIndex
CREATE INDEX "sla_test_evidence_evidence_type_idx" ON "sla_test_evidence"("evidence_type");

-- RenameForeignKey
ALTER TABLE "payment_recovery_audits" RENAME CONSTRAINT "payment_recovery_audits_request_id_fkey" TO "payment_recovery_audits_recovery_request_id_fkey";

-- AddForeignKey
ALTER TABLE "sla_documents" ADD CONSTRAINT "sla_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_approval_workflows" ADD CONSTRAINT "sla_approval_workflows_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sla_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_approval_workflows" ADD CONSTRAINT "sla_approval_workflows_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_approvals" ADD CONSTRAINT "sla_approvals_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "sla_approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_approvals" ADD CONSTRAINT "sla_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_review_feedback" ADD CONSTRAINT "sla_review_feedback_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "sla_approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_review_feedback" ADD CONSTRAINT "sla_review_feedback_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_metrics_validations" ADD CONSTRAINT "sla_metrics_validations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sla_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_test_evidence" ADD CONSTRAINT "sla_test_evidence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sla_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
