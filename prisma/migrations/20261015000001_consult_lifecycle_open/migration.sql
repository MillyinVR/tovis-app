-- P7a-3, slice 2 of 2 — run-complete ≠ consult-closed.
--
-- Until now a completed analysis CLOSED the consult: COMPLETED was terminal in
-- the lifecycle guard, every content window was pinned to MEDIA_READY, and "one
-- ANALYSIS revision per consult" was a database fact. The Sept 5 flow says the
-- opposite — the consult is a living document until the APPOINTMENT: intake,
-- inspiration and capture stay revisable, every change makes a revision, and a
-- rerun produces a new plan version.
--
-- 🔴 The session STAYS in COMPLETED throughout, and that is what keeps this
-- migration small. A rerun performs no lifecycle transition at all, so the two
-- once-per-consult transition indexes
-- (`ConsultAuditEvent_one_analysis_claim_transition`,
--  `ConsultAuditEvent_one_analysis_complete_transition`) are never touched and
-- keep meaning exactly what they meant. It is the shape the P4b retry already
-- uses: the session sits still and the RUN carries the state.
--
-- ⚠️ EXPAND-ONLY EXCEPTION (authorised, Tori 2026-09-06). Sections 1 and 2 DROP
-- unique indexes. Every guard FUNCTION below is strictly expand-only — old arms
-- kept verbatim, new states added beside them — but a unique index that is
-- itself the blocker cannot be kept through the build window: while
-- `ConsultRevision_one_analysis_per_session` exists, plan v2 cannot be written
-- at all. Both drops only ever ADMIT rows previously refused, so no deployed
-- code can observe a narrowing; the pre-deploy build keeps working unchanged
-- because it never writes a second version.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A consult may hold more than one ANALYSIS revision (expand-only exception)
-- ─────────────────────────────────────────────────────────────────────────────
-- What remains, and why it is enough:
-- `ConsultRevision_consultSessionId_revision_key` keeps the sequence dense and
-- unique, and `ConsultRevision_consultSessionId_idempotencyKey_key` keeps a
-- replayed request writing exactly one row. Versions order by `revision`, which
-- lib/consult/immutableResult.ts already reads DESC.
DROP INDEX IF EXISTS "ConsultRevision_one_analysis_per_session";

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. One estimate per ANALYSIS VERSION, not per consult (expand-only exception)
-- ─────────────────────────────────────────────────────────────────────────────
-- The fact worth enforcing was never "a consult has one estimate" — it was "an
-- analysis revision is priced exactly once". Existing rows satisfy the new
-- index unchanged, because until today there was at most one per consult.
DROP INDEX IF EXISTS "ConsultServiceEstimate_consultSessionId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ConsultServiceEstimate_consultSessionId_sourceAnalysisRevisionId_key"
  ON "ConsultServiceEstimate" ("consultSessionId", "sourceAnalysisRevisionId");
