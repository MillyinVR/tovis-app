-- K16: one pro's booking policy for ONE client.
--
-- The "difficult clients" half of the release-forms ask, deliberately NOT
-- modelled as a waiver. A waiver is a document a client signs; a judgement about
-- a person is not, and modelling it as one produces a signed legal artifact that
-- encodes that judgement.
--
-- 🔴 EXPLICIT SWITCHES, NEVER FREE TEXT. There is no `reason` column here and
-- there must not be one: anything a pro types about a client is discoverable in
-- a dispute, while a boolean is not a characterisation. The pro's prose already
-- has a home in "ClientProfessionalNote" (DO_NOT_REBOOK carries the reason).
--
-- Additive and inert on arrival: a row exists only when a pro sets something, so
-- every existing (pro, client) pair keeps today's behaviour exactly. There is no
-- backfill, and there is nothing to backfill FROM — no column in this database
-- expressed any of these four requirements before now.

CREATE TABLE "ProClientPolicy" (
  "id"        TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  "professionalId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,

  -- Take a deposit from THIS client whatever the account-wide
  -- "ProfessionalPaymentSettings"."depositScope" says. Widens the DEPOSIT only;
  -- the platform's one-time discovery fee stays pinned to the new-via-discovery
  -- subset, exactly as K10-A pinned it against depositScope.
  "requireDeposit" BOOLEAN NOT NULL DEFAULT false,

  -- Prepay for THIS client, at this scope. NULL = no per-client prepay rule.
  -- The scope column IS the switch, mirroring
  -- "ProfessionalServiceOffering"."prepayScope": a separate boolean beside a
  -- nullable scope would be two columns encoding one fact, and they can disagree.
  "prepayScope" "OfferingPrepayScope",

  -- Require a saved card before this client can book. Gated in application code
  -- on ENABLE_NO_SHOW_PROTECTION, because the only way to COMPLY (the
  -- setup-intent route and the save-card surface) is dark behind that same flag.
  -- A requirement whose means of compliance 404s is an offered option that
  -- cannot be accepted.
  "requireCardOnFile" BOOLEAN NOT NULL DEFAULT false,

  -- This client cannot book a NEW appointment themselves: hold creation and the
  -- aftercare-rebook token path both refuse.
  --
  -- 🔴 It deliberately does NOT refuse rescheduling an appointment that already
  -- exists, or confirming a waitlist offer the pro explicitly sent. Those are
  -- appointments the pro already agreed to; refusing them would strand a
  -- confirmed booking and 400 the Reschedule button inside K12's own reminder.
  "blockSelfServeBooking" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "ProClientPolicy_pkey" PRIMARY KEY ("id")
);

-- One policy per (pro, client) pair. The resolver reads at most one row; a
-- second row would make "the policy" ambiguous on a money path.
CREATE UNIQUE INDEX "ProClientPolicy_professionalId_clientId_key"
  ON "ProClientPolicy" ("professionalId", "clientId");

-- The pro-facing list ("who have I set something for?") reads this way.
CREATE INDEX "ProClientPolicy_professionalId_updatedAt_idx"
  ON "ProClientPolicy" ("professionalId", "updatedAt");

-- CASCADE on both sides: the policy is a statement BY one pro ABOUT one client
-- and is meaningless once either party is gone. Nothing else points at this row,
-- so nothing is orphaned by its removal — unlike a consent signature, this is
-- not an artifact anyone needs to keep.
ALTER TABLE "ProClientPolicy"
  ADD CONSTRAINT "ProClientPolicy_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProClientPolicy"
  ADD CONSTRAINT "ProClientPolicy_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "ClientProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The refusal codes this step adds are BookingErrorCode string literals in
-- lib/booking/errors.ts, not a database enum, so there is no ALTER TYPE here.
