CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingAccountStatus') THEN
    CREATE TYPE "BillingAccountStatus" AS ENUM ('active', 'suspended');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingPricingTier') THEN
    CREATE TYPE "BillingPricingTier" AS ENUM ('tier_250', 'tier_500', 'tier_1400');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingLedgerEntryType') THEN
    CREATE TYPE "BillingLedgerEntryType" AS ENUM ('credit', 'debit', 'hold', 'release');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingLedgerCategory') THEN
    CREATE TYPE "BillingLedgerCategory" AS ENUM (
      'wallet_topup',
      'saved_payment_method',
      'message_usage',
      'inbound_hold',
      'inbound_release',
      'mrc_campaign',
      'mrc_phone_number',
      'setup_fee',
      'enhanced_vetting',
      'campaign_expedite',
      'card_charge',
      'adjustment'
    );
  END IF;
END $$;

ALTER TABLE "organization_subscriptions"
  ADD COLUMN IF NOT EXISTS "message_credit_balance" DECIMAL(12,4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "billing_accounts" (
  "id" TEXT NOT NULL,
  "status" "BillingAccountStatus" NOT NULL DEFAULT 'active',
  "pricing_tier" "BillingPricingTier" NOT NULL DEFAULT 'tier_250',
  "wallet_balance" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "stripe_customer_id" TEXT,
  "stripe_default_payment_method_id" TEXT,
  "suspension_reason" TEXT,
  "suspended_at" TIMESTAMP(3),
  "mrc_anchor_at" TIMESTAMP(3),
  "mrc_next_run_at" TIMESTAMP(3),
  "setup_fee_charged_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,
  CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_accounts_organization_id_key"
  ON "billing_accounts"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_accounts_stripe_customer_id_key"
  ON "billing_accounts"("stripe_customer_id");
CREATE INDEX IF NOT EXISTS "billing_accounts_status_idx"
  ON "billing_accounts"("status");
CREATE INDEX IF NOT EXISTS "billing_accounts_pricing_tier_idx"
  ON "billing_accounts"("pricing_tier");

CREATE TABLE IF NOT EXISTS "billing_ledger_entries" (
  "id" TEXT NOT NULL,
  "ledger_key" TEXT NOT NULL,
  "entry_type" "BillingLedgerEntryType" NOT NULL,
  "category" "BillingLedgerCategory" NOT NULL,
  "amount" DECIMAL(12,4) NOT NULL,
  "balance_after" DECIMAL(12,4) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "description" TEXT NOT NULL,
  "source_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organization_id" TEXT NOT NULL,
  "billing_account_id" TEXT NOT NULL,
  "message_id" TEXT,
  CONSTRAINT "billing_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_ledger_entries_ledger_key_key"
  ON "billing_ledger_entries"("ledger_key");
CREATE INDEX IF NOT EXISTS "billing_ledger_entries_organization_id_created_at_idx"
  ON "billing_ledger_entries"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "billing_ledger_entries_billing_account_id_created_at_idx"
  ON "billing_ledger_entries"("billing_account_id", "created_at");
CREATE INDEX IF NOT EXISTS "billing_ledger_entries_category_idx"
  ON "billing_ledger_entries"("category");
CREATE INDEX IF NOT EXISTS "billing_ledger_entries_message_id_idx"
  ON "billing_ledger_entries"("message_id");

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "visible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "held_for_payment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "released" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "held_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "released_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "hold_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "billing_estimate" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_accounts_organization_id_fkey') THEN
    ALTER TABLE "billing_accounts"
    ADD CONSTRAINT "billing_accounts_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_ledger_entries_organization_id_fkey') THEN
    ALTER TABLE "billing_ledger_entries"
    ADD CONSTRAINT "billing_ledger_entries_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_ledger_entries_billing_account_id_fkey') THEN
    ALTER TABLE "billing_ledger_entries"
    ADD CONSTRAINT "billing_ledger_entries_billing_account_id_fkey"
    FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_ledger_entries_message_id_fkey') THEN
    ALTER TABLE "billing_ledger_entries"
    ADD CONSTRAINT "billing_ledger_entries_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "billing_accounts" (
  "id",
  "status",
  "pricing_tier",
  "wallet_balance",
  "stripe_customer_id",
  "stripe_default_payment_method_id",
  "suspension_reason",
  "suspended_at",
  "mrc_anchor_at",
  "mrc_next_run_at",
  "metadata",
  "created_at",
  "updated_at",
  "organization_id"
)
SELECT
  gen_random_uuid()::text,
  CASE
    WHEN o."status" = 'suspended' THEN 'suspended'::"BillingAccountStatus"
    ELSE 'active'::"BillingAccountStatus"
  END,
  'tier_250'::"BillingPricingTier",
  COALESCE(s."message_credit_balance", 0),
  s."stripe_customer_id",
  s."stripe_default_payment_method_id",
  COALESCE(s."billing_blocked_reason", o."suspension_reason"),
  COALESCE(s."billing_blocked_at", o."suspended_at"),
  COALESCE(s."activated_at", CURRENT_TIMESTAMP),
  date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month',
  jsonb_build_object(
    'migration', 'prepaid_wallet_billing',
    'legacySubscriptionId', s."id",
    'legacyPlan', s."plan"
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  o."id"
FROM "organizations" o
LEFT JOIN "organization_subscriptions" s ON s."organization_id" = o."id"
WHERE NOT EXISTS (
  SELECT 1 FROM "billing_accounts" ba WHERE ba."organization_id" = o."id"
);

INSERT INTO "billing_ledger_entries" (
  "id",
  "ledger_key",
  "entry_type",
  "category",
  "amount",
  "balance_after",
  "description",
  "source_id",
  "metadata",
  "organization_id",
  "billing_account_id"
)
SELECT
  gen_random_uuid()::text,
  'legacy-message-credit-balance:' || ba."organization_id",
  'credit'::"BillingLedgerEntryType",
  'adjustment'::"BillingLedgerCategory",
  ba."wallet_balance",
  ba."wallet_balance",
  'Legacy message credit balance migrated to wallet',
  s."id",
  jsonb_build_object('source', 'organization_subscriptions.message_credit_balance'),
  ba."organization_id",
  ba."id"
FROM "billing_accounts" ba
LEFT JOIN "organization_subscriptions" s ON s."organization_id" = ba."organization_id"
WHERE ba."wallet_balance" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "billing_ledger_entries" le
    WHERE le."ledger_key" = 'legacy-message-credit-balance:' || ba."organization_id"
  );
