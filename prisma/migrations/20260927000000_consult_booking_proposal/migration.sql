-- Book the Look, slice B4: the BOOKING PROPOSAL — what a client actually
-- committed to (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 3, 4 and 5).
--
-- ADDITIVE ONLY. One nullable column on "Booking", two new tables, no new enum
-- types; nothing existing is dropped, re-typed or repurposed. Consult stays
-- forward-only.
--
-- WHY A SEPARATE TABLE AND NOT JUST THE ESTIMATE.
-- A "ConsultServiceEstimate" is priced in the SALON column, because a
-- look-anchored consult has not chosen a mode yet. B4 is where the client
-- chooses, and a hand-configured pro's mobile column can differ from her salon
-- one. Reusing the estimate's numbers for a mobile booking would present a
-- salon price for a mobile appointment, and would make decision 7's correction
-- pair compare a pro's mobile final against a salon figure the client never
-- saw. So every line is RE-DERIVED under the chosen mode and stored here.
--
-- The load-bearing choices are the guards at the end. Two of them are worth
-- calling out, because they turn claims this feature makes in prose into facts
-- the database will not let a future writer break:
--
--   * the TOTALS guard: "totalDurationMinutes" must equal the sum of the line
--     durations and "startingAtPrice" the sum of the line prices. The whole
--     point of this slice is that the slot is sized by the ESTIMATE rather than
--     by the base offering's default; a header total that could drift from its
--     own lines would let that promise quietly stop being true.
--
--   * the PROVENANCE guard: the proposal's consult and estimate must be the
--     ones stamped on its own booking, and the estimate must belong to that
--     consult. Provenance that can disagree with itself is not provenance.

-- ── Booking gains the estimate reference ─────────────────────────────────────
--
-- "sourceConsultSessionId" (shipped) says which consult informed a booking.
-- This says which DERIVATION of it produced the lines and the slot width.
-- Stamped by the write boundary at the moment it knows the answer
-- ([[nothing-stored-says-who-created-a-booking]]); nullable and defaulted to
-- NULL, so no existing row changes meaning.
ALTER TABLE "Booking" ADD COLUMN "sourceConsultServiceEstimateId" TEXT;

CREATE INDEX "Booking_sourceConsultServiceEstimateId_idx"
  ON "Booking" ("sourceConsultServiceEstimateId");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_sourceConsultServiceEstimateId_fkey"
  FOREIGN KEY ("sourceConsultServiceEstimateId") REFERENCES "ConsultServiceEstimate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── The proposal ─────────────────────────────────────────────────────────────

CREATE TABLE "ConsultBookingProposal" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "estimateId" TEXT NOT NULL,
  "locationType" "ServiceLocationType" NOT NULL,
  "stepMinutes" INTEGER NOT NULL,
  "bufferMinutes" INTEGER NOT NULL,
  "totalDurationMinutes" INTEGER NOT NULL,
  "startingAtPrice" DECIMAL(10,2) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "derivationVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConsultBookingProposal_pkey" PRIMARY KEY ("id")
);

-- Zero is allowed for money and never for time, exactly as the estimate line's
-- own CHECK has it: a complimentary service is a real menu row that still takes
-- time out of the pro's day, so a $0 proposal is possible and a 0-minute one is
-- not. A buffer of zero is a normal pro configuration.
ALTER TABLE "ConsultBookingProposal"
  ADD CONSTRAINT "ConsultBookingProposal_amounts" CHECK (
    "startingAtPrice" >= 0
    AND "totalDurationMinutes" > 0
    AND "stepMinutes" > 0
    AND "bufferMinutes" >= 0
  );

CREATE UNIQUE INDEX "ConsultBookingProposal_bookingId_key"
  ON "ConsultBookingProposal" ("bookingId");
CREATE INDEX "ConsultBookingProposal_consultSessionId_createdAt_idx"
  ON "ConsultBookingProposal" ("consultSessionId", "createdAt");
