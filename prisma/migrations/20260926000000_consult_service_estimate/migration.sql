-- Book the Look, slice B3: the TRANSLATION MODULE's output — a line-item
-- service estimate for a LOOK-anchored consult, priced entirely off that pro's
-- own menu (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 6, 7 and 11).
--
-- ADDITIVE ONLY. Two new tables and three new enums; nothing existing is
-- dropped, re-typed or repurposed. Consult stays forward-only.
--
-- The load-bearing choices below are the two guards at the end:
--
--   * the SCOPE guard, which refuses an estimate that does not belong to its
--     own consult's professional, or that pins a revision belonging to another
--     session or of the wrong kind — the pin is what makes a correction pair
--     interpretable later, so a wrong pin is worse than no estimate;
--
--   * the IMMUTABILITY guard, which freezes the AI half of every line while
--     leaving the pro-final half writable. Decision 7 makes (AI estimate, pro
--     final) per line the training signal for price AND duration accuracy. That
--     signal is worth exactly nothing if the estimate half can be rewritten to
--     agree with the correction, so the database refuses it rather than trusting
--     every future writer to remember.

CREATE TYPE "ConsultServiceEstimateStatus" AS ENUM ('ESTIMATED', 'REFUSED');

CREATE TYPE "ConsultServiceEstimateRefusalCode" AS ENUM (
  'LOOK_SERVICE_UNLINKED',
  'SERVICE_NOT_ON_MENU',
  'MENU_MODE_UNAVAILABLE',
  'MENU_PRICE_UNSET',
  'MENU_DURATION_UNSET',
  'PRO_SCHEDULING_NOT_READY'
);

CREATE TYPE "ConsultServiceEstimateLineSource" AS ENUM (
  'LOOK_LINKED_SERVICE',
  'ANALYSIS_RECOMMENDATION'
);

CREATE TABLE "ConsultServiceEstimate" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "sourceAnalysisRevisionId" TEXT NOT NULL,
  "status" "ConsultServiceEstimateStatus" NOT NULL,
  "refusalCode" "ConsultServiceEstimateRefusalCode",
  "locationType" "ServiceLocationType" NOT NULL,
  "stepMinutes" INTEGER,
  "bufferMinutes" INTEGER,
  "schemaVersion" INTEGER NOT NULL,
  "derivationVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConsultServiceEstimate_pkey" PRIMARY KEY ("id")
);

-- A refusal names its reason; an estimate never carries one. Without this the
-- two states could disagree in the same row and every reader would have to
-- pick which field to believe.
ALTER TABLE "ConsultServiceEstimate"
  ADD CONSTRAINT "ConsultServiceEstimate_refusal_shape" CHECK (
    ("status" = 'ESTIMATED' AND "refusalCode" IS NULL)
    OR ("status" = 'REFUSED' AND "refusalCode" IS NOT NULL)
  );

