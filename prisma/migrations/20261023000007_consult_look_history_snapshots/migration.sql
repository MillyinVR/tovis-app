ALTER TABLE public."ConsultLookBriefVersion" ADD COLUMN "additionalClientAnswers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE public."ConsultLookBriefVersion" ADD CONSTRAINT "ConsultLookBriefVersion_client_answers_shape"
  CHECK (jsonb_typeof("additionalClientAnswers") = 'array' AND jsonb_array_length("additionalClientAnswers") <= 24);