-- Prisma does not index foreign keys; this one backs a RESTRICT on the
-- referenced side, which would otherwise sequential-scan.
CREATE INDEX "ConsultBookingProposal_estimateId_idx"
  ON "ConsultBookingProposal" ("estimateId");

ALTER TABLE "ConsultBookingProposal"
  ADD CONSTRAINT "ConsultBookingProposal_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultBookingProposal"
  ADD CONSTRAINT "ConsultBookingProposal_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultBookingProposal"
  ADD CONSTRAINT "ConsultBookingProposal_estimateId_fkey"
  FOREIGN KEY ("estimateId") REFERENCES "ConsultServiceEstimate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ConsultBookingProposalLine" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  -- The estimate line this was re-derived from, so the (salon estimate,
  -- mode-reconciled proposal, pro final) chain stays walkable. A snapshot link
  -- for the same reason the service/offering links below are.
  "estimateLineId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "serviceId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "source" "ConsultServiceEstimateLineSource" NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsultBookingProposalLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ConsultBookingProposalLine"
  ADD CONSTRAINT "ConsultBookingProposalLine_amounts" CHECK (
    "price" >= 0 AND "durationMinutes" > 0
  );

CREATE UNIQUE INDEX "ConsultBookingProposalLine_proposalId_serviceId_key"
  ON "ConsultBookingProposalLine" ("proposalId", "serviceId");
CREATE INDEX "ConsultBookingProposalLine_proposalId_sortOrder_idx"
  ON "ConsultBookingProposalLine" ("proposalId", "sortOrder");
CREATE INDEX "ConsultBookingProposalLine_estimateLineId_idx"
  ON "ConsultBookingProposalLine" ("estimateLineId");

ALTER TABLE "ConsultBookingProposalLine"
  ADD CONSTRAINT "ConsultBookingProposalLine_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "ConsultBookingProposal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Guards ───────────────────────────────────────────────────────────────────

-- Provenance that cannot disagree with itself: the proposal's consult and
-- estimate are the ones stamped on its own booking, and the estimate belongs to
-- that consult and actually produced lines.
--
-- A REFUSED estimate reaching this table would be the exact failure the slice
-- is written to prevent — a refusal quietly falling back to a booking — so it
-- is refused here as well as in lib/consult/bookingProposal.ts.
CREATE OR REPLACE FUNCTION "consult_booking_proposal_scope_guard"()
RETURNS TRIGGER AS $$
DECLARE
  booking_consult_id TEXT;
  booking_estimate_id TEXT;
  estimate_consult_id TEXT;
  estimate_status public."ConsultServiceEstimateStatus";
BEGIN
  SELECT "sourceConsultSessionId", "sourceConsultServiceEstimateId"
    INTO booking_consult_id, booking_estimate_id
  FROM public."Booking" WHERE "id" = NEW."bookingId";

  SELECT "consultSessionId", "status"
    INTO estimate_consult_id, estimate_status
  FROM public."ConsultServiceEstimate" WHERE "id" = NEW."estimateId";

  IF booking_consult_id IS DISTINCT FROM NEW."consultSessionId"
    OR booking_estimate_id IS DISTINCT FROM NEW."estimateId"
    OR estimate_consult_id IS DISTINCT FROM NEW."consultSessionId"
    OR estimate_status IS DISTINCT FROM 'ESTIMATED'
  THEN
    RAISE EXCEPTION 'invalid consult booking proposal scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_booking_proposal_scope_guard"() SET search_path = '';

CREATE TRIGGER "ConsultBookingProposal_scope_guard"
  BEFORE INSERT ON "ConsultBookingProposal"
  FOR EACH ROW EXECUTE FUNCTION "consult_booking_proposal_scope_guard"();

