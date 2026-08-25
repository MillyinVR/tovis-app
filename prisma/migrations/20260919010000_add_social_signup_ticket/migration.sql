-- Two-phase social signup: a verified Google/Apple identity that has no account
-- yet is parked in SocialSignupTicket while the person finishes signing up
-- (role, phone, SMS consent, location, claim adoption), instead of being turned
-- into a half-formed account inline by /api/v1/auth/{google,apple}.
--
-- Additive apart from ONE relaxation on User.password (NOT NULL -> NULL), which
-- widens the accepted set and so applies cleanly to live data with no backfill:
-- every existing row already has a value.

-- CreateEnum
CREATE TYPE "SocialAuthProvider" AS ENUM ('GOOGLE', 'APPLE');

-- AlterTable
-- A social account has no password at all. Until now one was invented (a bcrypt
-- hash of a random UUID) purely to satisfy NOT NULL, which left provider-only
-- accounts indistinguishable from password accounts at the row level. NULL is
-- the true value. Safe by construction: the login route reads this as
-- `user?.password ?? DUMMY_PASSWORD_HASH`, so a NULL is compared in constant
-- time against a hash no input matches and falls out as invalid credentials —
-- it does not become an empty-password bypass.
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SocialSignupTicket" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "provider" "SocialAuthProvider" NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "firstName" VARCHAR(255),
    "lastName" VARCHAR(255),
    "tenantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "issuedIp" TEXT,
    "issuedUserAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialSignupTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialSignupTicket_tokenHash_key" ON "SocialSignupTicket"("tokenHash");

-- CreateIndex
-- Serves the issuance-side burn of a subject's earlier unused tickets, so a
-- person who taps "Continue with Google" three times leaves exactly one live
-- ticket rather than three. Redemption looks the row up by primary key.
CREATE INDEX "SocialSignupTicket_provider_subject_usedAt_idx" ON "SocialSignupTicket"("provider", "subject", "usedAt");

-- CreateIndex
CREATE INDEX "SocialSignupTicket_expiresAt_idx" ON "SocialSignupTicket"("expiresAt");

-- AddForeignKey
-- Cascade, not the Restrict every other tenant-scoped table uses: a ticket is a
-- minutes-long scrap of in-flight signup state, not history worth refusing a
-- tenant teardown over.
ALTER TABLE "SocialSignupTicket" ADD CONSTRAINT "SocialSignupTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 🔴 Every table in this database carries RLS; a new one that omits it is
-- readable by any role the app's connection can assume. No policy is added: all
-- access goes through the app's own scoping (the Prisma service role bypasses
-- RLS), matching SessionHandoffToken and the sibling auth-token tables.
ALTER TABLE "SocialSignupTicket" ENABLE ROW LEVEL SECURITY;
