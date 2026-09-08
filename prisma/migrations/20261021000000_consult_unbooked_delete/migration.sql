-- A completed analysis remains a discardable draft until it has an appointment.
-- Preserve all other lifecycle clauses and the raw-object deletion guard.
DO $$
DECLARE definition text;
  old_clause text := 'WHEN ''COMPLETED'' THEN NEW."status" = ''CONSENT_REVOKED''';
  new_clause text := 'WHEN ''COMPLETED'' THEN NEW."status" = ''CONSENT_REVOKED'' OR (NEW."status" = ''CANCELLED'' AND NEW."bookingId" IS NULL AND NOT EXISTS (SELECT 1 FROM public."Booking" b WHERE b."sourceConsultSessionId" = NEW."id"))';
BEGIN
  SELECT pg_get_functiondef('public.consult_lifecycle_guard()'::regprocedure) INTO definition;
  IF position(new_clause IN definition) > 0 THEN RETURN; END IF;
  IF position(old_clause IN definition) = 0 THEN RAISE EXCEPTION 'consult completed lifecycle clause changed'; END IF;
  EXECUTE replace(definition, old_clause, new_clause);
END $$;
