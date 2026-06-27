-- Sign in with Apple: stable Apple user id (identity-token `sub`) on User.
-- Additive expand: nullable + unique, no backfill, no data loss.
ALTER TABLE "User" ADD COLUMN "appleUserId" VARCHAR(255);
CREATE UNIQUE INDEX "User_appleUserId_key" ON "User"("appleUserId");
