-- Reserve-with-expiry support for pro vanity handles.
-- Records when a not-yet-premium pro reserves a handle so a cron can release stale,
-- never-activated reservations. Nullable + additive: no backfill, safe to expand.
ALTER TABLE "ProfessionalProfile" ADD COLUMN "handleReservedAt" TIMESTAMP(3);
