-- W5: the client's consent to a professional seeing their chart.
--
-- `lib/clientVisibility.ts` treated a bare MessageThread as a reason to open the
-- whole chart, open-ended, and no consumer branched on the reason — so a single
-- message granted byte-identical read AND WRITE access to notes, allergies,
-- formulas, consent records, photo release, the technical record, service
-- addresses, do-not-rebook, policy and date of birth. Joining a waitlist did it
-- too, because `seedWaitlistThread` auto-creates the thread: a client who never
-- messaged anyone handed over their whole chart by tapping "notify me".
--
-- 🔴🔴 THIS MIGRATION DOES NOT GRANDFATHER ANYONE.
--
-- It creates an EMPTY table. Every pro whose only link to a client is a message
-- thread loses chart access the moment the code ships. That is the correct
-- default for a consent feature — access nobody consented to is not a right —
-- and it is what the audit recommends, but it is a VISIBLE change for pros who
-- have that access today, and it is Tori's call.
--
-- If the call goes the other way, `scripts/w5-grandfather-chart-shares.mjs`
-- inserts a GRANTED row for every existing thread-only pair. It is dry-run by
-- default and deliberately NOT wired into this migration: granting consent on
-- a client's behalf is not something a deploy should do unattended.
--
-- Pros keep access to every client they have a real BOOKING with, which is
-- unchanged and is the overwhelming majority of the relationships that matter.

CREATE TYPE "ClientChartShareStatus" AS ENUM (
  'REQUESTED',
  'GRANTED',
  'DECLINED',
  'REVOKED'
);

CREATE TABLE "ClientChartShare" (
  "id"             TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "clientId"       TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "status"         "ClientChartShareStatus" NOT NULL,
  "requestedAt"    TIMESTAMP(3),
  "respondedAt"    TIMESTAMP(3),
  "revokedAt"      TIMESTAMP(3),

  CONSTRAINT "ClientChartShare_pkey" PRIMARY KEY ("id")
);

-- One share per pair. "May this pro see this chart right now" must have exactly
-- one answer; a second row would make it ambiguous on a path that reads a
-- medical record.
CREATE UNIQUE INDEX "ClientChartShare_clientId_professionalId_key"
  ON "ClientChartShare" ("clientId", "professionalId");

CREATE INDEX "ClientChartShare_professionalId_status_idx"
  ON "ClientChartShare" ("professionalId", "status");

CREATE INDEX "ClientChartShare_clientId_status_idx"
  ON "ClientChartShare" ("clientId", "status");

-- CASCADE on both sides: a share is meaningless without either party, and it
-- must never be the thing that blocks deleting an account.
ALTER TABLE "ClientChartShare"
  ADD CONSTRAINT "ClientChartShare_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "ClientProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientChartShare"
  ADD CONSTRAINT "ClientChartShare_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
