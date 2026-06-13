-- Tenant attribution for MediaAsset + Notification (EXPAND phase).
--
-- Adds a nullable "proTenantId" to both models, backfills it from the owning
-- pro's homeTenantId, and indexes + FK-constrains it. Derivation is
-- deterministic: "professionalId" is required on both tables and
-- "ProfessionalProfile"."homeTenantId" is already NOT NULL (tenant contract
-- phase), so every existing row gets a non-null value.
--
-- A follow-up CONTRACT migration sets the columns NOT NULL after the backfill
-- is verified in staging + production. Until then the Prisma field stays
-- "proTenantId String?".
--
-- Written in the idempotent raw-SQL style (see
-- 20260509000000_add_professional_search_index) so reruns are safe.

-- MediaAsset ----------------------------------------------------------------

ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "proTenantId" TEXT;

UPDATE "MediaAsset" m
SET "proTenantId" = p."homeTenantId"
FROM "ProfessionalProfile" p
WHERE p."id" = m."professionalId"
  AND m."proTenantId" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MediaAsset_proTenantId_fkey'
  ) THEN
    ALTER TABLE "MediaAsset"
      ADD CONSTRAINT "MediaAsset_proTenantId_fkey"
      FOREIGN KEY ("proTenantId") REFERENCES "Tenant"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "MediaAsset_proTenantId_idx"
  ON "MediaAsset"("proTenantId");

-- Notification --------------------------------------------------------------

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "proTenantId" TEXT;

UPDATE "Notification" n
SET "proTenantId" = p."homeTenantId"
FROM "ProfessionalProfile" p
WHERE p."id" = n."professionalId"
  AND n."proTenantId" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_proTenantId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_proTenantId_fkey"
      FOREIGN KEY ("proTenantId") REFERENCES "Tenant"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Notification_proTenantId_idx"
  ON "Notification"("proTenantId");
