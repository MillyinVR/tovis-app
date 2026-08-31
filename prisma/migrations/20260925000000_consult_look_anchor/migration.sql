-- Book the Look, slice B2: a consult may be anchored to a LOOK instead of a
-- booking (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 12).
--
-- ADDITIVE ONLY. Consult is forward-only past the shipped migrations, so this
-- adds a second anchor rather than repurposing anything: `bookingId` relaxes
-- from NOT NULL to nullable, `anchorLookPostId` is new, and every existing row
-- keeps its booking, its unique index, and its exact behaviour. Nothing is
-- dropped or re-typed.
--
-- The interesting half is the guards. Four database guards join Booking on
-- `ConsultSession."bookingId"` with an INNER JOIN. With a NULL bookingId that
-- join yields NO ROW, which does NOT fail closed:
--
--   * consult_session_scope_guard      -> scope_matches NULL -> refuses (blocks
--                                         look-anchored creation outright)
--   * consult_revision_requires_agreements -> every local is NULL, so the
--                                         booking check, the lifecycle check
--                                         AND the revision-sequence check all
--                                         evaluate to NULL and pass. A guard
--                                         that stops guarding is worse than one
--                                         that refuses, so this is the change
--                                         that matters most below.
--   * consult_inspiration_guard        -> same silent pass on INSERT
--   * consult_upload_session_guard     -> refuses (NULL = NULL is not TRUE)
--
-- Each is taught the two-anchor rule explicitly: booking checks apply when
-- there IS a booking, and the non-booking invariants (lifecycle, consent,
-- sequence, scope) apply to BOTH anchors.

-- 1) The column and its invariants.
ALTER TABLE "ConsultSession" ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE "ConsultSession" ADD COLUMN "anchorLookPostId" TEXT;

-- A consult with no anchor at all was impossible before and stays impossible.
ALTER TABLE "ConsultSession"
  ADD CONSTRAINT "ConsultSession_anchor_present" CHECK (
    "bookingId" IS NOT NULL OR "anchorLookPostId" IS NOT NULL
  );

-- Idempotent "book this look": one look-anchored consult per (client, look,
-- pro). Booking-anchored rows all have a NULL anchorLookPostId and are
-- therefore never constrained by this index (Postgres treats each NULL as
-- distinct), so the existing one-consult-per-booking rule is untouched. It is
-- also the only index the anchor needs: every read of it is keyed by
-- (clientId, professionalId, anchorLookPostId).
CREATE UNIQUE INDEX "ConsultSession_clientId_professionalId_anchorLookPostId_key"
  ON "ConsultSession" ("clientId", "professionalId", "anchorLookPostId");

-- 2) Scope guard: full redefinition (current definition = 20260905000002).
--
-- Booking arm: byte-for-byte the rule that shipped — the booking must agree
-- with the session's client, professional and category, and be hair-color.
--
-- Look arm: the Look must exist, must belong to the session's professional
-- (the pro you book when you book her look — for a client-authored look that
-- is still the visited pro, LookPost.professionalId), and the session's own
-- service category must be the pilot vertical. It deliberately does NOT
-- re-derive the category from the Look's service linkage: that derivation is
-- lib/looks/serviceOwnership.ts's job, and a second copy of it in SQL would go
-- stale behind its own green check.
CREATE OR REPLACE FUNCTION "consult_session_scope_guard"()
RETURNS TRIGGER AS $$
DECLARE
  scope_matches BOOLEAN;
BEGIN
  IF NEW."bookingId" IS NOT NULL THEN
    SELECT
      booking."clientId" = NEW."clientId"
      AND booking."professionalId" = NEW."professionalId"
      AND service."categoryId" = NEW."serviceCategoryId"
      AND category."slug" = 'hair-color'
    INTO scope_matches
    FROM public."Booking" AS booking
    JOIN public."Service" AS service ON service."id" = booking."serviceId"
    JOIN public."ServiceCategory" AS category ON category."id" = service."categoryId"
    WHERE booking."id" = NEW."bookingId";

    IF scope_matches IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'consult session must match its booking client, professional, and hair-color category'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."anchorLookPostId" IS NOT NULL THEN
    SELECT
      look."professionalId" = NEW."professionalId"
      AND category."slug" = 'hair-color'
    INTO scope_matches
    FROM public."LookPost" AS look
    JOIN public."ServiceCategory" AS category ON category."id" = NEW."serviceCategoryId"
    WHERE look."id" = NEW."anchorLookPostId";

    IF scope_matches IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'look-anchored consult must match its look professional and hair-color category'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'consult session must be anchored to a booking or a look'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_session_scope_guard"() SET search_path = '';