CREATE INDEX IF NOT EXISTS "ConsultServiceEstimate_consultSessionId_createdAt_idx"
  ON "ConsultServiceEstimate" ("consultSessionId", "createdAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The plan-version pin
-- ─────────────────────────────────────────────────────────────────────────────
-- `requestHash` refuses a finalize whose INPUTS moved, but a hash only ever
-- says "different" — never "older". Two runs racing to publish are
-- indistinguishable by it. `planVersion` says which one is next, and the
-- partial unique index makes the answer singular even when a stale lease is
-- stolen and two workers reach finalize believing they own the same run.
--
-- Default 1 is right for every existing row: each is, or was trying to be, its
-- consult's first and only analysis.
ALTER TABLE "ConsultAnalysisRun"
  ADD COLUMN IF NOT EXISTS "planVersion" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS "ConsultAnalysisRun_one_completed_run_per_plan_version"
  ON "ConsultAnalysisRun" ("consultSessionId", "planVersion")
  WHERE "status" = 'COMPLETED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. The audit trail's shape learns the new action
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 `ConsultAuditEvent_shape` is a whitelist: every action names exactly which
-- of the seven optional columns it may set, and an action that is not listed can
-- never be inserted at all. Adding the enum label was not enough — the first
-- rerun request failed the CHECK, which is precisely what this constraint is
-- for and why it is re-issued here rather than worked around.
--
-- ANALYSIS_RERUN_REQUESTED sets NONE of them. It is the bare fact "an input
-- changed after the plan was built", and the row's own timestamp is the whole
-- of its content — which is what keeps this trail content-free.
ALTER TABLE "ConsultAuditEvent" DROP CONSTRAINT IF EXISTS "ConsultAuditEvent_shape";
ALTER TABLE "ConsultAuditEvent" ADD CONSTRAINT "ConsultAuditEvent_shape" CHECK (
  (action = 'SESSION_CREATED' AND "fromStatus" IS NULL AND "toStatus" IS NOT NULL)
  OR (action IN ('AGREEMENT_ACCEPTED', 'AGREEMENT_REVOKED') AND "agreementAcceptanceId" IS NOT NULL)
  OR (action = 'LIFECYCLE_TRANSITIONED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
  OR (action = 'REVISION_CREATED' AND "revisionId" IS NOT NULL)
  OR (action = 'CAPTURE_UPLOAD_ISSUED' AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action IN ('CAPTURE_ATTACHED', 'CAPTURE_QUALITY_CHECKED', 'CAPTURE_DELETED') AND "captureId" IS NOT NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action = 'RAW_OBJECT_PURGED' AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action IN ('INSPIRATION_SOURCE_SELECTED', 'INSPIRATION_UPLOAD_ISSUED', 'INSPIRATION_UPLOAD_ATTACHED', 'INSPIRATION_REMOVED', 'INSPIRATION_RAW_PURGED') AND "inspirationId" IS NOT NULL AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action = 'BRIEF_FEEDBACK_RECORDED' AND "briefFeedbackId" IS NOT NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR (action IN ('CLIENT_RESULTS_SERVED', 'ME_CARD_TEASER_TAPPED') AND "briefFeedbackId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  -- P7a-3, the only new arm. Everything above is byte-for-byte the shipped
  -- constraint, re-stated because a CHECK cannot be extended in place.
  OR (action = 'ANALYSIS_RERUN_REQUESTED' AND "briefFeedbackId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. "Has this consult's appointment started?", written once
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 A spark consult had NO timing rule anywhere. Every booking-time clause in
-- this schema is guarded by `ConsultSession."bookingId" IS NOT NULL`, which a
-- look-anchored consult never sets — its appointment hangs off
-- `Booking."sourceConsultSessionId"` (P7a-2). That is the whole Sept 5 flow,
-- and until this function it could take new input forever.
--
-- CANCELLED and NO_SHOW deliberately do NOT close the consult: the link is
-- released for exactly those (`Booking_sourceConsultSessionId_live_key`), the
-- client may book that look again from the same consult, and a consult she
-- cannot add to is a consult she cannot re-book from.
--
-- Mirrors lib/consult/openWindow.ts, which is the same rule for the same
-- reason at the application boundary — that one produces the message, this one
-- makes it true.
CREATE OR REPLACE FUNCTION public.consult_appointment_started(session_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."ConsultSession" s
    JOIN public."Booking" b
      ON b."id" = s."bookingId" OR b."sourceConsultSessionId" = s."id"
    WHERE s."id" = session_id
      AND b."status" NOT IN ('CANCELLED', 'NO_SHOW')
      AND (
        b."status" IN ('IN_PROGRESS', 'COMPLETED')
        OR b."scheduledFor" <= CURRENT_TIMESTAMP
      )
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The lifecycle guard: completion no longer requires disarming the inputs
-- ─────────────────────────────────────────────────────────────────────────────
-- Only ONE clause changes. The ANALYZING -> COMPLETED arm used to REQUIRE that
-- every accepted capture be purge-marked, which is how completion disarmed its
-- own inputs: `consult_revision_requires_agreements` needs at least one capture
-- that is NOT purge-marked before it will admit an ANALYSIS revision, so a
-- rerun had nothing to read even with every window below widened.
--
-- Minimum retention (Tori, 2026-09-06): with chart-copy consent the captures
-- are kept and the purge-mark requirement does not apply. Without it, the
-- requirement stands exactly as shipped and the raw photos go at completion —
-- a card-only rerun is then refused in the app's own voice rather than served
-- from stale observations (Part 0 rule 4).
--
-- Every transition arm above is byte-identical to the shipped guard, including
-- COMPLETED -> CONSENT_REVOKED and the early-photo readiness rule.
CREATE OR REPLACE FUNCTION public.consult_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  allowed BOOLEAN;
  accepted_slot_count INTEGER;
  completed_analysis_count INTEGER;
  purge_mark_count INTEGER;
  unmarked_accepted_count INTEGER;
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  allowed := CASE OLD."status"
    WHEN 'CONSENT_REQUIRED' THEN NEW."status" IN ('EARLY_PHOTO_READY', 'INTAKE_READY', 'CANCELLED')
    WHEN 'EARLY_PHOTO_READY' THEN NEW."status" IN ('INTAKE_READY', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'INTAKE_READY' THEN NEW."status" IN ('INTAKE_IN_PROGRESS', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'INTAKE_IN_PROGRESS' THEN NEW."status" IN ('MEDIA_READY', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'MEDIA_READY' THEN NEW."status" IN ('ANALYSIS_PENDING', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'ANALYSIS_PENDING' THEN NEW."status" IN ('ANALYZING', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'ANALYZING' THEN NEW."status" IN ('ANALYSIS_PENDING', 'COMPLETED', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'COMPLETED' THEN NEW."status" = 'CONSENT_REVOKED'
    WHEN 'CONSENT_REVOKED' THEN NEW."status" IN ('CONSENT_REQUIRED', 'CANCELLED')
    WHEN 'CANCELLED' THEN FALSE
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid consult lifecycle transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IN (
    'EARLY_PHOTO_READY', 'INTAKE_READY', 'INTAKE_IN_PROGRESS', 'MEDIA_READY',
    'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
  ) AND NOT public."consult_current_agreements_active"(NEW."id") THEN
    RAISE EXCEPTION 'current consent and 18+ attestation are required for lifecycle transition'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'EARLY_PHOTO_READY' AND NEW."status" = 'INTAKE_READY' THEN
    SELECT count(*) INTO accepted_slot_count
    FROM public."ConsultCapture"
    WHERE "consultSessionId" = NEW."id"
      AND "shotKey" = 'early_photo'
      AND "status" = 'ACCEPTED'
      AND "purgedAt" IS NULL
      AND "rawExpiresAt" > CURRENT_TIMESTAMP;
    IF accepted_slot_count < 1 THEN
      RAISE EXCEPTION 'leaving the early photo stage requires one accepted unexpired early photo'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."status" = 'MEDIA_READY' AND NEW."status" = 'ANALYSIS_PENDING' THEN
    SELECT count(DISTINCT "shotKey") INTO accepted_slot_count
    FROM public."ConsultCapture"
    WHERE "consultSessionId" = NEW."id"
      AND "status" = 'ACCEPTED'
      AND "purgedAt" IS NULL
      AND "rawExpiresAt" > CURRENT_TIMESTAMP;
    IF accepted_slot_count < 1 OR NOT public."consult_current_inspiration_complete"(NEW."id") THEN
      RAISE EXCEPTION 'analysis requires at least one accepted unexpired capture'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."status" = 'ANALYZING' AND NEW."status" = 'COMPLETED' THEN
    SELECT count(*)::integer INTO completed_analysis_count
    FROM public."ConsultRevision"
    WHERE "consultSessionId" = NEW."id"
      AND "kind" = 'ANALYSIS'
      AND "revision" = NEW."revisionSequence";
    SELECT count(DISTINCT "shotKey")::integer INTO purge_mark_count
    FROM public."ConsultCapture"
    WHERE "consultSessionId" = NEW."id"
      AND "status" = 'ACCEPTED'
      AND "purgeEligibleAt" IS NOT NULL
      AND "purgeRequestedAt" IS NOT NULL
      AND "purgedAt" IS NULL;
    SELECT count(*)::integer INTO unmarked_accepted_count
    FROM public."ConsultCapture"
    WHERE "consultSessionId" = NEW."id"
      AND "status" = 'ACCEPTED'
      AND "purgedAt" IS NULL
      AND "rawExpiresAt" > CURRENT_TIMESTAMP
      AND ("purgeEligibleAt" IS NULL OR "purgeRequestedAt" IS NULL);
    -- P7a-3: the analysis-revision requirement is unconditional as before; the
    -- purge requirements now apply only when the client did NOT keep her
    -- photos. `chartCopyOptIn` defaults true, so this reads off the row rather
    -- than off a second table nobody would think to look in.
    IF completed_analysis_count <> 1
      OR (
        NOT NEW."chartCopyOptIn"
        AND (purge_mark_count < 1 OR unmarked_accepted_count <> 0)
      )
    THEN
      RAISE EXCEPTION 'completed analysis requires one current revision and every accepted capture purge-marked'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Content revisions live until the appointment
-- ─────────────────────────────────────────────────────────────────────────────
-- Expand-only: each state list gains the post-analysis states beside the ones
-- it already had. EARLY_PHOTO_READY is deliberately still NOT in the INTAKE
-- arm — answering the first intake question is what closes the early stage
-- (P7a-1), and admitting it here would let the intake land in front of the
-- photo that unlocks the booking.
--
-- The new refusal is the APPOINTMENT, applied to every sensitive revision and
-- to both anchors. The booking-anchored clause below it is untouched.
CREATE OR REPLACE FUNCTION public.consult_revision_requires_agreements()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  session_status public."ConsultSessionStatus";
  session_sequence INTEGER;
  booking_status public."BookingStatus";
  booking_scheduled_for TIMESTAMP(3);
  current_intake_count INTEGER;
  current_capture_count INTEGER;
BEGIN
  SELECT session."status", session."revisionSequence", booking."status", booking."scheduledFor"
    INTO session_status, session_sequence, booking_status, booking_scheduled_for
  FROM public."ConsultSession" AS session
  LEFT JOIN public."Booking" AS booking ON booking."id" = session."bookingId"
  WHERE session."id" = NEW."consultSessionId";

  IF session_status IS NULL THEN
    RAISE EXCEPTION 'consult session not found for revision'
      USING ERRCODE = '23514';
  END IF;
  IF NOT public."consult_current_agreements_active"(NEW."consultSessionId") THEN
    RAISE EXCEPTION 'current consent and 18+ attestation are required before sensitive consult revisions'
      USING ERRCODE = '23514';
  END IF;
  IF session_status IN ('CONSENT_REQUIRED', 'CONSENT_REVOKED', 'CANCELLED') THEN
    RAISE EXCEPTION 'consult lifecycle does not permit sensitive revisions in state %', session_status
      USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'INTAKE'
    AND session_status NOT IN (
      'INTAKE_READY', 'INTAKE_IN_PROGRESS', 'MEDIA_READY',
      'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
    )
  THEN
    RAISE EXCEPTION 'consult lifecycle does not permit intake revisions in state %', session_status
      USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'INSPIRATION'
    AND session_status NOT IN (
      'EARLY_PHOTO_READY', 'MEDIA_READY', 'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
    )
  THEN
    RAISE EXCEPTION 'consult lifecycle does not permit inspiration revision in state %', session_status
      USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'INSPIRATION_ANALYSIS'
    AND session_status NOT IN ('MEDIA_READY', 'ANALYZING', 'COMPLETED')
  THEN
    RAISE EXCEPTION 'consult lifecycle does not permit inspiration analysis revision in state %', session_status
      USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'ANALYSIS' AND session_status NOT IN ('ANALYZING', 'COMPLETED') THEN
    RAISE EXCEPTION 'consult lifecycle does not permit analysis revision in state %', session_status
      USING ERRCODE = '23514';
  END IF;
  IF booking_status IS NOT NULL AND (booking_status NOT IN ('PENDING', 'ACCEPTED')
    OR booking_scheduled_for <= CURRENT_TIMESTAMP
    OR booking_scheduled_for > CURRENT_TIMESTAMP + INTERVAL '90 days')
  THEN
    RAISE EXCEPTION 'consult booking is not eligible for sensitive revisions'
      USING ERRCODE = '23514';
  END IF;
  -- P7a-3: the same rule for a SPARK consult, whose appointment the clause
  -- above cannot see because it hangs off Booking."sourceConsultSessionId".
  IF public."consult_appointment_started"(NEW."consultSessionId") THEN
    RAISE EXCEPTION 'consult closed when its appointment started'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> session_sequence THEN
    RAISE EXCEPTION 'revision number must match the session revision sequence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."kind" = 'ANALYSIS' THEN
    SELECT count(*)::integer INTO current_intake_count
    FROM public."ConsultRevision" AS intake
    WHERE intake."id" = (
      SELECT latest."id"
      FROM public."ConsultRevision" AS latest
      WHERE latest."consultSessionId" = NEW."consultSessionId"
        AND latest."kind" = 'INTAKE'
      ORDER BY latest."revision" DESC
      LIMIT 1
    )
      AND intake."schemaVersion" = 2
      AND intake."payload" ->> 'packId' IN ('hair-color', 'hair-general', 'general-service')
      AND intake."payload" -> 'packVersion' IS NOT NULL
      AND intake."payload" -> 'schemaVersion' = '2'::jsonb
      AND intake."payload" -> 'complete' = 'true'::jsonb;

    SELECT count(DISTINCT capture."shotKey")::integer INTO current_capture_count
    FROM public."ConsultCapture" AS capture
    JOIN public."UploadSession" AS upload ON upload."id" = capture."uploadSessionId"
    WHERE capture."consultSessionId" = NEW."consultSessionId"
      AND capture."shotKey" IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown', 'face_front', 'face_side', 'eyes_closeup', 'area_wide', 'area_closeup', 'early_photo')
      AND capture."shotPackVersion" BETWEEN 1 AND 2
      AND capture."schemaVersion" = 1
      AND capture."status" = 'ACCEPTED'
      AND capture."qualityReasonCode" = 'PASS'
      AND capture."qualitySchemaVersion" = 1
      AND capture."qualityPromptVersion" IN ('full-analysis-capture-v2', 'full-analysis-capture-v3', 'early-photo-capture-v1')
      AND capture."storageBucket" = 'media-private'
      AND capture."storagePath" IS NOT NULL
      AND capture."rawExpiresAt" > CURRENT_TIMESTAMP
      AND capture."purgeEligibleAt" IS NULL
      AND capture."purgeRequestedAt" IS NULL
      AND capture."purgedAt" IS NULL
      AND upload."surface" = 'CLIENT_CONSULT'
      AND upload."status" = 'CONSUMED'
      AND upload."consultSessionId" = NEW."consultSessionId"
      AND upload."consultShotKey" = capture."shotKey"
      AND upload."storagePath" = capture."storagePath"
      AND upload."purgedAt" IS NULL;

    IF current_intake_count <> 1 OR current_capture_count < 1 OR NOT public."consult_current_inspiration_complete"(NEW."consultSessionId") THEN
      RAISE EXCEPTION 'analysis requires current completed intake and at least one accepted capture'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Photos: a new one until the appointment, and a longer life under consent
-- ─────────────────────────────────────────────────────────────────────────────
-- Two changes, both expand-only:
--   * the INSERT state set gains the post-analysis states (and the appointment
--     rule, because time passes between minting an upload and attaching it);
--   * `rawExpiresAt` stops being flatly immutable. It may move FORWARD, and
--     only for a consult whose client opted into chart copy — that is where the
--     retention deadline lives. Shortening a capture's life stays refused, and
--     so does extending one the client did not consent to keep.
--
-- The deadline rides on `rawExpiresAt` rather than a new column so that all six
-- `rawExpiresAt > CURRENT_TIMESTAMP` predicates in this schema keep meaning
-- "usable" without being rewritten — including the two in the guard above,
-- which is what makes a rerun on kept photos possible at all.
CREATE OR REPLACE FUNCTION public.consult_capture_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  binding_matches BOOLEAN;
  retention_allowed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT
      upload."surface" = 'CLIENT_CONSULT'
      AND upload."status" = 'PENDING'
      AND upload."consultSessionId" = NEW."consultSessionId"
      AND upload."consultShotKey" = NEW."shotKey"
      AND upload."shotPackVersion" = NEW."shotPackVersion"
      AND upload."captureSchemaVersion" = NEW."schemaVersion"
      AND upload."storageBucket" = NEW."storageBucket"
      AND upload."storagePath" = NEW."storagePath"
      AND upload."contentType" = NEW."contentType"
      AND upload."rawExpiresAt" = NEW."rawExpiresAt"
      AND session."status" IN (
        'EARLY_PHOTO_READY', 'MEDIA_READY',
        'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
      )
    INTO binding_matches
    FROM public."UploadSession" AS upload
    JOIN public."ConsultSession" AS session ON session."id" = NEW."consultSessionId"
    WHERE upload."id" = NEW."uploadSessionId";

    IF binding_matches IS DISTINCT FROM TRUE
      OR NOT public."consult_current_agreements_active"(NEW."consultSessionId")
      OR public."consult_appointment_started"(NEW."consultSessionId")
    THEN
      RAISE EXCEPTION 'capture must match an active server-minted consult upload'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  retention_allowed :=
    NEW."rawExpiresAt" > OLD."rawExpiresAt"
    AND EXISTS (
      SELECT 1 FROM public."ConsultSession"
      WHERE "id" = NEW."consultSessionId" AND "chartCopyOptIn"
    );

  IF NEW."id" <> OLD."id"
    OR NEW."consultSessionId" <> OLD."consultSessionId"
    OR NEW."uploadSessionId" <> OLD."uploadSessionId"
    OR NEW."shotKey" <> OLD."shotKey"
    OR NEW."shotPackVersion" <> OLD."shotPackVersion"
    OR NEW."schemaVersion" <> OLD."schemaVersion"
    OR NEW."contentType" <> OLD."contentType"
    OR NEW."sizeBytes" <> OLD."sizeBytes"
    OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256"
    OR NEW."attachIdempotencyKey" <> OLD."attachIdempotencyKey"
    OR NEW."attachRequestHash" <> OLD."attachRequestHash"
    OR (NEW."rawExpiresAt" <> OLD."rawExpiresAt" AND NOT retention_allowed)
  THEN
    RAISE EXCEPTION 'capture binding is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'ATTACHED' AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'capture quality decision is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."qualityCheckedAt" IS NOT NULL AND (
    NEW."qualityReasonCode" IS DISTINCT FROM OLD."qualityReasonCode"
    OR NEW."qualityWarningCode" IS DISTINCT FROM OLD."qualityWarningCode"
    OR NEW."retakeTip" IS DISTINCT FROM OLD."retakeTip"
    OR NEW."qualitySchemaVersion" IS DISTINCT FROM OLD."qualitySchemaVersion"
    OR NEW."qualityPromptVersion" IS DISTINCT FROM OLD."qualityPromptVersion"
    OR NEW."qualityModel" IS DISTINCT FROM OLD."qualityModel"
    OR NEW."qualityCheckedAt" IS DISTINCT FROM OLD."qualityCheckedAt"
    OR NEW."qualityIdempotencyKey" IS DISTINCT FROM OLD."qualityIdempotencyKey"
    OR NEW."qualityRequestHash" IS DISTINCT FROM OLD."qualityRequestHash"
  ) THEN
    RAISE EXCEPTION 'capture quality evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."purgedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'purged capture evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'ATTACHED' AND NEW."status" IN ('ACCEPTED', 'REJECTED')
    AND NOT public."consult_current_agreements_active"(NEW."consultSessionId")
  THEN
    RAISE EXCEPTION 'current prerequisites are required to finalize capture quality'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- The quality verdict may land in the widened set too. Deliberately NO
-- appointment check here: this finalizes a photo the client ALREADY sent, and
-- refusing it would strand the row in ATTACHED forever with no screen to
-- explain it. What the appointment closes is sending a new one.
CREATE OR REPLACE FUNCTION public.consult_capture_c3_contract_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public."UploadSession"
    WHERE "id" = NEW."uploadSessionId"
      AND "maxBytes" = NEW."sizeBytes"
      AND "checksumSha256" IS NOT DISTINCT FROM NEW."checksumSha256"
  ) THEN
    RAISE EXCEPTION 'capture size and checksum must match the minted upload'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" = 'ATTACHED'
    AND NEW."status" IN ('ACCEPTED', 'REJECTED')
    AND NOT EXISTS (
      SELECT 1 FROM public."ConsultSession"
      WHERE "id" = NEW."consultSessionId"
        AND "status" IN (
          'EARLY_PHOTO_READY', 'MEDIA_READY',
          'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
        )
    )
  THEN
    RAISE EXCEPTION 'capture quality requires the media-ready lifecycle state'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Uploads and inspiration sources: the same widened window
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consult_upload_session_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  scope_matches BOOLEAN;
BEGIN
  IF NEW."surface" <> 'CLIENT_CONSULT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."consultSessionId" <> OLD."consultSessionId"
      OR NEW."clientId" <> OLD."clientId"
      OR NEW."professionalId" <> OLD."professionalId"
      OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
      OR NEW."serviceCategoryId" <> OLD."serviceCategoryId"
      OR NEW."consultShotKey" <> OLD."consultShotKey"
      OR NEW."shotPackVersion" <> OLD."shotPackVersion"
      OR NEW."captureSchemaVersion" <> OLD."captureSchemaVersion"
      OR NEW."idempotencyKey" <> OLD."idempotencyKey"
      OR NEW."requestHash" <> OLD."requestHash"
      OR NEW."contentType" <> OLD."contentType"
      OR NEW."maxBytes" <> OLD."maxBytes"
      OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256"
      OR NEW."expiresAt" <> OLD."expiresAt"
      OR NEW."rawExpiresAt" <> OLD."rawExpiresAt"
    THEN
      RAISE EXCEPTION 'consult upload binding is immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT
    session."clientId" = NEW."clientId"
    AND session."professionalId" = NEW."professionalId"
    AND session."bookingId" IS NOT DISTINCT FROM NEW."bookingId"
    AND session."serviceCategoryId" = NEW."serviceCategoryId"
    AND session."status" IN (
      'EARLY_PHOTO_READY', 'MEDIA_READY',
      'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
    )
    AND (
      session."bookingId" IS NULL
      OR (
        booking."status" IN ('PENDING', 'ACCEPTED')
        AND booking."scheduledFor" > CURRENT_TIMESTAMP
        AND booking."scheduledFor" <= CURRENT_TIMESTAMP + INTERVAL '90 days'
      )
    )
    AND category."isActive"
  INTO scope_matches
  FROM public."ConsultSession" AS session
  LEFT JOIN public."Booking" AS booking ON booking."id" = session."bookingId"
  JOIN public."ServiceCategory" AS category ON category."id" = session."serviceCategoryId"
  WHERE session."id" = NEW."consultSessionId";

  IF scope_matches IS DISTINCT FROM TRUE
    OR NOT public."consult_current_agreements_active"(NEW."consultSessionId")
    OR public."consult_appointment_started"(NEW."consultSessionId")
  THEN
    RAISE EXCEPTION 'consult upload requires current prerequisites and exact eligible scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consult_inspiration_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  session_found BOOLEAN;
  session_status public."ConsultSessionStatus";
  session_booking_id TEXT;
  booking_status public."BookingStatus";
  booking_time TIMESTAMP(3);
BEGIN
  SELECT TRUE, s."status", s."bookingId", b."status", b."scheduledFor"
    INTO session_found, session_status, session_booking_id, booking_status, booking_time
  FROM public."ConsultSession" s
  LEFT JOIN public."Booking" b ON b."id" = s."bookingId"
  WHERE s."id" = NEW."consultSessionId";

  IF TG_OP = 'INSERT' AND (
    session_found IS DISTINCT FROM TRUE
    OR session_status NOT IN (
      'EARLY_PHOTO_READY', 'MEDIA_READY',
      'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
    )
    OR (session_booking_id IS NOT NULL AND (
      booking_status NOT IN ('PENDING','ACCEPTED') OR booking_time <= CURRENT_TIMESTAMP
    ))
    OR public."consult_appointment_started"(NEW."consultSessionId")
    OR NOT public."consult_current_agreements_active"(NEW."consultSessionId")
  )
  THEN RAISE EXCEPTION 'inspiration source requires current eligible consented consult' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' AND NEW."source" IN ('PLATFORM_LOOK', 'BOOKED_PRO_LOOK')
    AND NOT public."consult_inspiration_source_valid"(NEW)
  THEN RAISE EXCEPTION 'inspiration Look is not available to both consult participants' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."consultSessionId" <> OLD."consultSessionId" OR NEW."source" <> OLD."source" OR NEW."sourceLookPostId" IS DISTINCT FROM OLD."sourceLookPostId" OR NEW."sourceIdempotencyKey" <> OLD."sourceIdempotencyKey" OR NEW."sourceRequestHash" <> OLD."sourceRequestHash" OR NEW."uploadExpiresAt" IS DISTINCT FROM OLD."uploadExpiresAt"
    THEN RAISE EXCEPTION 'inspiration binding is immutable' USING ERRCODE = '23514'; END IF;
    IF OLD."status" = 'UPLOAD_PENDING' AND NEW."status" NOT IN ('UPLOAD_PENDING','ATTACHED','REPLACED','REMOVED') OR OLD."status" = 'ATTACHED' AND NEW."status" NOT IN ('ATTACHED','REPLACED','REMOVED') OR OLD."status" IN ('REPLACED','REMOVED') AND NEW."status" <> OLD."status"
    THEN RAISE EXCEPTION 'invalid inspiration lifecycle' USING ERRCODE = '23514'; END IF;
    IF OLD."purgedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'purged inspiration is immutable' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8b. The two payload guards that pin the artefact to ANALYZING
-- ─────────────────────────────────────────────────────────────────────────────
-- `consult_analysis_payload_guard` and `consult_inspiration_analysis_payload_guard`
-- each open with `session_status <> 'ANALYZING'`, so a RERUN — which publishes
-- while the session is COMPLETED and never leaves it — is refused by the
-- database with "invalid versioned service-analysis payload". Everything after
-- that first clause is 13KB of field-by-field enum and shape checking that must
-- not change by one byte.
--
-- 🔴 So it is PATCHED, not retyped. The definition is read back from the
-- catalogue, exactly one substring is replaced, and the result is executed —
-- which makes "the rest is unchanged" true by construction rather than by
-- proofreading. A hand-copied 13KB guard is how a validator quietly stops
-- validating one field.
--
-- The DO block RAISES if the expected clause is missing, and is a no-op once
-- the widened form is already present, so a re-run is safe and a drifted
-- definition is loud rather than silently unpatched.
DO $patch$
DECLARE
  target TEXT;
  body TEXT;
  patched TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'consult_analysis_payload_guard',
    'consult_inspiration_analysis_payload_guard'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = target;

    IF body IS NULL THEN
      RAISE EXCEPTION 'P7a-3: %() not found; cannot widen its lifecycle pin', target;
    END IF;

    IF position('session_status NOT IN (''ANALYZING'', ''COMPLETED'')' IN body) > 0 THEN
      CONTINUE;  -- already widened
    END IF;

    IF position('session_status <> ''ANALYZING''' IN body) = 0 THEN
      RAISE EXCEPTION
        'P7a-3: %() no longer contains the ANALYZING pin this migration widens', target;
    END IF;

    patched := replace(
      body,
      'session_status <> ''ANALYZING''',
      'session_status NOT IN (''ANALYZING'', ''COMPLETED'')'
    );
    EXECUTE patched;
  END LOOP;
END
$patch$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. The booking fence honours retention, and can finally see a spark consult
-- ─────────────────────────────────────────────────────────────────────────────
-- Two defects fixed together, because they are the same missing join:
--   * the fence only ever matched `s."bookingId" = NEW."id"`, so a SPARK
--     consult's captures were never purged by its appointment at all;
--   * it purged at the appointment even for a client who had asked to keep her
--     photos, which would have made "kept through the appointment + 14 days"
--     untrue on the one path that matters.
--
-- CANCELLED / NO_SHOW still purge immediately under any consent: the visit is
-- not happening, so there is no chart for the photos to belong to.
CREATE OR REPLACE FUNCTION public.consult_booking_raw_purge_fence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  abandoned BOOLEAN;
BEGIN
  abandoned := NEW."status" IN ('CANCELLED', 'NO_SHOW');

  IF NEW."status" NOT IN ('PENDING','ACCEPTED') OR NEW."scheduledFor" <= CURRENT_TIMESTAMP THEN
    UPDATE public."UploadSession" u SET "purgeEligibleAt" = CURRENT_TIMESTAMP
      FROM public."ConsultSession" s
     WHERE u."surface" = 'CLIENT_CONSULT' AND u."consultSessionId" = s."id"
       AND (s."bookingId" = NEW."id" OR s."id" = NEW."sourceConsultSessionId")
       AND u."purgedAt" IS NULL
       AND (abandoned OR NOT s."chartCopyOptIn");
    UPDATE public."ConsultCapture" c SET "purgeEligibleAt" = CURRENT_TIMESTAMP, "purgeRequestedAt" = CURRENT_TIMESTAMP
      FROM public."ConsultSession" s
     WHERE c."consultSessionId" = s."id"
       AND (s."bookingId" = NEW."id" OR s."id" = NEW."sourceConsultSessionId")
       AND c."purgedAt" IS NULL
       AND (abandoned OR NOT s."chartCopyOptIn");
    UPDATE public."ConsultInspiration" i SET "purgeEligibleAt" = CURRENT_TIMESTAMP, "purgeRequestedAt" = CURRENT_TIMESTAMP
      FROM public."ConsultSession" s
     WHERE i."consultSessionId" = s."id"
       AND (s."bookingId" = NEW."id" OR s."id" = NEW."sourceConsultSessionId")
       AND i."source" = 'EXTERNAL_UPLOAD' AND i."purgedAt" IS NULL
       AND (abandoned OR NOT s."chartCopyOptIn");
  ELSE
    UPDATE public."ConsultInspiration" i SET "useExpiresAt" = NEW."scheduledFor" + (NEW."totalDurationMinutes" * INTERVAL '1 minute') + INTERVAL '24 hours'
      FROM public."ConsultSession" s
     WHERE i."consultSessionId" = s."id"
       AND (s."bookingId" = NEW."id" OR s."id" = NEW."sourceConsultSessionId")
       AND i."source" = 'EXTERNAL_UPLOAD' AND i."status" IN ('UPLOAD_PENDING','ATTACHED') AND i."purgedAt" IS NULL;
  END IF;
  RETURN NEW;
END; $function$;

-- The fence must fire when the spark link is stamped, too — before P7a-3 it
-- watched only status and scheduledFor.
DROP TRIGGER IF EXISTS "Booking_consult_raw_purge_fence" ON "Booking";
CREATE TRIGGER "Booking_consult_raw_purge_fence"
  AFTER UPDATE OF "status", "scheduledFor", "sourceConsultSessionId" ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION public.consult_booking_raw_purge_fence();