-- The header's totals ARE its lines, and a proposal always carries the floor.
--
-- DEFERRABLE because the proposal row and its lines are inserted in one
-- transaction, so the parent is momentarily line-less. Same shape as B3's
-- "ConsultServiceEstimate_line_shape".
CREATE OR REPLACE FUNCTION "consult_booking_proposal_totals"()
RETURNS TRIGGER AS $$
DECLARE
  line_count INTEGER;
  floor_count INTEGER;
  duration_sum INTEGER;
  price_sum NUMERIC;
  header_duration INTEGER;
  header_price NUMERIC;
BEGIN
  SELECT "totalDurationMinutes", "startingAtPrice"
    INTO header_duration, header_price
  FROM public."ConsultBookingProposal" WHERE "id" = NEW."id";

  -- The proposal was deleted later in the same transaction; its lines went with
  -- it and there is nothing left to constrain.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE "source" = 'LOOK_LINKED_SERVICE'),
    coalesce(sum("durationMinutes"), 0),
    coalesce(sum("price"), 0)
  INTO line_count, floor_count, duration_sum, price_sum
  FROM public."ConsultBookingProposalLine" WHERE "proposalId" = NEW."id";

  IF line_count = 0 THEN
    RAISE EXCEPTION 'a booking proposal must carry at least one line'
      USING ERRCODE = '23514';
  END IF;

  IF floor_count <> 1 THEN
    RAISE EXCEPTION 'a booking proposal must carry exactly one floor line'
      USING ERRCODE = '23514';
  END IF;

  IF header_duration IS DISTINCT FROM duration_sum THEN
    RAISE EXCEPTION 'a booking proposal total duration must equal its lines'
      USING ERRCODE = '23514';
  END IF;

  IF header_price IS DISTINCT FROM price_sum THEN
    RAISE EXCEPTION 'a booking proposal starting price must equal its lines'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_booking_proposal_totals"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultBookingProposal_totals"
  AFTER INSERT ON "ConsultBookingProposal"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_booking_proposal_totals"();

-- A proposal is the record of one commitment a person made. Only `updatedAt`
-- may move; correcting a price is B5's job and lands on the ESTIMATE line's
-- pro-final half, never by rewriting what the client agreed to.
CREATE OR REPLACE FUNCTION "consult_booking_proposal_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
    OR NEW."consultSessionId" IS DISTINCT FROM OLD."consultSessionId"
    OR NEW."estimateId" IS DISTINCT FROM OLD."estimateId"
    OR NEW."locationType" IS DISTINCT FROM OLD."locationType"
    OR NEW."stepMinutes" IS DISTINCT FROM OLD."stepMinutes"
    OR NEW."bufferMinutes" IS DISTINCT FROM OLD."bufferMinutes"
    OR NEW."totalDurationMinutes" IS DISTINCT FROM OLD."totalDurationMinutes"
    OR NEW."startingAtPrice" IS DISTINCT FROM OLD."startingAtPrice"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."derivationVersion" IS DISTINCT FROM OLD."derivationVersion"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'consult booking proposal is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_booking_proposal_immutable"() SET search_path = '';

CREATE TRIGGER "ConsultBookingProposal_immutable"
  BEFORE UPDATE ON "ConsultBookingProposal"
  FOR EACH ROW EXECUTE FUNCTION "consult_booking_proposal_immutable"();

-- Wholly immutable: the line has no pro-final half to write, and the header's
-- totals guard is only meaningful if the lines it summed cannot move afterwards.
CREATE OR REPLACE FUNCTION "consult_booking_proposal_line_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'consult booking proposal lines are immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_booking_proposal_line_immutable"() SET search_path = '';

CREATE TRIGGER "ConsultBookingProposalLine_immutable"
  BEFORE UPDATE ON "ConsultBookingProposalLine"
  FOR EACH ROW EXECUTE FUNCTION "consult_booking_proposal_line_immutable"();

-- Every new public table needs its OWN grant. RLS propagates from nowhere; only
-- tests/integration/database-hardening.test.ts catches the omission.
ALTER TABLE "ConsultBookingProposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultBookingProposalLine" ENABLE ROW LEVEL SECURITY;
