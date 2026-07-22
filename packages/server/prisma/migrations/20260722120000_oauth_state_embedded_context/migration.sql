ALTER TABLE "oauth_states"
  ADD COLUMN IF NOT EXISTS "embedded_location_id" TEXT,
  ADD COLUMN IF NOT EXISTS "embedded_installation_id" TEXT;
