-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingDirection') THEN
    CREATE TYPE "BillingDirection" AS ENUM ('inbound', 'outbound');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingUnit') THEN
    CREATE TYPE "BillingUnit" AS ENUM ('sms', 'mms', 'phone_number');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingStatus') THEN
    CREATE TYPE "BillingStatus" AS ENUM ('pending', 'posted', 'ignored', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PortOrderStatus') THEN
    CREATE TYPE "PortOrderStatus" AS ENUM ('draft', 'submitted', 'awaiting_documents', 'in_progress', 'completed', 'rejected', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeadLetterStatus') THEN
    CREATE TYPE "DeadLetterStatus" AS ENUM ('pending', 'replayed', 'ignored');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" TEXT NOT NULL,
  "billing_key" TEXT NOT NULL,
  "direction" "BillingDirection" NOT NULL,
  "unit" "BillingUnit" NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "status" "BillingStatus" NOT NULL DEFAULT 'pending',
  "source" TEXT NOT NULL,
  "cycle_month" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,
  "message_id" TEXT,
  CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_billing_key_key" ON "billing_events"("billing_key");
CREATE INDEX IF NOT EXISTS "billing_events_organization_id_idx" ON "billing_events"("organization_id");
CREATE INDEX IF NOT EXISTS "billing_events_cycle_month_idx" ON "billing_events"("cycle_month");
CREATE INDEX IF NOT EXISTS "billing_events_status_idx" ON "billing_events"("status");

CREATE TABLE IF NOT EXISTS "port_orders" (
  "id" TEXT NOT NULL,
  "losing_carrier" TEXT,
  "status" "PortOrderStatus" NOT NULL DEFAULT 'draft',
  "requested_foc_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,
  "phone_number_id" TEXT,
  CONSTRAINT "port_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "port_orders_organization_id_idx" ON "port_orders"("organization_id");
CREATE INDEX IF NOT EXISTS "port_orders_status_idx" ON "port_orders"("status");

CREATE TABLE IF NOT EXISTS "dead_letter_jobs" (
  "id" TEXT NOT NULL,
  "queue_name" TEXT NOT NULL,
  "job_name" TEXT NOT NULL,
  "job_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "error" TEXT NOT NULL,
  "status" "DeadLetterStatus" NOT NULL DEFAULT 'pending',
  "replayed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT,
  CONSTRAINT "dead_letter_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dead_letter_jobs_queue_name_job_key_key" ON "dead_letter_jobs"("queue_name", "job_key");
CREATE INDEX IF NOT EXISTS "dead_letter_jobs_organization_id_idx" ON "dead_letter_jobs"("organization_id");
CREATE INDEX IF NOT EXISTS "dead_letter_jobs_status_idx" ON "dead_letter_jobs"("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_organization_id_fkey') THEN
    ALTER TABLE "billing_events"
    ADD CONSTRAINT "billing_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_message_id_fkey') THEN
    ALTER TABLE "billing_events"
    ADD CONSTRAINT "billing_events_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'port_orders_organization_id_fkey') THEN
    ALTER TABLE "port_orders"
    ADD CONSTRAINT "port_orders_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'port_orders_phone_number_id_fkey') THEN
    ALTER TABLE "port_orders"
    ADD CONSTRAINT "port_orders_phone_number_id_fkey"
    FOREIGN KEY ("phone_number_id") REFERENCES "phone_numbers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dead_letter_jobs_organization_id_fkey') THEN
    ALTER TABLE "dead_letter_jobs"
    ADD CONSTRAINT "dead_letter_jobs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
