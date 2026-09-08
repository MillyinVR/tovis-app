CREATE TABLE public."ConsultChartPhotoUse" (
  id text PRIMARY KEY,
  "consultSessionId" text NOT NULL REFERENCES public."ConsultSession"(id) ON DELETE CASCADE,
  "captureId" text NOT NULL UNIQUE REFERENCES public."ConsultCapture"(id) ON DELETE CASCADE,
  "mediaAssetId" text REFERENCES public."MediaAsset"(id) ON DELETE SET NULL,
  "sourceRecordedAt" timestamp(3) NOT NULL,
  "idempotencyKey" varchar(128) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("consultSessionId", "idempotencyKey")
);
ALTER TABLE public."ConsultChartPhotoUse" ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.consult_chart_photo_use_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE capture public."ConsultCapture"; source_client text; session_client text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."mediaAssetId" IS NULL AND OLD."mediaAssetId" IS NOT NULL AND
       (to_jsonb(NEW) - 'mediaAssetId') = (to_jsonb(OLD) - 'mediaAssetId') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'chart photo uses are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO capture FROM public."ConsultCapture" WHERE id = NEW."captureId";
  SELECT "clientId" INTO session_client FROM public."ConsultSession" WHERE id = NEW."consultSessionId";
  SELECT b."clientId" INTO source_client FROM public."MediaAsset" m JOIN public."Booking" b ON b.id = m."bookingId" WHERE m.id = NEW."mediaAssetId";
  IF capture."consultSessionId" IS DISTINCT FROM NEW."consultSessionId" OR source_client IS DISTINCT FROM session_client OR NEW."mediaAssetId" IS NULL THEN
    RAISE EXCEPTION 'chart photo must belong to this client and capture' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConsultChartPhotoUse_guard" BEFORE INSERT OR UPDATE ON public."ConsultChartPhotoUse"
  FOR EACH ROW EXECUTE FUNCTION public.consult_chart_photo_use_guard();
