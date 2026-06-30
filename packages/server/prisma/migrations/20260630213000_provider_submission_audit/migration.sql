-- Add provider lifecycle metadata to brands and campaigns.
ALTER TABLE "brands"
  ADD COLUMN "provider_status" TEXT,
  ADD COLUMN "provider_message" TEXT,
  ADD COLUMN "submit_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_submitted_at" TIMESTAMP(3),
  ADD COLUMN "last_submission_error" TEXT,
  ADD COLUMN "last_status_synced_at" TIMESTAMP(3);

ALTER TABLE "campaigns"
  ADD COLUMN "provider_status" TEXT,
  ADD COLUMN "provider_message" TEXT,
  ADD COLUMN "submit_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_submitted_at" TIMESTAMP(3),
  ADD COLUMN "last_submission_error" TEXT,
  ADD COLUMN "last_status_synced_at" TIMESTAMP(3);

-- Record every provider submission/refresh/webhook mutation for audit and ops visibility.
CREATE TABLE "provider_operation_logs" (
  "id" TEXT NOT NULL,
  "provider" "MessagingProvider" NOT NULL DEFAULT 'signalmash',
  "operation" TEXT NOT NULL,
  "local_resource_type" TEXT,
  "local_resource_id" TEXT,
  "external_id" TEXT,
  "status" TEXT NOT NULL,
  "request_payload" JSONB,
  "response_payload" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organization_id" TEXT NOT NULL,
  "installation_id" TEXT,

  CONSTRAINT "provider_operation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_operation_logs_organization_id_created_at_idx"
  ON "provider_operation_logs"("organization_id", "created_at");

CREATE INDEX "provider_operation_logs_installation_id_created_at_idx"
  ON "provider_operation_logs"("installation_id", "created_at");

CREATE INDEX "provider_operation_logs_local_resource_type_local_resource__idx"
  ON "provider_operation_logs"("local_resource_type", "local_resource_id", "created_at");

CREATE INDEX "provider_operation_logs_external_id_idx"
  ON "provider_operation_logs"("external_id");

CREATE INDEX "provider_operation_logs_operation_created_at_idx"
  ON "provider_operation_logs"("operation", "created_at");

ALTER TABLE "provider_operation_logs"
  ADD CONSTRAINT "provider_operation_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_operation_logs"
  ADD CONSTRAINT "provider_operation_logs_installation_id_fkey"
  FOREIGN KEY ("installation_id") REFERENCES "platform_installations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
