-- Google Sign-In: stable Google user id (OIDC id-token `sub`) on User.
-- Additive expand: nullable + unique, no backfill, no data loss.
ALTER TABLE "User" ADD COLUMN "googleUserId" VARCHAR(255);
CREATE UNIQUE INDEX "User_googleUserId_key" ON "User"("googleUserId");
