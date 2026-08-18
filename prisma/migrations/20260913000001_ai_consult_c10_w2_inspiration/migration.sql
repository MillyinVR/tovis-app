-- AI Consult Phase 0 C10-W2: optional guided inspiration. Existing Look bytes
-- remain under Look ownership/publication controls; external bytes are private,
-- temporary, and structurally unable to become chart or MediaAsset records.

CREATE TABLE "ConsultInspiration" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "source" "ConsultInspirationSource" NOT NULL,
  "status" "ConsultInspirationStatus" NOT NULL,
  "sourceLookPostId" TEXT,
  "storageBucket" TEXT,
  "storagePath" TEXT,
  "contentType" VARCHAR(64),
  "sizeBytes" INTEGER,
  "checksumSha256" CHAR(64),
  "sourceIdempotencyKey" VARCHAR(128) NOT NULL,
  "sourceRequestHash" CHAR(64) NOT NULL,
  "attachIdempotencyKey" VARCHAR(128),
  "attachRequestHash" CHAR(64),
  "uploadExpiresAt" TIMESTAMP(3),
  "useExpiresAt" TIMESTAMP(3),
  "purgeEligibleAt" TIMESTAMP(3),
  "purgeRequestedAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConsultInspiration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsultInspiration_consultSessionId_fkey" FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConsultInspiration_shape" CHECK (
    "sourceRequestHash" ~ '^[0-9a-f]{64}$'
    AND ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$')
    AND CASE
      WHEN "source" IN ('PLATFORM_LOOK', 'BOOKED_PRO_LOOK') THEN
        "status" = 'ATTACHED'
        AND "sourceLookPostId" IS NOT NULL
        AND "storageBucket" IS NULL AND "storagePath" IS NULL
        AND "contentType" IS NULL AND "sizeBytes" IS NULL AND "checksumSha256" IS NULL
        AND "attachIdempotencyKey" IS NULL AND "attachRequestHash" IS NULL
        AND "uploadExpiresAt" IS NULL AND "useExpiresAt" IS NULL
        AND "purgeEligibleAt" IS NULL AND "purgeRequestedAt" IS NULL AND "purgedAt" IS NULL
      WHEN "source" = 'EXTERNAL_UPLOAD' THEN
        "sourceLookPostId" IS NULL
        AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
        AND "sizeBytes" BETWEEN 1 AND 5242880
        AND "uploadExpiresAt" IS NOT NULL AND "useExpiresAt" IS NOT NULL
        AND "useExpiresAt" > "uploadExpiresAt"
        AND (("purgedAt" IS NULL AND "storageBucket" = 'media-private'
              AND "storagePath" ~ '^consult-inspiration/v1/[0-9a-f-]+\.(jpg|png|webp)$')
          OR ("purgedAt" IS NOT NULL AND "storageBucket" IS NULL AND "storagePath" IS NULL))
        AND (("status" = 'UPLOAD_PENDING' AND "attachIdempotencyKey" IS NULL AND "attachRequestHash" IS NULL)
          OR ("status" = 'ATTACHED'
              AND "attachIdempotencyKey" IS NOT NULL AND "attachRequestHash" ~ '^[0-9a-f]{64}$')
          OR ("status" IN ('REPLACED', 'REMOVED') AND (
              ("attachIdempotencyKey" IS NULL AND "attachRequestHash" IS NULL)
              OR ("attachIdempotencyKey" IS NOT NULL AND "attachRequestHash" ~ '^[0-9a-f]{64}$')
          )))
      ELSE FALSE
    END
  )
);
CREATE UNIQUE INDEX "ConsultInspiration_consultSessionId_sourceIdempotencyKey_key" ON "ConsultInspiration"("consultSessionId", "sourceIdempotencyKey");
CREATE UNIQUE INDEX "ConsultInspiration_consultSessionId_attachIdempotencyKey_key" ON "ConsultInspiration"("consultSessionId", "attachIdempotencyKey");
CREATE UNIQUE INDEX "ConsultInspiration_one_active_source" ON "ConsultInspiration"("consultSessionId") WHERE "status" IN ('UPLOAD_PENDING', 'ATTACHED');
CREATE INDEX "ConsultInspiration_consultSessionId_createdAt_idx" ON "ConsultInspiration"("consultSessionId", "createdAt");
CREATE INDEX "ConsultInspiration_status_purgedAt_purgeEligibleAt_uploadExpiresAt_useExpiresAt_idx" ON "ConsultInspiration"("status", "purgedAt", "purgeEligibleAt", "uploadExpiresAt", "useExpiresAt");
CREATE INDEX "ConsultInspiration_sourceLookPostId_idx" ON "ConsultInspiration"("sourceLookPostId");

