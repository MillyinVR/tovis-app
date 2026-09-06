-- P7a-1, slice 2 of 3: the early photo becomes a storable capture.
--
-- Two CHECK constraints on "ConsultCapture" refuse it today, and neither was
-- reconstructed from the migration chain — both were read off a fully-migrated
-- database with pg_get_constraintdef (2026-09-05), which is also how the
-- rewrite below is done, so a drifted definition fails loudly instead of
-- silently not applying:
--
--   1. ConsultCapture_shape pins "shotKey" to a closed nine-key list. The early
--      photo is a tenth key. It belongs to no pack (lib/consult/capture/
--      earlyPhoto.ts) but it IS a stored capture, so the column has to admit it.
--   2. ConsultCapture_quality_contract says an ACCEPTED row must carry
--      reasonCode 'PASS' and a warning drawn from the two COLOUR findings. The
--      early photo's whole contract is that a blurry, dim, oddly-cropped or
--      hair-less photo is ACCEPTED WITH A WARNING, so that set has to widen —
--      but only for this shot.
--
-- 🔴 THE WARNING SET IS KEYED ON shotKey, and that is deliberate.
--
-- The lazy expand is "let any capture carry any warning". That would quietly
-- delete the B3 guarantee: today the database itself refuses to store, say, a
-- VIEW_MISMATCH as a warning on a guided hair shot, so a bug in the gate that
-- accepted a photo of the wrong thing would fail loudly at the write instead of
-- feeding the analysis a frame nobody looked at. Widening the set globally
-- would turn that 23514 into a silent success. So the guided arm keeps EXACTLY
-- the two colour codes it has always had, and the early photo gets its own.
--
-- SUBJECT_NOT_VISIBLE is absent from the early photo's warning list on purpose:
-- it is the ONE finding that still rejects this shot (Tori, 2026-09-05), so it
-- can never appear on an accepted row.
--
-- Expand-only. Both constraints are supersets of what they replace: every row
-- that satisfied the old one satisfies the new one, so the implicit revalidation
-- of the 24 existing production captures cannot fail. The still-deployed code
-- writes only the old shapes for the length of the build window (P4c: merge
-- reports, the deploy build migrates), and those shapes stay legal.

-- 1) shotKey ---------------------------------------------------------------

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'public."ConsultCapture"'::regclass
    AND conname = 'ConsultCapture_shape';

  IF definition IS NULL THEN
    RAISE EXCEPTION 'ConsultCapture_shape not found';
  END IF;

  updated := replace(
    definition,
    '''area_closeup''::character varying])::text[]))',
    '''area_closeup''::character varying, ''early_photo''::character varying])::text[]))'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected ConsultCapture_shape shotKey list not found';
  END IF;

  EXECUTE 'ALTER TABLE public."ConsultCapture" DROP CONSTRAINT "ConsultCapture_shape"';
  EXECUTE 'ALTER TABLE public."ConsultCapture" ADD CONSTRAINT "ConsultCapture_shape" ' || updated;
END;
$$;

-- 2) the quality contract ---------------------------------------------------

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'public."ConsultCapture"'::regclass
    AND conname = 'ConsultCapture_quality_contract';

  IF definition IS NULL THEN
    RAISE EXCEPTION 'ConsultCapture_quality_contract not found';
  END IF;

  -- 2a) the prompt-version pin. The early photo is judged under a different
  -- rule set and says so in its own version, rather than riding on the guided
  -- one (lib/consult/captureVision.ts). Widening a SET, never swapping the
  -- value: a bump that strands already-accepted captures is how this pin has
  -- bitten before.
  updated := replace(
    definition,
    '''full-analysis-capture-v3''::character varying])::text[]))',
    '''full-analysis-capture-v3''::character varying, ''early-photo-capture-v1''::character varying])::text[]))'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected quality prompt version list not found';
  END IF;
  definition := updated;

  -- 2b) the accepted-row warning set, split per shot.
  updated := replace(
    definition,
    '(("qualityWarningCode" IS NULL) OR (("qualityWarningCode")::text = ANY ((ARRAY[''WARM_INDOOR_LIGHT''::character varying, ''COLOR_CAST''::character varying])::text[])))',
    '(("qualityWarningCode" IS NULL) OR ((("shotKey")::text <> ''early_photo''::text) AND (("qualityWarningCode")::text = ANY ((ARRAY[''WARM_INDOOR_LIGHT''::character varying, ''COLOR_CAST''::character varying])::text[]))) OR ((("shotKey")::text = ''early_photo''::text) AND (("qualityWarningCode")::text = ANY ((ARRAY[''WARM_INDOOR_LIGHT''::character varying, ''COLOR_CAST''::character varying, ''VIEW_MISMATCH''::character varying, ''HAIR_NOT_VISIBLE''::character varying, ''BLURRY''::character varying, ''TOO_DARK''::character varying, ''TOO_BRIGHT''::character varying, ''OTHER_QUALITY_FAILURE''::character varying])::text[]))))'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected accepted-row warning set not found';
  END IF;

  EXECUTE 'ALTER TABLE public."ConsultCapture" DROP CONSTRAINT "ConsultCapture_quality_contract"';
  EXECUTE 'ALTER TABLE public."ConsultCapture" ADD CONSTRAINT "ConsultCapture_quality_contract" ' || updated;
END;
$$;

-- 3) the minted upload ------------------------------------------------------
--
-- UploadSession carries its OWN copy of the shot-key list, and it is the first
-- thing an early photo hits: the upload is minted before the capture row
-- exists. Found by sweeping for the key list rather than for the lifecycle
-- state — a sweep for MEDIA_READY alone does not reach it, because this
-- constraint never mentions a status.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition
  FROM pg_constraint
  WHERE conrelid = 'public."UploadSession"'::regclass
    AND conname = 'UploadSession_consult_shape';

  IF definition IS NULL THEN
    RAISE EXCEPTION 'UploadSession_consult_shape not found';
  END IF;

  updated := replace(
    definition,
    '''area_closeup''::character varying])::text[]))',
    '''area_closeup''::character varying, ''early_photo''::character varying])::text[]))'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected UploadSession_consult_shape shotKey list not found';
  END IF;

  EXECUTE 'ALTER TABLE public."UploadSession" DROP CONSTRAINT "UploadSession_consult_shape"';
  EXECUTE 'ALTER TABLE public."UploadSession" ADD CONSTRAINT "UploadSession_consult_shape" ' || updated;
END;
$$;
