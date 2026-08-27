-- Decision 2026-08-26 (full-analysis launch): consult photos may be kept on the
-- client's chart as PRO_CLIENT MediaAssets, with a default-on but visibly
-- optional client choice recorded per consult.
ALTER TABLE "ConsultSession"
  ADD COLUMN "chartCopyOptIn" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "chartCopyDecidedAt" TIMESTAMP(3),
  ADD COLUMN "chartCopyCompletedAt" TIMESTAMP(3);