ALTER TABLE "ConsultAuditEvent" ADD COLUMN "inspirationId" TEXT;
ALTER TABLE "ConsultAuditEvent" ADD CONSTRAINT "ConsultAuditEvent_inspirationId_fkey" FOREIGN KEY ("inspirationId") REFERENCES "ConsultInspiration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ConsultAuditEvent_inspirationId_action_key" ON "ConsultAuditEvent"("inspirationId", "action");
CREATE INDEX "ConsultAuditEvent_inspirationId_idx" ON "ConsultAuditEvent"("inspirationId");

ALTER TABLE "ConsultRevision" DROP CONSTRAINT "ConsultRevision_idempotency_shape";
ALTER TABLE "ConsultRevision" ADD CONSTRAINT "ConsultRevision_idempotency_shape" CHECK (
  ("kind" = 'BRIEF' AND "idempotencyKey" IS NULL AND "requestHash" IS NULL)
  OR ("kind" IN ('INTAKE', 'INSPIRATION', 'ANALYSIS')
    AND "idempotencyKey" IS NOT NULL AND "requestHash" IS NOT NULL
    AND btrim("idempotencyKey") = "idempotencyKey"
    AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
    AND "requestHash" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "ConsultAuditEvent" DROP CONSTRAINT "ConsultAuditEvent_shape";
ALTER TABLE "ConsultAuditEvent" ADD CONSTRAINT "ConsultAuditEvent_shape" CHECK (
  ("action" = 'SESSION_CREATED' AND "fromStatus" IS NULL AND "toStatus" IS NOT NULL)
  OR ("action" IN ('AGREEMENT_ACCEPTED', 'AGREEMENT_REVOKED') AND "agreementAcceptanceId" IS NOT NULL)
  OR ("action" = 'LIFECYCLE_TRANSITIONED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
  OR ("action" = 'REVISION_CREATED' AND "revisionId" IS NOT NULL)
  OR ("action" = 'CAPTURE_UPLOAD_ISSUED' AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR ("action" IN ('CAPTURE_ATTACHED', 'CAPTURE_QUALITY_CHECKED', 'CAPTURE_DELETED') AND "captureId" IS NOT NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR ("action" = 'RAW_OBJECT_PURGED' AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR ("action" IN ('INSPIRATION_SOURCE_SELECTED', 'INSPIRATION_UPLOAD_ISSUED', 'INSPIRATION_UPLOAD_ATTACHED', 'INSPIRATION_REMOVED', 'INSPIRATION_RAW_PURGED')
      AND "inspirationId" IS NOT NULL AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR ("action" = 'BRIEF_FEEDBACK_RECORDED' AND "briefFeedbackId" IS NOT NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  OR ("action" IN ('CLIENT_RESULTS_SERVED', 'ME_CARD_TEASER_TAPPED') AND "briefFeedbackId" IS NULL AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL AND "captureId" IS NULL AND "inspirationId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
);

CREATE OR REPLACE FUNCTION "consult_inspiration_payload_guard"() RETURNS TRIGGER AS $$
DECLARE answer_count INTEGER; specific_count INTEGER;
BEGIN
  IF NEW."kind" <> 'INSPIRATION' THEN RETURN NEW; END IF;
  IF NEW."schemaVersion" <> 1 OR NEW."model" IS NOT NULL OR NEW."promptVersion" IS NOT NULL
    OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NEW."payload" - ARRAY['contractId','contractVersion','schemaVersion','source','inspirationId','complete','answers','exactClientDetails','possibleProfessionalInterpretation','catalogGuidance'] <> '{}'::jsonb
    OR NEW."payload" ->> 'contractId' IS DISTINCT FROM 'hair-color-guided-inspiration'
    OR NEW."payload" -> 'contractVersion' IS DISTINCT FROM '1'::jsonb
    OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR NEW."payload" ->> 'source' NOT IN ('NONE','PLATFORM_LOOK','BOOKED_PRO_LOOK','EXTERNAL_UPLOAD')
    OR jsonb_typeof(NEW."payload" -> 'complete') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(NEW."payload" -> 'answers') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."payload" -> 'exactClientDetails') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."payload" -> 'possibleProfessionalInterpretation') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."payload" -> 'catalogGuidance') IS DISTINCT FROM 'array'
    OR NEW."payload"::text ~* '\m(face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health)\M'
    OR NEW."payload"::text ~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
  THEN RAISE EXCEPTION 'invalid guided inspiration payload' USING ERRCODE = '23514'; END IF;
  answer_count := jsonb_array_length(NEW."payload" -> 'answers');
  SELECT count(*)::integer INTO specific_count FROM (
    SELECT 1
    FROM jsonb_array_elements(NEW."payload" -> 'answers') answer,
      LATERAL jsonb_array_elements_text(COALESCE(answer -> 'selectedValues', '[]'::jsonb)) selected(value)
    WHERE answer ->> 'questionKey' <> 'styling_walkthrough'
      AND selected.value NOT IN ('none', 'not-sure', 'not-part-of-goal', 'nothing-else')
    UNION ALL
    SELECT 1
    FROM jsonb_array_elements(NEW."payload" -> 'answers') answer
    WHERE answer ->> 'questionKey' = 'other_detail'
      AND NULLIF(btrim(COALESCE(answer ->> 'text', '')), '') IS NOT NULL
  ) specific_details;
  IF (NEW."payload" ->> 'source' = 'NONE' AND (NEW."payload" -> 'inspirationId' <> 'null'::jsonb OR answer_count <> 0 OR NEW."payload" -> 'complete' <> 'true'::jsonb))
    OR (NEW."payload" ->> 'source' <> 'NONE' AND jsonb_typeof(NEW."payload" -> 'inspirationId') IS DISTINCT FROM 'string')
    OR answer_count > 7
    OR answer_count <> (SELECT count(DISTINCT answer ->> 'questionKey') FROM jsonb_array_elements(NEW."payload" -> 'answers') answer)
    OR (NEW."payload" -> 'complete' = 'true'::jsonb AND NEW."payload" ->> 'source' <> 'NONE' AND (answer_count <> 7 OR specific_count < 3))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW."payload" -> 'answers') answer
      WHERE answer - ARRAY['questionKey','selectedValues','text','sentiment'] <> '{}'::jsonb
        OR NOT (answer ?& ARRAY['questionKey','selectedValues','text','sentiment'])
        OR answer ->> 'questionKey' NOT IN ('favorite_colors','avoid_colors','length_goal','fullness_goal','current_styling','styling_walkthrough','other_detail')
        OR jsonb_typeof(answer -> 'selectedValues') IS DISTINCT FROM 'array'
        OR jsonb_array_length(answer -> 'selectedValues') <> (
          SELECT count(DISTINCT selected.value)
          FROM jsonb_array_elements_text(answer -> 'selectedValues') selected(value)
        )
        OR jsonb_typeof(answer -> 'text') NOT IN ('string', 'null')
        OR jsonb_typeof(answer -> 'sentiment') NOT IN ('string', 'null')
        OR CASE answer ->> 'questionKey'
          WHEN 'favorite_colors' THEN jsonb_array_length(answer -> 'selectedValues') NOT BETWEEN 1 AND 4
          WHEN 'avoid_colors' THEN jsonb_array_length(answer -> 'selectedValues') NOT BETWEEN 1 AND 4
          WHEN 'other_detail' THEN jsonb_array_length(answer -> 'selectedValues') NOT BETWEEN 0 AND 1
          ELSE jsonb_array_length(answer -> 'selectedValues') <> 1
        END
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(answer -> 'selectedValues') selected(value)
          WHERE NOT CASE answer ->> 'questionKey'
            WHEN 'favorite_colors' THEN selected.value IN ('lightest-pieces','darkest-pieces','warm-golden','cool-smoky','copper-red','whole-color-mix','not-sure')
            WHEN 'avoid_colors' THEN selected.value IN ('lightest-pieces','darkest-pieces','warm-golden','cool-smoky','copper-red','none','not-sure')
            WHEN 'length_goal' THEN selected.value IN ('yes-same-length','longer','shorter','not-part-of-goal','not-sure')
            WHEN 'fullness_goal' THEN selected.value IN ('yes-same-fullness','more-full','less-full','not-part-of-goal','not-sure')
            WHEN 'current_styling' THEN selected.value IN ('yes-often','sometimes','no','not-sure')
            WHEN 'styling_walkthrough' THEN selected.value IN ('yes','no','not-sure')
            WHEN 'other_detail' THEN selected.value = 'nothing-else'
            ELSE FALSE
          END
        )
        OR (jsonb_array_length(answer -> 'selectedValues') > 1 AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(answer -> 'selectedValues') selected(value)
          WHERE selected.value IN ('none','not-sure','not-part-of-goal','nothing-else')
        ))
        OR (answer ->> 'questionKey' <> 'other_detail' AND (answer -> 'text' <> 'null'::jsonb OR answer -> 'sentiment' <> 'null'::jsonb))
        OR (answer ->> 'questionKey' = 'other_detail' AND NOT (
          (answer -> 'selectedValues' = '["nothing-else"]'::jsonb AND answer -> 'text' = 'null'::jsonb AND answer ->> 'sentiment' = 'NONE')
          OR (answer -> 'selectedValues' = '[]'::jsonb AND jsonb_typeof(answer -> 'text') = 'string' AND length(btrim(answer ->> 'text')) BETWEEN 1 AND 240 AND answer ->> 'sentiment' IN ('GOOD','BAD','BOTH'))
        ))
    )
  THEN RAISE EXCEPTION 'invalid guided inspiration review' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_payload_guard"() SET search_path = '';
CREATE TRIGGER "ConsultRevision_inspiration_payload_guard" BEFORE INSERT ON "ConsultRevision" FOR EACH ROW EXECUTE FUNCTION "consult_inspiration_payload_guard"();

-- A single database predicate mirrors the canonical Look read contract for the
-- two consult participants. It links by id only; Look bytes and ownership stay
-- in their original tables and storage lifecycle.
CREATE OR REPLACE FUNCTION "consult_inspiration_source_valid"(candidate public."ConsultInspiration")
RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN candidate."source" = 'EXTERNAL_UPLOAD' THEN
      candidate."status" = 'ATTACHED'
      AND candidate."purgedAt" IS NULL
      AND candidate."storageBucket" = 'media-private'
      AND candidate."storagePath" IS NOT NULL
      AND candidate."useExpiresAt" > CURRENT_TIMESTAMP
    WHEN candidate."source" IN ('PLATFORM_LOOK', 'BOOKED_PRO_LOOK') THEN EXISTS (
      SELECT 1
      FROM public."ConsultSession" session
      JOIN public."LookPost" look ON look."id" = candidate."sourceLookPostId"
      JOIN public."ProfessionalProfile" owner ON owner."id" = look."professionalId"
      WHERE session."id" = candidate."consultSessionId"
        AND look."status" = 'PUBLISHED'
        AND look."moderationStatus" = 'APPROVED'
        AND owner."verificationStatus" = 'APPROVED'
        AND (
          look."visibility" IN ('PUBLIC', 'UNLISTED')
          OR (
            look."visibility" = 'FOLLOWERS_ONLY'
            AND EXISTS (
              SELECT 1 FROM public."ProFollow" follow
              WHERE follow."clientId" = session."clientId"
                AND follow."professionalId" = look."professionalId"
            )
          )
        )
        AND (
          look."professionalId" = session."professionalId"
          OR look."visibility" IN ('PUBLIC', 'UNLISTED')
        )
        AND (
          (candidate."source" = 'BOOKED_PRO_LOOK'
            AND look."professionalId" = session."professionalId"
            AND look."clientAuthorId" IS NULL)
          OR
          (candidate."source" = 'PLATFORM_LOOK'
            AND NOT (look."professionalId" = session."professionalId"
              AND look."clientAuthorId" IS NULL))
        )
    )
    ELSE FALSE
  END;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION "consult_inspiration_source_valid"(public."ConsultInspiration") SET search_path = '';

-- Current means completed after the latest active agreement acceptance and,
-- when a source was chosen, still bound to that same currently accessible row.
CREATE OR REPLACE FUNCTION "consult_current_inspiration_complete"(session_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."ConsultRevision" review
    WHERE review."id" = (
      SELECT latest."id"
      FROM public."ConsultRevision" latest
      WHERE latest."consultSessionId" = session_id
        AND latest."kind" = 'INSPIRATION'
      ORDER BY latest."revision" DESC
      LIMIT 1
    )
      AND review."schemaVersion" = 1
      AND review."payload" -> 'complete' = 'true'::jsonb
      AND review."createdAt" >= COALESCE((
        SELECT max(acceptance."acceptedAt")
        FROM public."ConsultAgreementAcceptance" acceptance
        WHERE acceptance."consultSessionId" = session_id
          AND acceptance."revokedAt" IS NULL
      ), 'infinity'::timestamp)
      AND (
        review."payload" ->> 'source' = 'NONE'
        OR EXISTS (
          SELECT 1
          FROM public."ConsultInspiration" inspiration_source
          WHERE inspiration_source."id" = review."payload" ->> 'inspirationId'
            AND inspiration_source."consultSessionId" = session_id
            AND inspiration_source."status" = 'ATTACHED'
            AND inspiration_source."source"::text = review."payload" ->> 'source'
            AND public."consult_inspiration_source_valid"(inspiration_source)
        )
      )
  );
$$ LANGUAGE sql STABLE;
ALTER FUNCTION "consult_current_inspiration_complete"(TEXT) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_inspiration_guard"() RETURNS TRIGGER AS $$
DECLARE session_status public."ConsultSessionStatus"; booking_status public."BookingStatus"; booking_time TIMESTAMP(3);
BEGIN
  SELECT s."status", b."status", b."scheduledFor" INTO session_status, booking_status, booking_time
  FROM public."ConsultSession" s JOIN public."Booking" b ON b."id" = s."bookingId" WHERE s."id" = NEW."consultSessionId";
  IF TG_OP = 'INSERT' AND (session_status <> 'MEDIA_READY' OR booking_status NOT IN ('PENDING','ACCEPTED') OR booking_time <= CURRENT_TIMESTAMP OR NOT public."consult_current_agreements_active"(NEW."consultSessionId"))
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
END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_guard"() SET search_path = '';
CREATE TRIGGER "ConsultInspiration_guard" BEFORE INSERT OR UPDATE ON "ConsultInspiration" FOR EACH ROW EXECUTE FUNCTION "consult_inspiration_guard"();

CREATE OR REPLACE FUNCTION "consult_inspiration_delete_guard"() RETURNS TRIGGER AS $$
BEGIN IF OLD."source" = 'EXTERNAL_UPLOAD' AND OLD."purgedAt" IS NULL THEN RAISE EXCEPTION 'external inspiration must be verified purged before deletion' USING ERRCODE = '23514'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_delete_guard"() SET search_path = '';
CREATE TRIGGER "ConsultInspiration_delete_guard" BEFORE DELETE ON "ConsultInspiration" FOR EACH ROW EXECUTE FUNCTION "consult_inspiration_delete_guard"();

CREATE OR REPLACE FUNCTION "consult_inspiration_revision_requires_audit"() RETURNS TRIGGER AS $$
BEGIN IF NEW."kind" = 'INSPIRATION' AND NOT EXISTS (SELECT 1 FROM public."ConsultAuditEvent" WHERE "revisionId" = NEW."id" AND "consultSessionId" = NEW."consultSessionId" AND "action" = 'REVISION_CREATED') THEN RAISE EXCEPTION 'inspiration revision requires content-free audit evidence' USING ERRCODE = '23514'; END IF; RETURN NULL; END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_revision_requires_audit"() SET search_path = '';
CREATE CONSTRAINT TRIGGER "ConsultRevision_inspiration_requires_audit" AFTER INSERT ON "ConsultRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "consult_inspiration_revision_requires_audit"();

-- Preserve C4/C10-W1's full prerequisite function and add the new lifecycle
-- state plus the shared current-inspiration predicate.
DO $$ DECLARE definition TEXT; updated TEXT; BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure) INTO definition;
  updated := replace(definition, 'IF NEW."kind" = ''ANALYSIS'' AND session_status <> ''ANALYZING'' THEN', 'IF NEW."kind" = ''INSPIRATION'' AND session_status <> ''MEDIA_READY'' THEN RAISE EXCEPTION ''consult lifecycle does not permit inspiration revision in state %'', session_status USING ERRCODE = ''23514''; END IF; IF NEW."kind" = ''ANALYSIS'' AND session_status <> ''ANALYZING'' THEN');
  updated := replace(updated, 'IF current_intake_count <> 1 OR current_capture_count <> 4 THEN', 'IF current_intake_count <> 1 OR current_capture_count <> 4 OR NOT public."consult_current_inspiration_complete"(NEW."consultSessionId") THEN');
  IF updated = definition THEN RAISE EXCEPTION 'expected analysis prerequisite function not found'; END IF;
  EXECUTE updated;
END $$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- The same predicate gates MEDIA_READY -> ANALYSIS_PENDING, so direct SQL and
-- either app completion order cannot bypass guided-inspiration readiness.
DO $$ DECLARE definition TEXT; updated TEXT; BEGIN
  SELECT pg_get_functiondef('public.consult_lifecycle_guard()'::regprocedure) INTO definition;
  updated := replace(definition, 'IF accepted_slot_count <> 4 THEN', 'IF accepted_slot_count <> 4 OR NOT public."consult_current_inspiration_complete"(NEW."id") THEN');
  IF updated = definition THEN RAISE EXCEPTION 'expected lifecycle capture prerequisite not found'; END IF;
  EXECUTE updated;
END $$;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';

-- Extend both direct session revocation and booking cancellation/reschedule
-- fences. External use expiry follows the appointment plus 24 hours.
CREATE OR REPLACE FUNCTION "consult_raw_purge_fence"() RETURNS TRIGGER AS $$
BEGIN IF NEW."status" IN ('CONSENT_REVOKED','CANCELLED') AND NEW."status" <> OLD."status" THEN
  UPDATE public."UploadSession" SET "purgeEligibleAt" = CURRENT_TIMESTAMP WHERE "surface" = 'CLIENT_CONSULT' AND "consultSessionId" = NEW."id" AND "purgedAt" IS NULL;
  UPDATE public."ConsultCapture" SET "purgeEligibleAt" = CURRENT_TIMESTAMP, "purgeRequestedAt" = CURRENT_TIMESTAMP WHERE "consultSessionId" = NEW."id" AND "purgedAt" IS NULL;
  UPDATE public."ConsultInspiration" SET "purgeEligibleAt" = CURRENT_TIMESTAMP, "purgeRequestedAt" = CURRENT_TIMESTAMP WHERE "consultSessionId" = NEW."id" AND "source" = 'EXTERNAL_UPLOAD' AND "purgedAt" IS NULL;
END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_raw_purge_fence"() SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_booking_raw_purge_fence"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" NOT IN ('PENDING','ACCEPTED') OR NEW."scheduledFor" <= CURRENT_TIMESTAMP THEN
    UPDATE public."UploadSession" u SET "purgeEligibleAt" = CURRENT_TIMESTAMP FROM public."ConsultSession" s WHERE u."surface" = 'CLIENT_CONSULT' AND u."consultSessionId" = s."id" AND s."bookingId" = NEW."id" AND u."purgedAt" IS NULL;
    UPDATE public."ConsultCapture" c SET "purgeEligibleAt" = CURRENT_TIMESTAMP, "purgeRequestedAt" = CURRENT_TIMESTAMP FROM public."ConsultSession" s WHERE c."consultSessionId" = s."id" AND s."bookingId" = NEW."id" AND c."purgedAt" IS NULL;
    UPDATE public."ConsultInspiration" i SET "purgeEligibleAt" = CURRENT_TIMESTAMP, "purgeRequestedAt" = CURRENT_TIMESTAMP FROM public."ConsultSession" s WHERE i."consultSessionId" = s."id" AND s."bookingId" = NEW."id" AND i."source" = 'EXTERNAL_UPLOAD' AND i."purgedAt" IS NULL;
  ELSE
    UPDATE public."ConsultInspiration" i SET "useExpiresAt" = NEW."scheduledFor" + (NEW."totalDurationMinutes" * INTERVAL '1 minute') + INTERVAL '24 hours' FROM public."ConsultSession" s WHERE i."consultSessionId" = s."id" AND s."bookingId" = NEW."id" AND i."source" = 'EXTERNAL_UPLOAD' AND i."status" IN ('UPLOAD_PENDING','ATTACHED') AND i."purgedAt" IS NULL;
  END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_booking_raw_purge_fence"() SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_session_delete_requires_purge"() RETURNS TRIGGER AS $$
BEGIN IF EXISTS (SELECT 1 FROM public."ConsultCapture" WHERE "consultSessionId" = OLD."id" AND "purgedAt" IS NULL) OR EXISTS (SELECT 1 FROM public."UploadSession" WHERE "surface" = 'CLIENT_CONSULT' AND "consultSessionId" = OLD."id" AND "purgedAt" IS NULL) OR EXISTS (SELECT 1 FROM public."ConsultInspiration" WHERE "consultSessionId" = OLD."id" AND "source" = 'EXTERNAL_UPLOAD' AND "purgedAt" IS NULL) THEN RAISE EXCEPTION 'raw consult objects must be verified purged before session deletion' USING ERRCODE = '23514'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_session_delete_requires_purge"() SET search_path = '';

-- Version the deterministic brief so exact client selections and bounded
-- possible interpretation remain visibly separate, with no external pointer.
DO $$ DECLARE definition TEXT; updated TEXT; BEGIN
  SELECT pg_get_functiondef('public.consult_brief_payload_guard()'::regprocedure) INTO definition;
  updated := replace(definition, 'latest_intake_id TEXT;', 'latest_intake_id TEXT; latest_inspiration_id TEXT;');
  updated := replace(updated, 'IF NEW."schemaVersion" <> 1', 'SELECT "id" INTO latest_inspiration_id FROM public."ConsultRevision" WHERE "consultSessionId" = NEW."consultSessionId" AND "kind" = ''INSPIRATION'' ORDER BY "revision" DESC LIMIT 1; IF NEW."schemaVersion" <> 2');
  updated := replace(updated, 'hair-color-pro-brief-v1', 'hair-color-pro-brief-v2');
  updated := replace(updated, '''intakeRevisionId'', ''clientIntake''', '''intakeRevisionId'', ''inspiration'', ''clientIntake''');
  updated := replace(updated, 'NEW."payload" -> ''schemaVersion'' <> ''1''::jsonb', 'NEW."payload" -> ''schemaVersion'' <> ''2''::jsonb');
  updated := replace(updated, 'OR NEW."payload" ->> ''intakeRevisionId'' IS DISTINCT FROM latest_intake_id', 'OR NEW."payload" ->> ''intakeRevisionId'' IS DISTINCT FROM latest_intake_id OR NEW."payload" #>> ''{inspiration,revisionId}'' IS DISTINCT FROM latest_inspiration_id OR jsonb_typeof(NEW."payload" -> ''inspiration'') IS DISTINCT FROM ''object'' OR jsonb_typeof(NEW."payload" #> ''{inspiration,exactClientDetails}'') IS DISTINCT FROM ''array'' OR jsonb_typeof(NEW."payload" #> ''{inspiration,possibleProfessionalInterpretation}'') IS DISTINCT FROM ''array'' OR jsonb_typeof(NEW."payload" #> ''{inspiration,catalogGuidance}'') IS DISTINCT FROM ''array''');
  IF updated = definition THEN RAISE EXCEPTION 'expected C6 brief guard not found'; END IF;
  EXECUTE updated;
END $$;
ALTER FUNCTION "consult_brief_payload_guard"() SET search_path = '';

ALTER TABLE "ConsultInspiration" ENABLE ROW LEVEL SECURITY;
