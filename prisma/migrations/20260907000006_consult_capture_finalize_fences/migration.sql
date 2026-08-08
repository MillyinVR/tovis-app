-- Booking cancellation is independent of the consult session lock. Stamp its
-- raw objects purge-eligible in the same booking transaction so provider work
-- cannot commit against a newly cancelled appointment.
CREATE OR REPLACE FUNCTION "consult_booking_raw_purge_fence"()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    NEW."status" NOT IN ('PENDING', 'ACCEPTED')
    AND OLD."status" IN ('PENDING', 'ACCEPTED')
  ) OR (
    NEW."scheduledFor" <= CURRENT_TIMESTAMP
    AND OLD."scheduledFor" > CURRENT_TIMESTAMP
  ) THEN
    UPDATE public."UploadSession" AS upload
    SET "purgeEligibleAt" = CURRENT_TIMESTAMP
    FROM public."ConsultSession" AS session
    WHERE upload."surface" = 'CLIENT_CONSULT'
      AND upload."consultSessionId" = session."id"
      AND session."bookingId" = NEW."id"
      AND upload."purgedAt" IS NULL;

    UPDATE public."ConsultCapture" AS capture
    SET "purgeEligibleAt" = CURRENT_TIMESTAMP,
        "purgeRequestedAt" = CURRENT_TIMESTAMP
    FROM public."ConsultSession" AS session
    WHERE capture."consultSessionId" = session."id"
      AND session."bookingId" = NEW."id"
      AND capture."purgedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_booking_raw_purge_fence"() SET search_path = '';

CREATE TRIGGER "Booking_consult_raw_purge_fence"
  AFTER UPDATE OF "status", "scheduledFor" ON "Booking"
  FOR EACH ROW EXECUTE FUNCTION "consult_booking_raw_purge_fence"();

-- Backstop the post-provider application re-check for direct writers and for
-- a purge request racing the final quality UPDATE.
CREATE OR REPLACE FUNCTION "consult_capture_finalize_fence"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'ATTACHED'
    AND NEW."status" IN ('ACCEPTED', 'REJECTED')
    AND (
      NEW."rawExpiresAt" <= CURRENT_TIMESTAMP
      OR OLD."purgeRequestedAt" IS NOT NULL
      OR OLD."purgedAt" IS NOT NULL
      OR (NEW."status" = 'ACCEPTED' AND NEW."purgeRequestedAt" IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION 'expired or purge-requested capture cannot finalize quality'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_capture_finalize_fence"() SET search_path = '';

CREATE TRIGGER "ConsultCapture_finalize_fence"
  BEFORE UPDATE ON "ConsultCapture"
  FOR EACH ROW EXECUTE FUNCTION "consult_capture_finalize_fence"();
