-- The reference is read as soon as consent is accepted, before the early photo.
-- The API already supports that state and rereading a replaced reference on a
-- completed consult. The v3 payload guard still required MEDIA_READY/ANALYZING,
-- and the revision guard still excluded EARLY_PHOTO_READY. Preserve every
-- payload, ownership, consent and source check while aligning these two pins.
DO $patch$
DECLARE
  definition TEXT;
  original TEXT;
  replacement TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_inspiration_analysis_payload_guard()'::regprocedure)
    INTO definition;
  original := 'session_status NOT IN (''MEDIA_READY'', ''ANALYZING'')';
  replacement := 'session_status NOT IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'', ''ANALYZING'', ''COMPLETED'')';
  IF position(replacement IN definition) = 0 THEN
    IF position(original IN definition) = 0 THEN
      RAISE EXCEPTION 'visual reference: expected v3 inspiration lifecycle pin not found';
    END IF;
    EXECUTE replace(definition, original, replacement);
  END IF;

  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;
  original := 'IF NEW."kind" = ''INSPIRATION_ANALYSIS'''
    || E'\n    AND session_status NOT IN (''MEDIA_READY'', ''ANALYZING'', ''COMPLETED'')';
  replacement := 'IF NEW."kind" = ''INSPIRATION_ANALYSIS'''
    || E'\n    AND session_status NOT IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'', ''ANALYZING'', ''COMPLETED'')';
  IF position(replacement IN definition) = 0 THEN
    IF position(original IN definition) = 0 THEN
      RAISE EXCEPTION 'visual reference: expected inspiration revision lifecycle pin not found';
    END IF;
    EXECUTE replace(definition, original, replacement);
  END IF;
END
$patch$;