-- Scheduling facts are present exactly when a bookable location was found.
-- PRO_SCHEDULING_NOT_READY is the one refusal that has neither.
ALTER TABLE "ConsultServiceEstimate"
  ADD CONSTRAINT "ConsultServiceEstimate_scheduling_shape" CHECK (
    (
      "refusalCode" = 'PRO_SCHEDULING_NOT_READY'
      AND "stepMinutes" IS NULL AND "bufferMinutes" IS NULL
    ) OR (
      "refusalCode" IS DISTINCT FROM 'PRO_SCHEDULING_NOT_READY'
      AND "stepMinutes" IS NOT NULL AND "bufferMinutes" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "ConsultServiceEstimate_consultSessionId_key"
  ON "ConsultServiceEstimate" ("consultSessionId");
CREATE INDEX "ConsultServiceEstimate_professionalId_createdAt_idx"
  ON "ConsultServiceEstimate" ("professionalId", "createdAt");
-- Prisma does not index foreign keys. Both of these back a Restrict/Cascade
-- check on the referenced side, which would otherwise sequential-scan.
CREATE INDEX "ConsultServiceEstimate_sourceAnalysisRevisionId_idx"
  ON "ConsultServiceEstimate" ("sourceAnalysisRevisionId");

ALTER TABLE "ConsultServiceEstimate"
  ADD CONSTRAINT "ConsultServiceEstimate_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultServiceEstimate"
  ADD CONSTRAINT "ConsultServiceEstimate_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultServiceEstimate"
  ADD CONSTRAINT "ConsultServiceEstimate_sourceAnalysisRevisionId_fkey"
  FOREIGN KEY ("sourceAnalysisRevisionId") REFERENCES "ConsultRevision"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ConsultServiceEstimateLine" (
  "id" TEXT NOT NULL,
  "estimateId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  -- Snapshot links, NOT foreign keys: a pro removing a service from her menu
  -- must never be blocked by, or silently rewrite, a record of what was once
  -- estimated. Same reason ConsultSession."anchorLookPostId" is one.
  "serviceId" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "serviceName" TEXT NOT NULL,
  "source" "ConsultServiceEstimateLineSource" NOT NULL,
  "rationale" TEXT NOT NULL,
  "estimatedPrice" DECIMAL(10,2) NOT NULL,
  "estimatedDurationMinutes" INTEGER NOT NULL,
  -- The pro's correction. B5/B6 writes these; B3 only makes the place.
  "proFinalPrice" DECIMAL(10,2),
  "proFinalDurationMinutes" INTEGER,
  "proFinalNote" TEXT,
  "proFinalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConsultServiceEstimateLine_pkey" PRIMARY KEY ("id")
);

-- No invented numbers reach this table, in either half.
--
-- Zero is ALLOWED and negative is not: a complimentary service is a real menu
-- row that still takes time out of the pro's day, while a negative listed price
-- is not a price anyone meant — lib/consult/serviceEstimate.ts refuses that one
-- as MENU_PRICE_UNSET, and this is the backstop. A non-positive duration is
-- never a slot her day can hold.
ALTER TABLE "ConsultServiceEstimateLine"
  ADD CONSTRAINT "ConsultServiceEstimateLine_amounts" CHECK (
    "estimatedPrice" >= 0
    AND "estimatedDurationMinutes" > 0
    AND ("proFinalPrice" IS NULL OR "proFinalPrice" >= 0)
    AND ("proFinalDurationMinutes" IS NULL OR "proFinalDurationMinutes" > 0)
  );

CREATE UNIQUE INDEX "ConsultServiceEstimateLine_estimateId_serviceId_key"
  ON "ConsultServiceEstimateLine" ("estimateId", "serviceId");
CREATE INDEX "ConsultServiceEstimateLine_estimateId_sortOrder_idx"
  ON "ConsultServiceEstimateLine" ("estimateId", "sortOrder");
-- The price-learning read (decision 7): every correction pair for one service.
CREATE INDEX "ConsultServiceEstimateLine_serviceId_proFinalAt_idx"
  ON "ConsultServiceEstimateLine" ("serviceId", "proFinalAt");

ALTER TABLE "ConsultServiceEstimateLine"
  ADD CONSTRAINT "ConsultServiceEstimateLine_estimateId_fkey"
  FOREIGN KEY ("estimateId") REFERENCES "ConsultServiceEstimate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A REFUSED estimate has no lines, and an ESTIMATED one always has its floor.
-- DEFERRABLE because the estimate row and its lines are inserted in one
-- statement, so the parent is momentarily line-less mid-transaction.
CREATE OR REPLACE FUNCTION "consult_service_estimate_line_shape"()
RETURNS TRIGGER AS $$
DECLARE
  estimate_status public."ConsultServiceEstimateStatus";
  line_count INTEGER;
  floor_count INTEGER;
BEGIN
  SELECT "status" INTO estimate_status
  FROM public."ConsultServiceEstimate" WHERE "id" = NEW."id";

  -- The estimate was deleted later in the same transaction; its lines went
  -- with it and there is nothing left to constrain.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE "source" = 'LOOK_LINKED_SERVICE')
    INTO line_count, floor_count
  FROM public."ConsultServiceEstimateLine" WHERE "estimateId" = NEW."id";

  IF estimate_status = 'REFUSED' AND line_count <> 0 THEN
    RAISE EXCEPTION 'a refused service estimate may not carry lines'
      USING ERRCODE = '23514';
  END IF;

  IF estimate_status = 'ESTIMATED' AND floor_count <> 1 THEN
    RAISE EXCEPTION 'a service estimate must carry exactly one floor line'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_service_estimate_line_shape"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultServiceEstimate_line_shape"
  AFTER INSERT ON "ConsultServiceEstimate"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_service_estimate_line_shape"();

