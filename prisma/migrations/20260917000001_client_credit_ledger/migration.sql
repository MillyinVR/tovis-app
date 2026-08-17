-- Platform-funded client credit: the ledger behind "You earned $7.50 credit ·
-- $30 banked total" on /client/activity and the "Use my credit" toggle at
-- client checkout.
--
-- Tori's settled numbers (2026-08-17): 3% of the booking's service subtotal ·
-- minted ON COMPLETION · funded by the PLATFORM (the pro's payout is untouched)
-- · spent via a manual per-booking toggle.
--
-- 🔴 This is NOT the existing referral reward. `Referral` +
-- `ProfessionalPaymentSettings.referralReward*` is pro-configured, PRO-funded,
-- client→client and per-pro opt-in. Nothing here shares a column, a table or a
-- code path with it, deliberately: collapsing them would merge two different
-- funders into one rail.
--
-- Additive only — two enums and one table — so it is safe to run ahead of its
-- readers. With no rows, the balance is zero, the banner renders nothing and the
-- checkout toggle does not appear.

CREATE TYPE "ClientCreditEntryKind" AS ENUM ('EARNED_LOOK_BOOKING', 'SPENT_ON_BOOKING');
CREATE TYPE "ClientCreditEntryStatus" AS ENUM ('PENDING', 'APPLIED', 'RELEASED');

CREATE TABLE "ClientCreditEntry" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "ClientCreditEntryKind" NOT NULL,
    "status" "ClientCreditEntryStatus" NOT NULL DEFAULT 'APPLIED',
    "amount" DECIMAL(10,2) NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sourceLookPostId" TEXT,
    "platformTopUpAt" TIMESTAMP(3),
    "platformTopUpTransferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCreditEntry_pkey" PRIMARY KEY ("id")
);

-- 🔴 Mint exactly once, spend at most once — enforced HERE rather than by
-- application bookkeeping. The completion path runs more than once for the same
-- booking (pro closeout, aftercare send, the Stripe webhook), and a
-- check-then-insert races itself. See lib/credit/creatorCredit.ts.
CREATE UNIQUE INDEX "ClientCreditEntry_bookingId_kind_key"
  ON "ClientCreditEntry"("bookingId", "kind");

-- One Stripe transfer can settle at most one spend.
CREATE UNIQUE INDEX "ClientCreditEntry_platformTopUpTransferId_key"
  ON "ClientCreditEntry"("platformTopUpTransferId");

-- The balance read: everything counting for or against one client.
CREATE INDEX "ClientCreditEntry_clientId_status_idx"
  ON "ClientCreditEntry"("clientId", "status");

-- The top-up drain: spends that settled but whose pro has not been made whole.
CREATE INDEX "ClientCreditEntry_kind_status_platformTopUpAt_idx"
  ON "ClientCreditEntry"("kind", "status", "platformTopUpAt");

ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_sourceLookPostId_fkey"
  FOREIGN KEY ("sourceLookPostId") REFERENCES "LookPost"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Money moves in one direction per row and the direction is `kind`. A signed
-- amount would let one bad write turn a spend into a mint; a zero amount is a
-- ledger row that says nothing happened.
ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_amount_positive"
  CHECK ("amount" > 0);

-- An EARNED row is minted from a terminal booking state, so it has no lifecycle
-- to be in the middle of, and it never funds a transfer. Both halves stated at
-- the database so a future writer cannot invent a PENDING mint or attach a
-- top-up to one.
ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_earned_is_terminal"
  CHECK (
    "kind" <> 'EARNED_LOOK_BOOKING'
    OR ("status" = 'APPLIED' AND "platformTopUpAt" IS NULL AND "platformTopUpTransferId" IS NULL)
  );

-- Only an EARNED row cites the look that produced it.
ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_source_look_is_earned_only"
  CHECK ("kind" = 'EARNED_LOOK_BOOKING' OR "sourceLookPostId" IS NULL);

-- The settled timestamp and the transfer that settled it are one fact. A
-- timestamp with no transfer id is an unauditable claim that the pro was paid.
ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_top_up_is_paired"
  CHECK (("platformTopUpAt" IS NULL) = ("platformTopUpTransferId" IS NULL));

-- 🔴 A top-up may only exist against a spend that actually settled. Paying a pro
-- for a PENDING (quoted, unpaid) or RELEASED (abandoned) checkout would move
-- real platform money for a bill nobody paid.
ALTER TABLE "ClientCreditEntry"
  ADD CONSTRAINT "ClientCreditEntry_top_up_requires_applied"
  CHECK ("platformTopUpAt" IS NULL OR "status" = 'APPLIED');

-- 🔴 Every table in this database carries RLS; a new one that omits it is
-- readable by any role the app's connection can assume. No policy is added: all
-- access goes through the app's own scoping (the Prisma service role bypasses
-- RLS), matching ClientCreatorStat and the sibling client-owned tables.
ALTER TABLE "ClientCreditEntry" ENABLE ROW LEVEL SECURITY;
