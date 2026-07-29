ALTER TABLE "super_admins"
ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "deactivated_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "super_admin_invites" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "accepted_admin_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_admin_id" TEXT NOT NULL,
  CONSTRAINT "super_admin_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "super_admin_invites_token_hash_key"
ON "super_admin_invites"("token_hash");

CREATE INDEX IF NOT EXISTS "super_admin_invites_email_idx"
ON "super_admin_invites"("email");

CREATE INDEX IF NOT EXISTS "super_admin_invites_created_by_admin_id_idx"
ON "super_admin_invites"("created_by_admin_id");

CREATE INDEX IF NOT EXISTS "super_admin_invites_expires_at_idx"
ON "super_admin_invites"("expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'super_admin_invites_created_by_admin_id_fkey'
  ) THEN
    ALTER TABLE "super_admin_invites"
    ADD CONSTRAINT "super_admin_invites_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id") REFERENCES "super_admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
