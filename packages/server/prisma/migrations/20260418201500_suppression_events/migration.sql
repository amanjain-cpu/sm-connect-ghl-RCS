-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SuppressionAction') THEN
    CREATE TYPE "SuppressionAction" AS ENUM ('opt_out', 'opt_in', 'help');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "suppression_events" (
  "id" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "action" "SuppressionAction" NOT NULL,
  "keyword" TEXT NOT NULL,
  "raw_text" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,

  CONSTRAINT "suppression_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "suppression_events_organization_id_idx"
ON "suppression_events"("organization_id");

CREATE INDEX IF NOT EXISTS "suppression_events_phone_number_idx"
ON "suppression_events"("phone_number");

CREATE INDEX IF NOT EXISTS "suppression_events_active_idx"
ON "suppression_events"("active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppression_events_organization_id_fkey'
  ) THEN
    ALTER TABLE "suppression_events"
    ADD CONSTRAINT "suppression_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
