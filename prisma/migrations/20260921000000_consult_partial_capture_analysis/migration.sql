-- Partial capture submission (Tori, 2026-08-27): the client may explicitly run
-- the analysis with an incomplete accepted pack — at least ONE accepted,
-- unexpired capture instead of exactly seven. The analysis prompt becomes
-- full-analysis-v2 (it is told which views are missing and must keep their
-- observations UNKNOWN; output schema is unchanged, so schemaVersion stays 2).
-- Completion now requires every accepted capture the analysis consumed to be
-- purge-marked, rather than a fixed count of seven.

-- 1) Analysis payload guard: rows are written under prompt v2 from now on.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure)
    INTO definition;
  updated := replace(definition, '''full-analysis-v1''', '''full-analysis-v2''');
  IF position('full-analysis-v2' in updated) = 0
    OR position('full-analysis-v1' in updated) > 0
  THEN
    RAISE EXCEPTION 'expected analysis payload guard prompt pin not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_analysis_payload_guard"() SET search_path = '';

-- 2) Analysis prerequisite guard: at least one accepted capture instead of the
-- exact seven-shot pack.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    'current_capture_count <> 7',
    'current_capture_count < 1'
  );
  updated := replace(
    updated,
    'analysis requires current completed intake and exact accepted capture pack',
    'analysis requires current completed intake and at least one accepted capture'
  );
  IF position('current_capture_count < 1' in updated) = 0
    OR position('current_capture_count <> 7' in updated) > 0
    OR position('at least one accepted capture' in updated) = 0
  THEN
    RAISE EXCEPTION 'expected analysis prerequisite capture pins not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- 3) Lifecycle guard: full redefinition (current definition = 20260905000002
-- as patched through 20260914000000). MEDIA_READY -> ANALYSIS_PENDING needs at
-- least one accepted unexpired capture; ANALYZING -> COMPLETED needs one
-- current revision, at least one purge-marked accepted capture, and NO
-- accepted unexpired capture left unmarked.
CREATE OR REPLACE FUNCTION "consult_lifecycle_guard"()
RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
  accepted_slot_count INTEGER;
  completed_analysis_count INTEGER;
  purge_mark_count INTEGER;
  unmarked_accepted_count INTEGER;
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  allowed := CASE OLD."status"
    WHEN 'CONSENT_REQUIRED' THEN NEW."status" IN ('INTAKE_READY', 'CANCELLED')
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
    'INTAKE_READY', 'INTAKE_IN_PROGRESS', 'MEDIA_READY',
    'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
  ) AND NOT public."consult_current_agreements_active"(NEW."id") THEN
    RAISE EXCEPTION 'current consent and 18+ attestation are required for lifecycle transition'
      USING ERRCODE = '23514';
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
    IF completed_analysis_count <> 1 OR purge_mark_count < 1 OR unmarked_accepted_count <> 0 THEN
      RAISE EXCEPTION 'completed analysis requires one current revision and every accepted capture purge-marked'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';