DROP TRIGGER "ConsultSession_scope_guard" ON "ConsultSession";
CREATE TRIGGER "ConsultSession_scope_guard"
  BEFORE INSERT OR UPDATE OF "clientId", "bookingId", "anchorLookPostId", "professionalId", "serviceCategoryId"
  ON "ConsultSession"
  FOR EACH ROW EXECUTE FUNCTION "consult_session_scope_guard"();

-- 3) Revision prerequisite guard: string-replace patches on the CURRENT
-- definition (20260908000000 as patched by 20260914000000 and 20260921000000),
-- following the convention those migrations set. Each replacement asserts its
-- own result, so a definition that has drifted aborts the migration instead of
-- silently no-op'ing.
--
--   a. INNER JOIN -> LEFT JOIN, so a look-anchored session still yields its
--      status and revisionSequence and the checks below actually run.
--   b. a missing session row now fails closed (it used to be caught only as a
--      side effect of the booking check).
--   c. the booking eligibility window applies only when there IS a booking.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;

  updated := replace(
    definition,
    'JOIN public."Booking" AS booking ON booking."id" = session."bookingId"',
    'LEFT JOIN public."Booking" AS booking ON booking."id" = session."bookingId"'
  );
  IF position('LEFT JOIN public."Booking" AS booking' in updated) = 0 THEN
    RAISE EXCEPTION 'expected consult revision guard booking join not found';
  END IF;

  updated := replace(
    updated,
    'IF NOT public."consult_current_agreements_active"(NEW."consultSessionId") THEN',
    'IF session_status IS NULL THEN'
    || E'\n    RAISE EXCEPTION ''consult session not found for revision'''
    || E'\n      USING ERRCODE = ''23514'';'
    || E'\n  END IF;'
    || E'\n  IF NOT public."consult_current_agreements_active"(NEW."consultSessionId") THEN'
  );
  IF position('consult session not found for revision' in updated) = 0 THEN
    RAISE EXCEPTION 'expected consult revision guard consent check not found';
  END IF;

  updated := replace(
    updated,
    'IF booking_status NOT IN (''PENDING'', ''ACCEPTED'')',
    'IF booking_status IS NOT NULL AND (booking_status NOT IN (''PENDING'', ''ACCEPTED'')'
  );
  updated := replace(
    updated,
    'OR booking_scheduled_for > CURRENT_TIMESTAMP + INTERVAL ''90 days''',
    'OR booking_scheduled_for > CURRENT_TIMESTAMP + INTERVAL ''90 days'')'
  );
  IF position('booking_status IS NOT NULL AND (booking_status NOT IN' in updated) = 0
    OR position('INTERVAL ''90 days'')' in updated) = 0
  THEN
    RAISE EXCEPTION 'expected consult revision guard booking window not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- 4) Inspiration guard: full redefinition (current definition =
-- 20260913000001, never patched since). Same rules; the booking status/time
-- clause now applies only when the consult has a booking, and a missing
-- session row fails closed instead of passing on NULLs.
CREATE OR REPLACE FUNCTION "consult_inspiration_guard"() RETURNS TRIGGER AS $$
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
    OR session_status <> 'MEDIA_READY'
    OR (session_booking_id IS NOT NULL AND (
      booking_status NOT IN ('PENDING','ACCEPTED') OR booking_time <= CURRENT_TIMESTAMP
    ))
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
END; $$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_guard"() SET search_path = '';