-- Scope: the estimate belongs to its consult's professional, that consult has
-- actually completed, and the pinned revision is this session's own ANALYSIS.
CREATE OR REPLACE FUNCTION "consult_service_estimate_scope_guard"()
RETURNS TRIGGER AS $$
DECLARE
  session_professional_id TEXT;
  session_status public."ConsultSessionStatus";
  session_anchor_look_id TEXT;
  revision_session_id TEXT;
  revision_kind public."ConsultRevisionKind";
BEGIN
  SELECT "professionalId", "status", "anchorLookPostId"
    INTO session_professional_id, session_status, session_anchor_look_id
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  SELECT "consultSessionId", "kind"
    INTO revision_session_id, revision_kind
  FROM public."ConsultRevision"
  WHERE "id" = NEW."sourceAnalysisRevisionId";

  IF session_status IS DISTINCT FROM 'COMPLETED'
    -- Only a LOOK-anchored consult is translated. A booking-anchored one
    -- already carries real BookingServiceItem prices.
    OR session_anchor_look_id IS NULL
    OR NEW."professionalId" IS DISTINCT FROM session_professional_id
    OR revision_session_id IS DISTINCT FROM NEW."consultSessionId"
    OR revision_kind IS DISTINCT FROM 'ANALYSIS'
  THEN
    RAISE EXCEPTION 'invalid consult service estimate scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_service_estimate_scope_guard"() SET search_path = '';

CREATE TRIGGER "ConsultServiceEstimate_scope_guard"
  BEFORE INSERT ON "ConsultServiceEstimate"
  FOR EACH ROW EXECUTE FUNCTION "consult_service_estimate_scope_guard"();

-- The estimate header is a finished record; only `updatedAt` may move.
CREATE OR REPLACE FUNCTION "consult_service_estimate_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."consultSessionId" IS DISTINCT FROM OLD."consultSessionId"
    OR NEW."professionalId" IS DISTINCT FROM OLD."professionalId"
    OR NEW."sourceAnalysisRevisionId" IS DISTINCT FROM OLD."sourceAnalysisRevisionId"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."refusalCode" IS DISTINCT FROM OLD."refusalCode"
    OR NEW."locationType" IS DISTINCT FROM OLD."locationType"
    OR NEW."stepMinutes" IS DISTINCT FROM OLD."stepMinutes"
    OR NEW."bufferMinutes" IS DISTINCT FROM OLD."bufferMinutes"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."derivationVersion" IS DISTINCT FROM OLD."derivationVersion"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'consult service estimate is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_service_estimate_immutable"() SET search_path = '';

CREATE TRIGGER "ConsultServiceEstimate_immutable"
  BEFORE UPDATE ON "ConsultServiceEstimate"
  FOR EACH ROW EXECUTE FUNCTION "consult_service_estimate_immutable"();

-- The correction pair, protected. Everything the AI derived is frozen; the
-- pro-final half and `updatedAt` are the only columns an UPDATE may move.
CREATE OR REPLACE FUNCTION "consult_service_estimate_line_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."estimateId" IS DISTINCT FROM OLD."estimateId"
    OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder"
    OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId"
    OR NEW."offeringId" IS DISTINCT FROM OLD."offeringId"
    OR NEW."serviceName" IS DISTINCT FROM OLD."serviceName"
    OR NEW."source" IS DISTINCT FROM OLD."source"
    OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
    OR NEW."estimatedPrice" IS DISTINCT FROM OLD."estimatedPrice"
    OR NEW."estimatedDurationMinutes" IS DISTINCT FROM OLD."estimatedDurationMinutes"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'the AI half of a service estimate line is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_service_estimate_line_immutable"() SET search_path = '';

CREATE TRIGGER "ConsultServiceEstimateLine_immutable"
  BEFORE UPDATE ON "ConsultServiceEstimateLine"
  FOR EACH ROW EXECUTE FUNCTION "consult_service_estimate_line_immutable"();

-- Every new public table needs its OWN grant. RLS propagates from nowhere;
-- only tests/integration/database-hardening.test.ts catches the omission.
ALTER TABLE "ConsultServiceEstimate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsultServiceEstimateLine" ENABLE ROW LEVEL SECURITY;
