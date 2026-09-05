-- P6 — the intake diet (docs/consult/tovis-ai-consult-handoff.md, Part 0/Stage 2).
--
-- Tori: the consult must feel like an impulse "pull the trigger", not a form.
-- Every intake pack ships a NEW VERSION carrying only the questions the
-- analysis cannot answer for itself. Questions whose answer is visible in the
-- photos are dropped; questions the PRO wants move to the post-booking
-- follow-up on the Look Brief (lib/consult/intake/followUp.ts).
--
--   hair-color      v2 (15 questions) → v3 (7)
--   hair-general    v1 (12 questions) → v2 (5)
--   general-service v1 (11 questions) → v2 (6)
--
-- This migration teaches `consult_intake_payload_guard` the new versions. Two
-- properties make it safe to run ahead of the code deploy, which is what
-- migrate-deploy.yml does on every merge:
--
--   1. Every OLD branch is byte-identical to the branch this replaces, so a
--      payload the currently deployed code writes still passes. In-flight
--      sessions stay on the version they started on
--      (`resolveConsultSessionIntakePack`), and the 19 stored hair-color v2
--      INTAKE rows keep validating.
--   2. Every question a new version KEEPS keeps its key and its option values
--      exactly. `consult_analysis_payload_guard` mirrors the safety policy off
--      those keys (prior_reaction, box_dye_history, prior_lightening,
--      chemical_history, recent_treatment_timing, known_allergies,
--      skin_sensitivity, and the PRESENCE of maintenance_tolerance) and reads
--      no packVersion, so it needs no change: a key a new version no longer
--      asks is simply absent, which is the same answer it has always given for
--      a pack that never asked.
--
-- The `schemaVersion` stays 2 throughout — the payload ENVELOPE is unchanged;
-- only the pack's contents moved.

CREATE OR REPLACE FUNCTION "consult_intake_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  answers JSONB;
  pack_id TEXT;
  pack_version JSONB;
  goal_direction_required BOOLEAN;
