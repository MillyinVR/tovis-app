-- The picture an approved viral look is shown by.
--
-- Additive and nullable: every existing row keeps rendering exactly as it does
-- today (readers fall back to the submitter's first attached media, and then to
-- a gradient), so this is safe to run ahead of the code that reads it.
ALTER TABLE "ViralServiceRequest" ADD COLUMN "coverImageUrl" TEXT;
