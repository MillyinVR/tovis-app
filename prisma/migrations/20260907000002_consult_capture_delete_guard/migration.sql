-- Defense in depth for privacy/account deletion: provider bytes must be
-- verified absent before even the ephemeral capture metadata may be deleted.
CREATE OR REPLACE FUNCTION "consult_capture_delete_requires_purge"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."purgedAt" IS NULL THEN
    RAISE EXCEPTION 'raw consult object must be verified purged before capture deletion'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_capture_delete_requires_purge"() SET search_path = '';

CREATE TRIGGER "ConsultCapture_delete_requires_purge"
  BEFORE DELETE ON "ConsultCapture"
  FOR EACH ROW EXECUTE FUNCTION "consult_capture_delete_requires_purge"();
