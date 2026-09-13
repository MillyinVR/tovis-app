-- "Replace this photo" is a control both clients have shown on an accepted
-- photo since P2d, and P7a-3 widened the lifecycle gate so the client could use
-- it right up to her appointment. It never worked: this index is the database
-- half of the refusal (the application half was in attachConsultCaptureUpload),
-- and it made the SECOND photo for a live slot impossible to store at all.
--
-- The invariant the slot actually needs is not "one live row". It is:
--
--   * at most one ACCEPTED photo per slot that anything reads — more than one
--     is a pack `currentCaptures` refuses outright as incomplete; and
--   * at most one unjudged photo per slot in flight, so an abandoned or
--     never-judged upload cannot pile up (or wedge the slot for 24h, which the
--     old index also did whenever a quality call failed to return).
--
-- A replacement is therefore stored alongside the photo it replaces, and the
-- older one is retired the moment the new one PASSES — never before, so a
-- refused retake cannot cost the client the good photo she already had.
--
-- Both predicates now also exclude purge-MARKED rows: retirement marks the row
-- inside the accepting transaction and destroys its object after the commit, so
-- the slot has to be free from the mark, not from the object purge.
DROP INDEX "ConsultCapture_one_active_slot";

CREATE UNIQUE INDEX "ConsultCapture_one_accepted_slot"
  ON "ConsultCapture" ("consultSessionId", "shotKey")
  WHERE "status" = 'ACCEPTED'
    AND "purgedAt" IS NULL
    AND "purgeRequestedAt" IS NULL;

CREATE UNIQUE INDEX "ConsultCapture_one_pending_slot"
  ON "ConsultCapture" ("consultSessionId", "shotKey")
  WHERE "status" = 'ATTACHED'
    AND "purgedAt" IS NULL
    AND "purgeRequestedAt" IS NULL;
