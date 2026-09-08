ALTER TABLE "ConsultLookBriefVersion"
  ADD COLUMN "selectedLocationType" "ServiceLocationType",
  ADD COLUMN "pathEstimates" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "ConsultLookBriefVersion"
  ADD CONSTRAINT "ConsultLookBriefVersion_choice_mode" CHECK (
    ("selectedPathIndex" IS NULL) = ("selectedLocationType" IS NULL)
    AND jsonb_typeof("pathEstimates") = 'array'
    AND jsonb_array_length("pathEstimates") <= 6
  );
