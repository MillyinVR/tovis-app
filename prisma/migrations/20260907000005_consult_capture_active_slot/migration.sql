-- One slot can have only one live object awaiting or holding acceptance.
-- Rejected rows remain replaceable immediately while retaining their audit.
DROP INDEX "ConsultCapture_one_live_accepted_slot";
CREATE UNIQUE INDEX "ConsultCapture_one_active_slot"
  ON "ConsultCapture" ("consultSessionId", "shotKey")
  WHERE "status" IN ('ATTACHED', 'ACCEPTED') AND "purgedAt" IS NULL;
