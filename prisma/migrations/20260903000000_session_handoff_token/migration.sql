-- One-time sign-in hand-off token (native session → browser session).
--
-- Additive only: one new table, no changes to existing columns or data.
--
-- ⚠️ Timestamp note: two sibling branches in flight both claimed
-- `20260902000000` (chart-access-notification-events, waitlist-offer-expiry),
-- so this deliberately takes `20260903000000` to sort after both rather than
-- adding a third row to that collision.
--
-- ⚠️ RLS: `20260901000000_enable_rls_and_pin_function_search_path` enabled RLS
-- by iterating the tables that existed WHEN IT RAN. It is a point-in-time act,
-- so a table created afterwards does not inherit it — this one must turn it on
-- itself, and does so below. `tests/integration/database-hardening.test.ts` is
-- the standing guard that fails if it is ever omitted. RLS with no policies is
-- deny-all for every non-BYPASSRLS role, which is exactly right for a table
-- that mints sessions: Prisma connects as a BYPASSRLS role and is unaffected,
-- and any future PostgREST/anon path fails closed instead of reading the
-- token hashes.

-- CreateTable
CREATE TABLE "SessionHandoffToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "redirectPath" VARCHAR(512) NOT NULL,
    "actingRole" "Role" NOT NULL,
    "authVersionAtIssue" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "issuedIp" TEXT,
    "issuedUserAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionHandoffToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionHandoffToken_tokenHash_key" ON "SessionHandoffToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SessionHandoffToken_userId_createdAt_idx" ON "SessionHandoffToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionHandoffToken_expiresAt_idx" ON "SessionHandoffToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "SessionHandoffToken" ADD CONSTRAINT "SessionHandoffToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EnableRowLevelSecurity (see the note at the top of this file)
ALTER TABLE "SessionHandoffToken" ENABLE ROW LEVEL SECURITY;
