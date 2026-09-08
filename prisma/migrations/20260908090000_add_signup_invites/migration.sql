-- Private-beta signup invitations. Codes are stored as SHA-256 digests and
-- consumed atomically with account creation.
ALTER TYPE "NotificationEventKey" ADD VALUE 'ADMIN_USER_SIGNED_UP';

CREATE TABLE "SignupInvite" (
    "id" TEXT NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "codeHint" VARCHAR(8) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "createdByAdminUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupInvite_pkey" PRIMARY KEY ("id")
);

-- Defense in depth: application tables are never directly accessible through
-- PostgreSQL's public role, even though all current access is server-side.
ALTER TABLE "SignupInvite" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "SignupInvite_codeHash_key" ON "SignupInvite"("codeHash");
CREATE UNIQUE INDEX "SignupInvite_usedByUserId_key" ON "SignupInvite"("usedByUserId");
CREATE INDEX "SignupInvite_createdAt_idx" ON "SignupInvite"("createdAt");
CREATE INDEX "SignupInvite_expiresAt_usedAt_revokedAt_idx" ON "SignupInvite"("expiresAt", "usedAt", "revokedAt");
CREATE INDEX "SignupInvite_createdByAdminUserId_createdAt_idx" ON "SignupInvite"("createdByAdminUserId", "createdAt");

ALTER TABLE "SignupInvite"
ADD CONSTRAINT "SignupInvite_createdByAdminUserId_fkey"
FOREIGN KEY ("createdByAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SignupInvite"
ADD CONSTRAINT "SignupInvite_usedByUserId_fkey"
FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
