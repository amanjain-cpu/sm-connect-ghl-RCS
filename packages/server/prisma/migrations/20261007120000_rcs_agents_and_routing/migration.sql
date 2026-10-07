-- RCS through SimplyRCS, with SMS fallback through Signalmash.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'MessagingProvider' AND e.enumlabel = 'simplyrcs') THEN
    ALTER TYPE "MessagingProvider" ADD VALUE 'simplyrcs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'MessageType' AND e.enumlabel = 'rcs') THEN
    ALTER TYPE "MessageType" ADD VALUE 'rcs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'MessageStatus' AND e.enumlabel = 'read') THEN
    ALTER TYPE "MessageStatus" ADD VALUE 'read';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeliveryChannel') THEN
    CREATE TYPE "DeliveryChannel" AS ENUM ('sms', 'mms', 'rcs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RcsAgentStatus') THEN
    CREATE TYPE "RcsAgentStatus" AS ENUM ('draft', 'submitted', 'ready_for_testing', 'in_testing', 'pending_launch', 'live', 'suspended', 'rejected');
  END IF;
END $$;

ALTER TABLE "messages"
ADD COLUMN IF NOT EXISTS "rcs_message_id" TEXT,
ADD COLUMN IF NOT EXISTS "rcs_conversation_id" TEXT,
ADD COLUMN IF NOT EXISTS "delivery_channel" "DeliveryChannel",
ADD COLUMN IF NOT EXISTS "fallback_reason" TEXT,
ADD COLUMN IF NOT EXISTS "rcs_content" JSONB,
ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "messages_rcs_message_id_key" ON "messages"("rcs_message_id");
CREATE INDEX IF NOT EXISTS "messages_rcs_conversation_id_idx" ON "messages"("rcs_conversation_id");

CREATE TABLE IF NOT EXISTS "rcs_agents" (
  "id" TEXT NOT NULL,
  "status" "RcsAgentStatus" NOT NULL DEFAULT 'draft',
  "sender_name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "logo_url" TEXT NOT NULL,
  "banner_url" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "billing_category" TEXT NOT NULL DEFAULT 'CONVERSATIONAL',
  "use_case" TEXT NOT NULL DEFAULT 'MULTI_USE',
  "phone" TEXT,
  "email" TEXT,
  "website" TEXT,
  "privacy_url" TEXT,
  "terms_url" TEXT,
  "simplyrcs_channel_id" TEXT,
  "simplyrcs_sender_id_id" TEXT,
  "provider_status" TEXT,
  "provider_message" TEXT,
  "test_devices" JSONB,
  "submitted_at" TIMESTAMP(3),
  "launched_at" TIMESTAMP(3),
  "last_status_synced_at" TIMESTAMP(3),
  "last_submission_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organization_id" TEXT NOT NULL,
  CONSTRAINT "rcs_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "rcs_agents_organization_id_key" ON "rcs_agents"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rcs_agents_simplyrcs_sender_id_id_key" ON "rcs_agents"("simplyrcs_sender_id_id");
CREATE INDEX IF NOT EXISTS "rcs_agents_status_idx" ON "rcs_agents"("status");

CREATE TABLE IF NOT EXISTS "rcs_capabilities" (
  "id" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "is_rcs_capable" BOOLEAN NOT NULL,
  "rcs_contact_id" TEXT,
  "provider" TEXT,
  "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organization_id" TEXT NOT NULL,
  CONSTRAINT "rcs_capabilities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "rcs_capabilities_organization_id_phone_number_key" ON "rcs_capabilities"("organization_id", "phone_number");
CREATE INDEX IF NOT EXISTS "rcs_capabilities_checked_at_idx" ON "rcs_capabilities"("checked_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcs_agents_organization_id_fkey') THEN
    ALTER TABLE "rcs_agents" ADD CONSTRAINT "rcs_agents_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rcs_capabilities_organization_id_fkey') THEN
    ALTER TABLE "rcs_capabilities" ADD CONSTRAINT "rcs_capabilities_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
