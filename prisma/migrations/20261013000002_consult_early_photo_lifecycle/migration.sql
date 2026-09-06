-- P7a-1, slice 3 of 3: EARLY_PHOTO_READY becomes a state the guards accept.
--
-- Seven functions pin consult writes to MEDIA_READY. They were found by
-- sweeping the LIVE definitions of a fully-migrated database, not by grepping
-- the migration files (2026-09-05):
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) LIKE '%MEDIA_READY%';
--
-- That mattered: consult_capture_c3_contract_guard pins to MEDIA_READY and
-- appears in NO "CREATE OR REPLACE FUNCTION" line in prisma/migrations — a
-- file-only sweep would have shipped an early photo that could be attached and
-- never judged.
--
-- Of the seven, five gate a write the early-photo stage makes and are widened
-- here. Two are left ALONE, and that is a decision, not an oversight:
--   - consult_revision_requires_agreements' INSPIRATION_ANALYSIS arm and
--     consult_inspiration_analysis_payload_guard both pin the vision READ of
--     the reference to (MEDIA_READY, ANALYZING). The read is a paid call
--     triggered by the reference being attached, and P5b deliberately put it
--     there. The coarse cards move earlier; the read does not.
--
-- 🔴 EVERY ARM IS ADDITIVE. Not one MEDIA_READY is removed and not one existing
-- transition is dropped, including CONSENT_REQUIRED -> INTAKE_READY, which the
-- new flow no longer uses. P4c reduced the window between "schema migrated" and
-- "code deployed" from up to 16h57m to the ~2m30s of the build, but it did not
-- close it: for that window the still-deployed code creates consults on the OLD
-- path, and a guard that had dropped the old arm would refuse every one of them.
-- Contracting is a follow-up migration, after the deploy has landed.

-- 1) The lifecycle transition table -----------------------------------------
--
-- Adds the state, its two edges, and its OWN READINESS RULE: a consult may not
-- leave EARLY_PHOTO_READY until it holds one accepted, unexpired early photo.
-- That rule is the point of the stage, so it lives in the database next to the
-- one that already guards MEDIA_READY -> ANALYSIS_PENDING, not only in the
-- application that happens to call the transition.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_lifecycle_guard()'::regprocedure)
    INTO definition;

  -- 1a) the new state's outgoing edges, and the incoming one from consent.
  updated := replace(
    definition,
    'WHEN ''CONSENT_REQUIRED'' THEN NEW."status" IN (''INTAKE_READY'', ''CANCELLED'')',
    'WHEN ''CONSENT_REQUIRED'' THEN NEW."status" IN (''EARLY_PHOTO_READY'', ''INTAKE_READY'', ''CANCELLED'')'
    || E'\n    WHEN ''EARLY_PHOTO_READY'' THEN NEW."status" IN (''INTAKE_READY'', ''CONSENT_REVOKED'', ''CANCELLED'')'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected CONSENT_REQUIRED transition arm not found';
  END IF;
  definition := updated;

  -- 1b) the consent prerequisite covers the new state too. Without this a
  -- consult could sit in EARLY_PHOTO_READY with revoked consent and still take
  -- photographs of the client.
  updated := replace(
    definition,
    '''INTAKE_READY'', ''INTAKE_IN_PROGRESS'', ''MEDIA_READY'',',
    '''EARLY_PHOTO_READY'', ''INTAKE_READY'', ''INTAKE_IN_PROGRESS'', ''MEDIA_READY'','
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected consent-required status list not found';
  END IF;
  definition := updated;

  -- 1c) the readiness rule.
  updated := replace(
    definition,
    '  IF OLD."status" = ''MEDIA_READY'' AND NEW."status" = ''ANALYSIS_PENDING'' THEN',
    '  IF OLD."status" = ''EARLY_PHOTO_READY'' AND NEW."status" = ''INTAKE_READY'' THEN'
    || E'\n    SELECT count(*) INTO accepted_slot_count'
    || E'\n    FROM public."ConsultCapture"'
    || E'\n    WHERE "consultSessionId" = NEW."id"'
    || E'\n      AND "shotKey" = ''early_photo'''
    || E'\n      AND "status" = ''ACCEPTED'''
    || E'\n      AND "purgedAt" IS NULL'
    || E'\n      AND "rawExpiresAt" > CURRENT_TIMESTAMP;'
    || E'\n    IF accepted_slot_count < 1 THEN'
    || E'\n      RAISE EXCEPTION ''leaving the early photo stage requires one accepted unexpired early photo'''
    || E'\n        USING ERRCODE = ''23514'';'
    || E'\n    END IF;'
    || E'\n  END IF;'
    || E'\n  IF OLD."status" = ''MEDIA_READY'' AND NEW."status" = ''ANALYSIS_PENDING'' THEN'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected MEDIA_READY -> ANALYSIS_PENDING prerequisite not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';

-- 2) The three capture write pins -------------------------------------------
--
-- Minting an upload, inserting the capture, and finalising its quality. All
-- three are the SAME ingest path the guided pack uses — that is the point of
-- P7a-1, the early photo is not a second capture mechanism — so all three must
-- admit the state the client is in when she takes it.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_upload_session_guard()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    'AND session."status" = ''MEDIA_READY''',
    'AND session."status" IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'')'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected upload session status pin not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_upload_session_guard"() SET search_path = '';

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_capture_guard()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    'AND session."status" = ''MEDIA_READY''',
    'AND session."status" IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'')'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected capture guard status pin not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_capture_guard"() SET search_path = '';

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_capture_c3_contract_guard()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    'WHERE "id" = NEW."consultSessionId" AND "status" = ''MEDIA_READY''',
    'WHERE "id" = NEW."consultSessionId" AND "status" IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'')'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected c3 contract guard status pin not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_capture_c3_contract_guard"() SET search_path = '';

