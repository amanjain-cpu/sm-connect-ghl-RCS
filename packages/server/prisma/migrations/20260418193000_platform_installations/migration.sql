-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessagingProvider') THEN
    CREATE TYPE "MessagingProvider" AS ENUM ('signalmash');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationLifecycleState') THEN
    CREATE TYPE "IntegrationLifecycleState" AS ENUM (
      'installed',
      'business_details_needed',
      'connection_pending',
      'brand_pending',
      'campaign_pending',
      'campaign_approved',
      'number_setup_required',
      'port_in_progress',
      'provider_not_activated',
      'ready',
      'error_attention_required'
    );
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExternalResourceKind') THEN
    CREATE TYPE "ExternalResourceKind" AS ENUM (
      'platform_installation',
      'provider_connection',
      'brand',
      'campaign',
      'phone_number',
      'message',
      'contact',
      'conversation',
      'port_order'
    );
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExternalResourceStatus') THEN
    CREATE TYPE "ExternalResourceStatus" AS ENUM ('pending', 'active', 'disabled', 'failed', 'archived');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SenderSelectionStrategy') THEN
    CREATE TYPE "SenderSelectionStrategy" AS ENUM ('default_sender', 'campaign_bound', 'explicit_sender');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "platform_connections"
ADD COLUMN IF NOT EXISTS "installation_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_installations" (
  "id" TEXT NOT NULL,
  "platform" "Platform" NOT NULL,
  "provider" "MessagingProvider" NOT NULL DEFAULT 'signalmash',
  "external_account_id" TEXT NOT NULL,
  "external_account_name" TEXT,
  "status" "PlatformStatus" NOT NULL DEFAULT 'pending',
  "lifecycle_state" "IntegrationLifecycleState" NOT NULL DEFAULT 'installed',
  "metadata" JSONB,
  "connected_at" TIMESTAMP(3),
  "last_sync_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,

  CONSTRAINT "platform_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "external_resource_mappings" (
  "id" TEXT NOT NULL,
  "kind" "ExternalResourceKind" NOT NULL,
  "platform" "Platform" NOT NULL,
  "provider" "MessagingProvider" NOT NULL DEFAULT 'signalmash',
  "local_resource_type" TEXT NOT NULL,
  "local_resource_id" TEXT,
  "local_parent_id" TEXT,
  "external_id" TEXT NOT NULL,
  "secondary_external_id" TEXT,
  "status" "ExternalResourceStatus" NOT NULL DEFAULT 'pending',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,
  "installation_id" TEXT,

  CONSTRAINT "external_resource_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sender_profiles" (
  "id" TEXT NOT NULL,
  "platform" "Platform" NOT NULL,
  "sender_key" TEXT NOT NULL,
  "sender_label" TEXT,
  "selection_strategy" "SenderSelectionStrategy" NOT NULL DEFAULT 'default_sender',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,
  "installation_id" TEXT,
  "phone_number_id" TEXT,

  CONSTRAINT "sender_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "platform_installations_organization_id_platform_external_account_id_key"
ON "platform_installations"("organization_id", "platform", "external_account_id");

CREATE INDEX IF NOT EXISTS "platform_installations_organization_id_idx"
ON "platform_installations"("organization_id");

CREATE INDEX IF NOT EXISTS "platform_installations_platform_idx"
ON "platform_installations"("platform");

CREATE INDEX IF NOT EXISTS "platform_installations_provider_idx"
ON "platform_installations"("provider");

CREATE INDEX IF NOT EXISTS "platform_installations_lifecycle_state_idx"
ON "platform_installations"("lifecycle_state");

CREATE UNIQUE INDEX IF NOT EXISTS "external_resource_mappings_provider_kind_external_id_key"
ON "external_resource_mappings"("provider", "kind", "external_id");

CREATE INDEX IF NOT EXISTS "external_resource_mappings_organization_id_idx"
ON "external_resource_mappings"("organization_id");

CREATE INDEX IF NOT EXISTS "external_resource_mappings_installation_id_idx"
ON "external_resource_mappings"("installation_id");

CREATE INDEX IF NOT EXISTS "external_resource_mappings_platform_idx"
ON "external_resource_mappings"("platform");

CREATE INDEX IF NOT EXISTS "external_resource_mappings_local_resource_type_local_resource_id_idx"
ON "external_resource_mappings"("local_resource_type", "local_resource_id");

CREATE INDEX IF NOT EXISTS "sender_profiles_organization_id_idx"
ON "sender_profiles"("organization_id");

CREATE INDEX IF NOT EXISTS "sender_profiles_installation_id_idx"
ON "sender_profiles"("installation_id");

CREATE INDEX IF NOT EXISTS "sender_profiles_phone_number_id_idx"
ON "sender_profiles"("phone_number_id");

CREATE UNIQUE INDEX IF NOT EXISTS "sender_profiles_installation_id_phone_number_id_key"
ON "sender_profiles"("installation_id", "phone_number_id");

CREATE INDEX IF NOT EXISTS "platform_connections_installation_id_idx"
ON "platform_connections"("installation_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_connections_installation_id_fkey'
  ) THEN
    ALTER TABLE "platform_connections"
    ADD CONSTRAINT "platform_connections_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "platform_installations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_installations_organization_id_fkey'
  ) THEN
    ALTER TABLE "platform_installations"
    ADD CONSTRAINT "platform_installations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_resource_mappings_organization_id_fkey'
  ) THEN
    ALTER TABLE "external_resource_mappings"
    ADD CONSTRAINT "external_resource_mappings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_resource_mappings_installation_id_fkey'
  ) THEN
    ALTER TABLE "external_resource_mappings"
    ADD CONSTRAINT "external_resource_mappings_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "platform_installations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sender_profiles_organization_id_fkey'
  ) THEN
    ALTER TABLE "sender_profiles"
    ADD CONSTRAINT "sender_profiles_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sender_profiles_installation_id_fkey'
  ) THEN
    ALTER TABLE "sender_profiles"
    ADD CONSTRAINT "sender_profiles_installation_id_fkey"
    FOREIGN KEY ("installation_id") REFERENCES "platform_installations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sender_profiles_phone_number_id_fkey'
  ) THEN
    ALTER TABLE "sender_profiles"
    ADD CONSTRAINT "sender_profiles_phone_number_id_fkey"
    FOREIGN KEY ("phone_number_id") REFERENCES "phone_numbers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