-- 5) Consult upload shape + guard.
--
-- The CHECK could only ever say "bookingId IS NOT NULL" unconditionally, and a
-- CHECK cannot join to find out whether this consult HAS a booking. So the
-- bookingId requirement moves down to the trigger, which already joins the
-- session and can require the exact correspondence for both anchors — strictly
-- stronger than the CHECK it replaces for booking-anchored uploads, which the
-- trigger already enforced by equality.
ALTER TABLE "UploadSession" DROP CONSTRAINT "UploadSession_consult_shape";
ALTER TABLE "UploadSession"
  ADD CONSTRAINT "UploadSession_consult_shape" CHECK (
    (
      "surface" <> 'CLIENT_CONSULT'
      AND "consultSessionId" IS NULL
      AND "serviceCategoryId" IS NULL
      AND "consultShotKey" IS NULL
      AND "shotPackVersion" IS NULL
      AND "captureSchemaVersion" IS NULL
      AND "idempotencyKey" IS NULL
      AND "requestHash" IS NULL
      AND "rawExpiresAt" IS NULL
      AND "purgeEligibleAt" IS NULL
      AND "purgedAt" IS NULL
    ) OR (
      "surface" = 'CLIENT_CONSULT'
      AND "consultSessionId" IS NOT NULL
      AND "clientId" IS NOT NULL
      AND "professionalId" IS NOT NULL
      AND "serviceCategoryId" IS NOT NULL
      AND (
        (
          "shotPackVersion" = 1
          AND "consultShotKey" IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
        ) OR (
          "shotPackVersion" = 2
          AND "consultShotKey" IN (
            'hair_back', 'hair_left', 'hair_right', 'hair_crown',
            'face_front', 'face_side', 'eyes_closeup'
          )
        )
      )
      AND "captureSchemaVersion" = 1
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
      AND "idempotencyKey" = btrim("idempotencyKey")
      AND "requestHash" ~ '^[0-9a-f]{64}$'
      AND "rawExpiresAt" > "expiresAt"
      AND "rawExpiresAt" <= "createdAt" + INTERVAL '24 hours'
      AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
      AND "maxBytes" BETWEEN 1 AND 5000000
      AND ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$')
      AND (
        ("purgedAt" IS NULL AND "storageBucket" = 'media-private'
          AND "storagePath" ~ '^consult-raw/v1/[0-9a-f-]{36}\.(jpg|png|webp)$')
        OR
        ("purgedAt" IS NOT NULL AND "storageBucket" = 'purged'
          AND "storagePath" = 'purged/' || "id")
      )
    )
  );

-- Full redefinition (current definition = 20260907000001). Three changes:
--   * `IS NOT DISTINCT FROM` on bookingId — keeps the exact correspondence for
--     booking-anchored uploads (NULL = NULL was never TRUE) and requires NULL
--     for look-anchored ones. This is what replaces the CHECK clause above.
--   * the booking status/time window applies only when there IS a booking.
--   * the hair-color slug is read from the SESSION's own serviceCategoryId
--     instead of through the booking's service. For a booking-anchored consult
--     those are provably the same category — consult_session_scope_guard
--     enforces service."categoryId" = NEW."serviceCategoryId" — and it is the
--     only reading that exists at all for a look anchor.
CREATE OR REPLACE FUNCTION "consult_upload_session_guard"()
RETURNS TRIGGER AS $$
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
    AND session."status" = 'MEDIA_READY'
    AND (
      session."bookingId" IS NULL
      OR (
        booking."status" IN ('PENDING', 'ACCEPTED')
        AND booking."scheduledFor" > CURRENT_TIMESTAMP
        AND booking."scheduledFor" <= CURRENT_TIMESTAMP + INTERVAL '90 days'
      )
    )
    AND category."slug" = 'hair-color'
  INTO scope_matches
  FROM public."ConsultSession" AS session
  LEFT JOIN public."Booking" AS booking ON booking."id" = session."bookingId"
  JOIN public."ServiceCategory" AS category ON category."id" = session."serviceCategoryId"
  WHERE session."id" = NEW."consultSessionId";

  IF scope_matches IS DISTINCT FROM TRUE
    OR NOT public."consult_current_agreements_active"(NEW."consultSessionId")
  THEN
    RAISE EXCEPTION 'consult upload requires current prerequisites and exact eligible scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_upload_session_guard"() SET search_path = '';
