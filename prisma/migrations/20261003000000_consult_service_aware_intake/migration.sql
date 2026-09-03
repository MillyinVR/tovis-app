-- Service-aware consult, slice 1 (Tori, 2026-09-03: the consult runs for EVERY
-- service, including categories that do not exist yet —
-- docs/product/CONSULT-SERVICE-AWARE-PLAN.md).
--
-- Four things, all additive or loosening, so the code deployed BEFORE this
-- migration keeps writing exactly what it wrote (migrate-deploy runs on every
-- merge to main, ahead of the code deploy):
--
--   1. `ServiceCategory.consultFamily` — the family the consult keys its packs
--      on. Every existing row takes OTHER; the live hair categories (and their
--      children) are backfilled HAIR.
--   2. `consult_session_scope_guard` and `consult_upload_session_guard` stop
--      requiring the hair-color slug. Ownership, category and lifecycle checks
--      are unchanged; only the vertical pin goes. The APPLICATION scope
--      (lib/consult/serviceScope.ts) still admits colour only until the final
--      slice flips it — this migration opens nothing on its own.
--   3. `consult_intake_payload_guard` learns the two new packs. The hair-color
--      branch is the previous function body, unchanged; each pack branch
--      re-validates keys, option values and the completion rule exactly as the
--      pack module declares them (lib/consult/intake/packs/*).
--   4. `consult_revision_requires_agreements` accepts an ANALYSIS revision on
--      top of any registered pack's complete intake, not only the colour one.
--      String-patched on the current definition with an asserted match, per the
--      convention the earlier patches set.

-- 1) Family enum + column + backfill ------------------------------------------

CREATE TYPE "ConsultServiceFamily" AS ENUM (
  'HAIR', 'SKIN', 'NAILS', 'BROWS_LASHES', 'MAKEUP', 'BODY', 'OTHER'
);

ALTER TABLE "ServiceCategory"
  ADD COLUMN "consultFamily" "ConsultServiceFamily" NOT NULL DEFAULT 'OTHER';

-- The live hair categories by slug, then anything parented under a HAIR
-- category (one level is all the taxonomy has; the loop covers deeper trees).
UPDATE "ServiceCategory"
  SET "consultFamily" = 'HAIR'
  WHERE "slug" IN ('hair-color', 'hair-extensions', 'cuts', 'hair', 'haircut', 'hair-treatment');

DO $$
DECLARE
  changed INTEGER;
BEGIN
  LOOP
    UPDATE "ServiceCategory" AS child
      SET "consultFamily" = 'HAIR'
      FROM "ServiceCategory" AS parent
      WHERE child."parentId" = parent."id"
        AND parent."consultFamily" = 'HAIR'
        AND child."consultFamily" <> 'HAIR';
    GET DIAGNOSTICS changed = ROW_COUNT;
    EXIT WHEN changed = 0;
  END LOOP;
END;
$$;

-- 2) Scope guards: drop the vertical pin ------------------------------------

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
    INTO scope_matches
    FROM public."Booking" AS booking
    JOIN public."Service" AS service ON service."id" = booking."serviceId"
    WHERE booking."id" = NEW."bookingId";

    IF scope_matches IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'consult session must match its booking client, professional, and service category'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."anchorLookPostId" IS NOT NULL THEN
    SELECT
      look."professionalId" = NEW."professionalId"
      AND category."id" IS NOT NULL
    INTO scope_matches
    FROM public."LookPost" AS look
    LEFT JOIN public."ServiceCategory" AS category ON category."id" = NEW."serviceCategoryId"
    WHERE look."id" = NEW."anchorLookPostId";

    IF scope_matches IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'look-anchored consult must match its look professional and name a service category'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'consult session must be anchored to a booking or a look'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_session_scope_guard"() SET search_path = '';

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
    AND category."isActive"
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

-- 3) Intake payload guard: one branch per registered pack --------------------

CREATE OR REPLACE FUNCTION "consult_intake_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  answers JSONB;
  pack_id TEXT;
  goal_direction_required BOOLEAN;
BEGIN
  IF NEW."kind" <> 'INTAKE' THEN
    RETURN NEW;
  END IF;

  pack_id := NEW."payload" ->> 'packId';

  -- Shape shared by every pack: exact keys, boolean complete, object answers,
  -- schema version mirrored on the row, no model/prompt on an intake row.
  IF jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NEW."payload" - ARRAY[
      'packId', 'packVersion', 'schemaVersion', 'complete', 'answers'
    ] <> '{}'::jsonb
    OR pack_id IS NULL
    OR pack_id NOT IN ('hair-color', 'hair-general', 'general-service')
    OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM '2'::jsonb
    OR NEW."schemaVersion" <> 2
    OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM to_jsonb(NEW."schemaVersion")
    OR jsonb_typeof(NEW."payload" -> 'complete') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(NEW."payload" -> 'answers') IS DISTINCT FROM 'object'
    OR NEW."model" IS NOT NULL
    OR NEW."promptVersion" IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid consult intake payload version or shape'
      USING ERRCODE = '23514';
  END IF;

  answers := NEW."payload" -> 'answers';
  IF answers = '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_each(answers) AS answer
      WHERE jsonb_typeof(answer.value) <> 'string'
    )
  THEN
    RAISE EXCEPTION 'invalid consult intake answers'
      USING ERRCODE = '23514';
  END IF;

  -- ── hair-color v2 (unchanged from 20260912000000) ─────────────────────────
  IF pack_id = 'hair-color' THEN
    IF NEW."payload" -> 'packVersion' IS DISTINCT FROM '2'::jsonb THEN
      RAISE EXCEPTION 'invalid hair-color intake payload version or shape'
        USING ERRCODE = '23514';
    END IF;

    IF answers - ARRAY[
        'current_color', 'desired_color', 'change_scale', 'goal_direction',
        'box_dye_history', 'prior_lightening', 'henna_plant_dye_history',
        'perm_history', 'relaxer_texturizer_history',
        'keratin_smoothing_history', 'other_chemical_history',
        'last_color_service_timing', 'prior_reaction', 'event_timing', 'budget'
      ] <> '{}'::jsonb
      OR (answers ? 'current_color' AND answers ->> 'current_color' NOT IN (
        'blonde', 'brunette', 'black', 'red', 'gray', 'other'
      ))
      OR (answers ? 'desired_color' AND answers ->> 'desired_color' NOT IN (
        'blonde', 'brunette', 'black', 'red', 'fantasy', 'not-sure'
      ))
      OR (answers ? 'change_scale' AND answers ->> 'change_scale' NOT IN (
        'subtle', 'noticeable', 'total'
      ))
      OR (answers ? 'goal_direction' AND answers ->> 'goal_direction' NOT IN (
        'lighter', 'darker', 'warmer', 'less-warm', 'brighter-pieces',
        'softer-root-contrast', 'gray-blending', 'richer-color', 'more-shine',
        'not-sure'
      ))
      OR (answers ? 'box_dye_history' AND answers ->> 'box_dye_history' NOT IN (
        'never', 'within-6-months', '6-12-months', 'over-12-months', 'not-sure'
      ))
      OR (answers ? 'prior_lightening' AND answers ->> 'prior_lightening' NOT IN (
        'never', 'within-3-months', '3-6-months', '6-12-months',
        'over-12-months', 'not-sure'
      ))
      OR EXISTS (
        SELECT 1
        FROM jsonb_each(answers) AS treatment
        WHERE treatment.key IN (
          'henna_plant_dye_history', 'perm_history',
          'relaxer_texturizer_history', 'keratin_smoothing_history',
          'other_chemical_history'
        )
          AND treatment.value #>> '{}' NOT IN (
            'never', 'within-6-months', '6-12-months', 'over-12-months',
            'not-sure'
          )
      )
      OR (answers ? 'last_color_service_timing' AND answers ->> 'last_color_service_timing' NOT IN (
        'never', 'within-4-weeks', '1-3-months', '4-6-months', '7-12-months',
        'over-12-months', 'not-sure'
      ))
      OR (answers ? 'prior_reaction' AND answers ->> 'prior_reaction' NOT IN (
        'no', 'yes', 'not-sure'
      ))
      OR (answers ? 'event_timing' AND answers ->> 'event_timing' NOT IN (
        'no-deadline', 'within-2-weeks', '2-4-weeks', '1-3-months',
        'over-3-months'
      ))
      OR (answers ? 'budget' AND answers ->> 'budget' NOT IN (
        'under-150', '150-250', '251-400', 'over-400', 'discuss-with-pro'
      ))
    THEN
      RAISE EXCEPTION 'invalid hair-color intake answers'
        USING ERRCODE = '23514';
    END IF;

    goal_direction_required :=
      answers ->> 'desired_color' = 'not-sure'
      OR answers ->> 'current_color' = answers ->> 'desired_color'
      OR answers ->> 'change_scale' = 'subtle';

    IF (NEW."payload" ->> 'complete')::boolean
      AND (
        NOT answers ?& ARRAY[
          'current_color', 'desired_color', 'change_scale', 'box_dye_history',
          'prior_lightening', 'henna_plant_dye_history', 'perm_history',
          'relaxer_texturizer_history', 'keratin_smoothing_history',
          'other_chemical_history', 'last_color_service_timing', 'prior_reaction'
        ]
        OR answers ->> 'goal_direction' = 'not-sure'
        OR (goal_direction_required AND NOT answers ? 'goal_direction')
      )
    THEN
      RAISE EXCEPTION 'complete hair-color intake is missing a resolved required answer'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  -- ── hair-general v1 (lib/consult/intake/packs/hairGeneral.ts) ─────────────
  IF pack_id = 'hair-general' THEN
    IF NEW."payload" -> 'packVersion' IS DISTINCT FROM '1'::jsonb THEN
      RAISE EXCEPTION 'invalid hair-general intake payload version or shape'
        USING ERRCODE = '23514';
    END IF;

    IF answers - ARRAY[
        'service_experience', 'change_scale', 'goal_direction', 'current_length',
        'hair_texture', 'chemical_history', 'prior_lightening',
        'last_service_timing', 'prior_reaction', 'maintenance_tolerance',
        'event_timing', 'budget'
      ] <> '{}'::jsonb
      OR (answers ? 'service_experience' AND answers ->> 'service_experience' NOT IN (
        'first-time', 'had-before', 'regular'
      ))
      OR (answers ? 'change_scale' AND answers ->> 'change_scale' NOT IN (
        'subtle', 'noticeable', 'total'
      ))
      OR (answers ? 'goal_direction' AND answers ->> 'goal_direction' NOT IN (
        'length', 'volume-fullness', 'shape-style', 'texture-movement',
        'health-condition', 'easier-upkeep', 'not-sure'
      ))
      OR (answers ? 'current_length' AND answers ->> 'current_length' NOT IN (
        'very-short', 'above-shoulder', 'shoulder', 'mid-back', 'waist-or-longer'
      ))
      OR (answers ? 'hair_texture' AND answers ->> 'hair_texture' NOT IN (
        'straight', 'wavy', 'curly', 'coily', 'not-sure'
      ))
      OR (answers ? 'chemical_history' AND answers ->> 'chemical_history' NOT IN (
        'never', 'within-6-months', '6-12-months', 'over-12-months', 'not-sure'
      ))
      OR (answers ? 'prior_lightening' AND answers ->> 'prior_lightening' NOT IN (
        'never', 'within-3-months', '3-6-months', '6-12-months',
        'over-12-months', 'not-sure'
      ))
      OR (answers ? 'last_service_timing' AND answers ->> 'last_service_timing' NOT IN (
        'never', 'within-4-weeks', '1-3-months', '4-6-months', '7-12-months',
        'over-12-months', 'not-sure'
      ))
      OR (answers ? 'prior_reaction' AND answers ->> 'prior_reaction' NOT IN (
        'no', 'yes', 'not-sure'
      ))
      OR (answers ? 'maintenance_tolerance' AND answers ->> 'maintenance_tolerance' NOT IN (
        'low', 'medium', 'high'
      ))
      OR (answers ? 'event_timing' AND answers ->> 'event_timing' NOT IN (
        'no-deadline', 'within-2-weeks', '2-4-weeks', '1-3-months',
        'over-3-months'
      ))
      OR (answers ? 'budget' AND answers ->> 'budget' NOT IN (
        'under-150', '150-250', '251-400', 'over-400', 'discuss-with-pro'
      ))
    THEN
      RAISE EXCEPTION 'invalid hair-general intake answers'
        USING ERRCODE = '23514';
    END IF;

    goal_direction_required := answers ->> 'change_scale' = 'subtle';

    IF (NEW."payload" ->> 'complete')::boolean
      AND (
        NOT answers ?& ARRAY[
          'service_experience', 'change_scale', 'current_length', 'hair_texture',
          'chemical_history', 'prior_lightening', 'last_service_timing',
          'prior_reaction'
        ]
        OR answers ->> 'goal_direction' = 'not-sure'
        OR (goal_direction_required AND NOT answers ? 'goal_direction')
      )
    THEN
      RAISE EXCEPTION 'complete hair-general intake is missing a resolved required answer'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  -- ── general-service v1 (lib/consult/intake/packs/generalService.ts) ───────
  IF pack_id = 'general-service' THEN
    IF NEW."payload" -> 'packVersion' IS DISTINCT FROM '1'::jsonb THEN
      RAISE EXCEPTION 'invalid general-service intake payload version or shape'
        USING ERRCODE = '23514';
    END IF;

    IF answers - ARRAY[
        'service_experience', 'change_scale', 'goal_direction',
        'recent_treatment_timing', 'skin_sensitivity', 'known_allergies',
        'prior_reaction', 'last_service_timing', 'maintenance_tolerance',
        'event_timing', 'budget'
      ] <> '{}'::jsonb
      OR (answers ? 'service_experience' AND answers ->> 'service_experience' NOT IN (
        'first-time', 'had-before', 'regular'
      ))
      OR (answers ? 'change_scale' AND answers ->> 'change_scale' NOT IN (
        'subtle', 'noticeable', 'total'
      ))
      OR (answers ? 'goal_direction' AND answers ->> 'goal_direction' NOT IN (
        'shape', 'color-tone', 'fullness-definition', 'smoothness-condition',
        'longer-lasting', 'more-natural', 'bolder', 'not-sure'
      ))
      OR (answers ? 'recent_treatment_timing' AND answers ->> 'recent_treatment_timing' NOT IN (
        'never', 'within-6-months', '6-12-months', 'over-12-months', 'not-sure'
      ))
      OR (answers ? 'skin_sensitivity' AND answers ->> 'skin_sensitivity' NOT IN (
        'no', 'sometimes', 'yes', 'not-sure'
      ))
      OR (answers ? 'known_allergies' AND answers ->> 'known_allergies' NOT IN (
        'none-known', 'yes', 'not-sure'
      ))
      OR (answers ? 'prior_reaction' AND answers ->> 'prior_reaction' NOT IN (
        'no', 'yes', 'not-sure'
      ))
      OR (answers ? 'last_service_timing' AND answers ->> 'last_service_timing' NOT IN (
        'never', 'within-4-weeks', '1-3-months', '4-6-months', '7-12-months',
        'over-12-months', 'not-sure'
      ))
      OR (answers ? 'maintenance_tolerance' AND answers ->> 'maintenance_tolerance' NOT IN (
        'low', 'medium', 'high'
      ))
      OR (answers ? 'event_timing' AND answers ->> 'event_timing' NOT IN (
        'no-deadline', 'within-2-weeks', '2-4-weeks', '1-3-months',
        'over-3-months'
      ))
      OR (answers ? 'budget' AND answers ->> 'budget' NOT IN (
        'under-150', '150-250', '251-400', 'over-400', 'discuss-with-pro'
      ))
    THEN
      RAISE EXCEPTION 'invalid general-service intake answers'
        USING ERRCODE = '23514';
    END IF;

    goal_direction_required := answers ->> 'change_scale' = 'subtle';

    IF (NEW."payload" ->> 'complete')::boolean
      AND (
        NOT answers ?& ARRAY[
          'service_experience', 'change_scale', 'recent_treatment_timing',
          'skin_sensitivity', 'known_allergies', 'prior_reaction',
          'last_service_timing'
        ]
        OR answers ->> 'goal_direction' = 'not-sure'
        OR (goal_direction_required AND NOT answers ? 'goal_direction')
      )
    THEN
      RAISE EXCEPTION 'complete general-service intake is missing a resolved required answer'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  -- Unreachable: pack_id was checked against the registered list above.
  RAISE EXCEPTION 'unknown consult intake pack'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_intake_payload_guard"() SET search_path = '';

-- 4) Analysis prerequisite: a complete intake on ANY registered pack ---------

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;

  updated := replace(
    definition,
    'AND intake."payload" ->> ''packId'' = ''hair-color''',
    'AND intake."payload" ->> ''packId'' IN (''hair-color'', ''hair-general'', ''general-service'')'
  );
  IF position('IN (''hair-color'', ''hair-general'', ''general-service'')' in updated) = 0 THEN
    RAISE EXCEPTION 'expected consult revision guard intake pack pin not found';
  END IF;

  -- The pack version pin was written for the colour pack (v2). The new packs
  -- are v1; the per-pack version is enforced by consult_intake_payload_guard
  -- on the intake row itself, so here only "current schema, complete" remains.
  updated := replace(
    updated,
    'AND intake."payload" -> ''packVersion'' = ''2''::jsonb',
    'AND intake."payload" -> ''packVersion'' IS NOT NULL'
  );
  IF position('AND intake."payload" -> ''packVersion'' IS NOT NULL' in updated) = 0 THEN
    RAISE EXCEPTION 'expected consult revision guard intake pack version pin not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';
