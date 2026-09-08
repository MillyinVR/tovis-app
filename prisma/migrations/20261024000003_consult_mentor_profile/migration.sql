ALTER TABLE public."ProfessionalProfile"
  ADD COLUMN "consultMentorEnabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN "consultProductLines" text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public."ProfessionalProfile" ADD CONSTRAINT "consult_product_lines_bounded"
  CHECK (cardinality("consultProductLines") <= 12 AND length(array_to_string("consultProductLines", '')) <= 960);
