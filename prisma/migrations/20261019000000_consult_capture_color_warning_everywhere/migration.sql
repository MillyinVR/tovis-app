-- Consult capture: warm light and colour cast become WARNINGS on every shot.
--
-- Tori, 2026-09-07. Until now a colour finding warned on a TIGHT_CROP view and
-- REJECTED a FULL_VIEW, because colour fidelity is the point of those frames.
-- Defensible, and in practice a wall: prod consult `cmtoma65j0002l9040bpit3v6`
-- failed `face_front` four times across two days on WARM_INDOOR_LIGHT, in the
-- same room and the same minute where `eyes_closeup` passed carrying that
-- finding as a warning. Hard rejection is now reserved for a frame that cannot
-- be READ — no subject, wrong view, blur, or exposure past legibility.
--
-- The warning is not lost: it is still stored on the accepted row, still
-- reaches the analysis (which widens its confidence), still reaches the pro
-- brief, and the plan now says so out loud when most frames carried it.
--
-- TWO changes, both additive/loosening. Nothing about the columns or the
-- warning vocabulary moves: a guided shot could already carry exactly these two
-- codes as warnings, so only the PROMPT VERSION is new.
--
--   1. ConsultCapture_quality_contract — learns 'full-analysis-capture-v4'.
--   2. consult_revision_requires_agreements — the analysis prerequisite pins
--      the prompt version, so the bump alone would make every capture accepted
--      after the deploy invisible to it and the analysis would raise. The pin
--      is a SET and gains the new member.
--
-- 🔴 Deployed code keeps working through the gap between apply and deploy: v4
-- rows cannot exist until the new build runs, and every older version stays in
-- both lists. Backwards too — a rollback leaves v4 rows readable by the
-- constraint but NOT analyzable by the old build's pin, which is why the pin is
-- only ever appended to.

-- 1) Quality contract ---------------------------------------------------------
-- Re-issued in full from the LIVE definition (pg_get_constraintdef on prod,
-- 2026-09-07), not from the last migration file that touched it: the early
-- photo widened the warning list here afterwards, and rebuilding from the file
-- would have silently reverted that.

ALTER TABLE "ConsultCapture"
  DROP CONSTRAINT "ConsultCapture_quality_contract";
ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_quality_contract" CHECK (
    ("status" = 'ATTACHED' AND "qualityWarningCode" IS NULL)
    OR (
      "qualityPromptVersion" IN (
        'hair-color-capture-v1',
        'full-analysis-capture-v2',
        'full-analysis-capture-v3',
        'full-analysis-capture-v4',
        'early-photo-capture-v1'
      )
      AND "qualitySchemaVersion" = 1
      AND (
        (
          "status" = 'ACCEPTED'
          AND "qualityReasonCode" = 'PASS'
          AND "retakeTip" IS NULL
          AND (
            "qualityWarningCode" IS NULL
            OR (
              "shotKey" <> 'early_photo'
              AND "qualityWarningCode" IN ('WARM_INDOOR_LIGHT', 'COLOR_CAST')
            )
            OR (
              "shotKey" = 'early_photo'
              AND "qualityWarningCode" IN (
                'WARM_INDOOR_LIGHT',
                'COLOR_CAST',
                'VIEW_MISMATCH',
                'HAIR_NOT_VISIBLE',
                'BLURRY',
                'TOO_DARK',
                'TOO_BRIGHT',
                'OTHER_QUALITY_FAILURE'
              )
            )
          )
        )
        OR (
          "status" = 'REJECTED'
          AND "qualityWarningCode" IS NULL
          AND "qualityReasonCode" IN (
            'WARM_INDOOR_LIGHT',
            'COLOR_CAST',
            'VIEW_MISMATCH',
            'HAIR_NOT_VISIBLE',
            'SUBJECT_NOT_VISIBLE',
            'BLURRY',
            'TOO_DARK',
            'TOO_BRIGHT',
            'OTHER_QUALITY_FAILURE'
          )
        )
      )
    )
  );

-- 🔴 WARM_INDOOR_LIGHT and COLOR_CAST stay in the REJECTED list above on
-- purpose. Four rejected rows carrying them already exist in production and the
-- constraint is validated against the whole table on ADD; dropping them would
-- fail this migration on the very data that motivated it. New code cannot write
-- one — `sanitizeConsultCaptureQuality` downgrades a colour finding before the
-- write boundary ever sees it — so this is history, not a live path.

-- 2) The analysis prerequisite ------------------------------------------------
-- Same pg_get_functiondef rewrite the earlier slices used, with the same
-- assertion so a drifted definition fails loudly instead of silently not
-- applying. The FROM string is the live pin read off prod on 2026-09-07.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;

  IF position('full-analysis-capture-v4' in definition) > 0 THEN
    RAISE NOTICE 'analysis prerequisite already pins v4; leaving as is';
    RETURN;
  END IF;

  updated := replace(
    definition,
    'capture."qualityPromptVersion" IN (''full-analysis-capture-v2'', ''full-analysis-capture-v3'', ''early-photo-capture-v1'')',
    'capture."qualityPromptVersion" IN (''full-analysis-capture-v2'', ''full-analysis-capture-v3'', ''full-analysis-capture-v4'', ''early-photo-capture-v1'')'
  );
  IF position('full-analysis-capture-v4' in updated) = 0 THEN
    RAISE EXCEPTION 'expected analysis prerequisite prompt-version pin not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';
