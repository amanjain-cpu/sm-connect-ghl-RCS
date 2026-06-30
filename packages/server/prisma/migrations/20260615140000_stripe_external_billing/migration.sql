-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionPlan') THEN
    CREATE TYPE "SubscriptionPlan" AS ENUM ('starter', 'growth', 'scale');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus" AS ENUM (
      'pending',
      'active',
      'trialing',
      'past_due',
      'unpaid',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'paused'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingChargeKind') THEN
    CREATE TYPE "BillingChargeKind" AS ENUM (
      'subscription_checkout',
      'message_overage',
      'phone_number_activation',
      'phone_number_mrc',
      'invoice_adjustment'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingChargeStatus') THEN
    CREATE TYPE "BillingChargeStatus" AS ENUM (
      'pending',
      'succeeded',
      'failed',
      'requires_action',
      'canceled',
      'blocked'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "organization_subscriptions" (
  "id" TEXT NOT NULL,
  "plan" "SubscriptionPlan",
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'pending',
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "stripe_default_payment_method_id" TEXT,
  "stripe_latest_invoice_id" TEXT,
  "current_period_start" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "sms_included" INTEGER NOT NULL DEFAULT 0,
  "mms_included" INTEGER NOT NULL DEFAULT 0,
  "phone_numbers_included" INTEGER NOT NULL DEFAULT 0,
  "sms_used" INTEGER NOT NULL DEFAULT 0,
  "mms_used" INTEGER NOT NULL DEFAULT 0,
  "pending_overage_balance" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "billing_blocked_at" TIMESTAMP(3),
  "billing_blocked_reason" TEXT,
  "activated_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,
  CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_subscriptions_organization_id_key"
  ON "organization_subscriptions"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_subscriptions_stripe_customer_id_key"
  ON "organization_subscriptions"("stripe_customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_subscriptions_stripe_subscription_id_key"
  ON "organization_subscriptions"("stripe_subscription_id");
CREATE INDEX IF NOT EXISTS "organization_subscriptions_status_idx"
  ON "organization_subscriptions"("status");

CREATE TABLE IF NOT EXISTS "billing_charges" (
  "id" TEXT NOT NULL,
  "charge_key" TEXT NOT NULL,
  "kind" "BillingChargeKind" NOT NULL,
  "status" "BillingChargeStatus" NOT NULL DEFAULT 'pending',
  "amount" DECIMAL(12,4) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "description" TEXT NOT NULL,
  "stripe_payment_intent_id" TEXT,
  "stripe_checkout_session_id" TEXT,
  "stripe_invoice_id" TEXT,
  "stripe_invoice_item_id" TEXT,
  "failure_reason" TEXT,
  "metadata" JSONB,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "organization_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "billing_event_id" TEXT,
  CONSTRAINT "billing_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_charges_charge_key_key"
  ON "billing_charges"("charge_key");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_charges_stripe_payment_intent_id_key"
  ON "billing_charges"("stripe_payment_intent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_charges_stripe_checkout_session_id_key"
  ON "billing_charges"("stripe_checkout_session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_charges_stripe_invoice_item_id_key"
  ON "billing_charges"("stripe_invoice_item_id");
CREATE INDEX IF NOT EXISTS "billing_charges_organization_id_idx"
  ON "billing_charges"("organization_id");
CREATE INDEX IF NOT EXISTS "billing_charges_subscription_id_idx"
  ON "billing_charges"("subscription_id");
CREATE INDEX IF NOT EXISTS "billing_charges_kind_idx"
  ON "billing_charges"("kind");
CREATE INDEX IF NOT EXISTS "billing_charges_status_idx"
  ON "billing_charges"("status");
CREATE INDEX IF NOT EXISTS "billing_charges_stripe_invoice_id_idx"
  ON "billing_charges"("stripe_invoice_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_subscriptions_organization_id_fkey') THEN
    ALTER TABLE "organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_charges_organization_id_fkey') THEN
    ALTER TABLE "billing_charges"
    ADD CONSTRAINT "billing_charges_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_charges_subscription_id_fkey') THEN
    ALTER TABLE "billing_charges"
    ADD CONSTRAINT "billing_charges_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "organization_subscriptions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_charges_billing_event_id_fkey') THEN
    ALTER TABLE "billing_charges"
    ADD CONSTRAINT "billing_charges_billing_event_id_fkey"
    FOREIGN KEY ("billing_event_id") REFERENCES "billing_events"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