BEGIN
  IF NEW."kind" <> 'INTAKE' THEN
    RETURN NEW;
  END IF;

  pack_id := NEW."payload" ->> 'packId';
  pack_version := NEW."payload" -> 'packVersion';

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

  -- ── hair-color ────────────────────────────────────────────────────────────
  IF pack_id = 'hair-color' THEN
    IF pack_version IS DISTINCT FROM '2'::jsonb
      AND pack_version IS DISTINCT FROM '3'::jsonb
    THEN
      RAISE EXCEPTION 'invalid hair-color intake payload version or shape'
        USING ERRCODE = '23514';
    END IF;

    -- v2 (unchanged from 20261003000000) --------------------------------------
    IF pack_version = '2'::jsonb THEN
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

    -- v3 — the diet (lib/consult/intake/packs/hairColor.ts) -------------------
    -- Dropped: current_color and desired_color (the starting-point photos and
    -- the inspiration reference are read for both); perm, relaxer/texturizer
    -- and keratin/smoothing (folded into other_chemical_history, same values,
    -- same routing); last_color_service_timing, event_timing and budget (moved
    -- to the follow-up). goal_direction is now ambiguous only on a subtle
    -- change, because the colour pair it also keyed on is gone.
    IF answers - ARRAY[
        'change_scale', 'goal_direction', 'box_dye_history', 'prior_lightening',
        'henna_plant_dye_history', 'other_chemical_history', 'prior_reaction'
      ] <> '{}'::jsonb
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
          'henna_plant_dye_history', 'other_chemical_history'
        )
          AND treatment.value #>> '{}' NOT IN (
            'never', 'within-6-months', '6-12-months', 'over-12-months',
            'not-sure'
          )
      )
      OR (answers ? 'prior_reaction' AND answers ->> 'prior_reaction' NOT IN (
        'no', 'yes', 'not-sure'
      ))
    THEN
      RAISE EXCEPTION 'invalid hair-color intake answers'
        USING ERRCODE = '23514';
    END IF;

    goal_direction_required := answers ->> 'change_scale' = 'subtle';

    IF (NEW."payload" ->> 'complete')::boolean
      AND (
        NOT answers ?& ARRAY[
          'change_scale', 'box_dye_history', 'prior_lightening',
          'henna_plant_dye_history', 'other_chemical_history', 'prior_reaction'
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

  -- ── hair-general ──────────────────────────────────────────────────────────
  IF pack_id = 'hair-general' THEN
    IF pack_version IS DISTINCT FROM '1'::jsonb
      AND pack_version IS DISTINCT FROM '2'::jsonb
    THEN
      RAISE EXCEPTION 'invalid hair-general intake payload version or shape'
        USING ERRCODE = '23514';
    END IF;

    -- v1 (unchanged from 20261003000000) --------------------------------------
    IF pack_version = '1'::jsonb THEN
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

    -- v2 — the diet (lib/consult/intake/packs/hairGeneral.ts) -----------------
    -- Dropped: current_length and hair_texture (the hair capture pack
    -- photographs front, back, sides and a close-up); service_experience,
    -- last_service_timing, maintenance_tolerance, event_timing and budget
    -- (moved to the follow-up).
    IF answers - ARRAY[
        'change_scale', 'goal_direction', 'chemical_history', 'prior_lightening',
        'prior_reaction'
      ] <> '{}'::jsonb
      OR (answers ? 'change_scale' AND answers ->> 'change_scale' NOT IN (
        'subtle', 'noticeable', 'total'
      ))
      OR (answers ? 'goal_direction' AND answers ->> 'goal_direction' NOT IN (
        'length', 'volume-fullness', 'shape-style', 'texture-movement',
        'health-condition', 'easier-upkeep', 'not-sure'
      ))
      OR (answers ? 'chemical_history' AND answers ->> 'chemical_history' NOT IN (
        'never', 'within-6-months', '6-12-months', 'over-12-months', 'not-sure'
      ))
      OR (answers ? 'prior_lightening' AND answers ->> 'prior_lightening' NOT IN (
        'never', 'within-3-months', '3-6-months', '6-12-months',
        'over-12-months', 'not-sure'
      ))
      OR (answers ? 'prior_reaction' AND answers ->> 'prior_reaction' NOT IN (
        'no', 'yes', 'not-sure'
      ))
    THEN
      RAISE EXCEPTION 'invalid hair-general intake answers'
        USING ERRCODE = '23514';
    END IF;

    goal_direction_required := answers ->> 'change_scale' = 'subtle';

    IF (NEW."payload" ->> 'complete')::boolean
      AND (
        NOT answers ?& ARRAY[
          'change_scale', 'chemical_history', 'prior_lightening', 'prior_reaction'
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

  -- ── general-service ───────────────────────────────────────────────────────
  IF pack_id = 'general-service' THEN
    IF pack_version IS DISTINCT FROM '1'::jsonb
      AND pack_version IS DISTINCT FROM '2'::jsonb
    THEN
      RAISE EXCEPTION 'invalid general-service intake payload version or shape'
        USING ERRCODE = '23514';
    END IF;

    -- v1 (unchanged from 20261003000000) --------------------------------------
    IF pack_version = '1'::jsonb THEN
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

    -- v2 — the diet (lib/consult/intake/packs/generalService.ts) --------------
    -- Dropped: service_experience, last_service_timing, maintenance_tolerance,
    -- event_timing and budget (moved to the follow-up). Every safety question
    -- stays: no photograph reports an allergy.
    IF answers - ARRAY[
        'change_scale', 'goal_direction', 'recent_treatment_timing',
        'skin_sensitivity', 'known_allergies', 'prior_reaction'
      ] <> '{}'::jsonb
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
    THEN
      RAISE EXCEPTION 'invalid general-service intake answers'
        USING ERRCODE = '23514';
    END IF;

    goal_direction_required := answers ->> 'change_scale' = 'subtle';

    IF (NEW."payload" ->> 'complete')::boolean
      AND (
        NOT answers ?& ARRAY[
          'change_scale', 'recent_treatment_timing', 'skin_sensitivity',
          'known_allergies', 'prior_reaction'
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