-- 3) The two inspiration pins -----------------------------------------------
--
-- The coarse cards ("what stopped you scrolling?") move to their intended
-- position: after consent, before the photo. Both the row that holds the
-- reference and the revision that records her answers must be writable there.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_inspiration_guard()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    'OR session_status <> ''MEDIA_READY''',
    'OR session_status NOT IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'')'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected inspiration guard status pin not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_inspiration_guard"() SET search_path = '';

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;

  -- 3a) the INSPIRATION revision arm.
  updated := replace(
    definition,
    'IF NEW."kind" = ''INSPIRATION'' AND session_status <> ''MEDIA_READY'' THEN',
    'IF NEW."kind" = ''INSPIRATION'' AND session_status NOT IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'') THEN'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected inspiration revision lifecycle pin not found';
  END IF;
  definition := updated;

  -- 3b) the early photo is an analysis input at the lowest evidence tier
  -- (Tori, 2026-09-05): its warnings reach the analysis through the existing
  -- qualityWarningCode path, and a later guided face_front supersedes it. So
  -- the ANALYSIS prerequisite must COUNT it — otherwise a consult whose only
  -- photograph is the early one could never reach an analysis at all.
  updated := replace(
    definition,
    'AND capture."shotKey" IN (''hair_back'', ''hair_left'', ''hair_right'', ''hair_crown'', ''face_front'', ''face_side'', ''eyes_closeup'', ''area_wide'', ''area_closeup'')',
    'AND capture."shotKey" IN (''hair_back'', ''hair_left'', ''hair_right'', ''hair_crown'', ''face_front'', ''face_side'', ''eyes_closeup'', ''area_wide'', ''area_closeup'', ''early_photo'')'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected analysis capture shot key list not found';
  END IF;
  definition := updated;

  -- 3c) and it must be judgeable under its own prompt version. Mirrors
  -- CONSULT_ANALYZABLE_CAPTURE_PROMPT_VERSIONS; the two must agree.
  updated := replace(
    definition,
    'AND capture."qualityPromptVersion" IN (''full-analysis-capture-v2'', ''full-analysis-capture-v3'')',
    'AND capture."qualityPromptVersion" IN (''full-analysis-capture-v2'', ''full-analysis-capture-v3'', ''early-photo-capture-v1'')'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected analysis capture prompt version list not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- 4) the analysis evidence vocabulary ---------------------------------------
--
-- The early photo is an analysis input at the lowest evidence tier (Tori,
-- 2026-09-05), so the analysis artefact may cite it as evidence — and both
-- payload validators hold a closed list of evidence labels that would refuse
-- the citation. Same sweep as above, by KEY rather than by status: neither of
-- these functions mentions a lifecycle state at all.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_evidence_valid'::regproc)
    INTO definition;
  updated := replace(
    definition,
    '''area_wide'', ''area_closeup''',
    '''area_wide'', ''area_closeup'', ''early_photo'''
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected analysis evidence label list not found';
  END IF;
  EXECUTE updated;
END;
$$;

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_direction_evidence_valid'::regproc)
    INTO definition;
  updated := replace(
    definition,
    '''area_wide'', ''area_closeup'', ''intake''',
    '''area_wide'', ''area_closeup'', ''early_photo'', ''intake'''
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected direction evidence label list not found';
  END IF;
  EXECUTE updated;
END;
$$;

-- 5) the analysis run's photo ceiling ---------------------------------------
--
-- `photoCount <= 7` was the largest pack's slot count, written as a literal.
-- A full seven-shot hair consult that also holds its early photo hands the
-- analysis EIGHT captures, and the run row was refused with a 23514 AFTER the
-- client had pressed Analyze. Mirrors CONSULT_MAX_ANALYSIS_CAPTURES.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'public."ConsultAnalysisRun"'::regclass
    AND conname = 'ConsultAnalysisRun_attempts_sane';

  IF definition IS NULL THEN
    RAISE EXCEPTION 'ConsultAnalysisRun_attempts_sane not found';
  END IF;

  updated := replace(definition, '("photoCount" <= 7)', '("photoCount" <= 8)');
  IF updated = definition THEN
    RAISE EXCEPTION 'expected photoCount ceiling not found';
  END IF;

  EXECUTE 'ALTER TABLE public."ConsultAnalysisRun" DROP CONSTRAINT "ConsultAnalysisRun_attempts_sane"';
  EXECUTE 'ALTER TABLE public."ConsultAnalysisRun" ADD CONSTRAINT "ConsultAnalysisRun_attempts_sane" ' || updated;
END;
$$;
