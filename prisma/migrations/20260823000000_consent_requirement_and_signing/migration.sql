-- K15: the per-service consent REQUIREMENT, and the client's own signature.
--
-- K14 made a consent form's words immutable once published. K15 does the two
-- things that make that worth having: a pro can say "this service requires this
-- waiver", and a client can actually sign it — through a link, against a version
-- pinned when the link was sent.
--
-- 🔴 The whole step WARNS; it never BLOCKS. Nothing on the booking path reads
-- "ProfessionalServiceOffering"."consentFormId" — it feeds pro-facing marks on
-- the calendar card and at session start. A requirement that refused bookings
-- would strand real appointments the day a pro sets their first one.
--
-- Additive throughout: every column is nullable with no backfill, and no
-- existing row changes meaning.

-- 1. The requirement: a service points at the FORM, never at a version.
--
-- The version is resolved when the signature link is MINTED, which is what makes
-- K14's append-only model do its job — editing the waiver changes what future
-- clients sign and nothing about what past clients signed.
ALTER TABLE "ProfessionalServiceOffering"
  ADD COLUMN "consentFormId" TEXT;

CREATE INDEX "ProfessionalServiceOffering_consentFormId_idx"
  ON "ProfessionalServiceOffering" ("consentFormId");

-- RESTRICT, not SET NULL: a requirement that vanishes when a form is deleted
-- stops clients being asked to sign, with nothing on any surface to say so.
-- Unbinding is the pro's explicit act, not a side effect.
ALTER TABLE "ProfessionalServiceOffering"
  ADD CONSTRAINT "ProfessionalServiceOffering_consentFormId_fkey"
  FOREIGN KEY ("consentFormId") REFERENCES "ConsentForm" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. The signature link's pin on the exact words it shows.
--
-- Set at mint. The signing route copies it onto the record, so publishing a new
-- version between the send and the signature cannot change which text the record
-- attests to. An implementation that resolved max(version) at signing time
-- instead would silently re-point it — that is the failure this column exists to
-- make impossible.
ALTER TABLE "ClientActionToken"
  ADD COLUMN "consentFormVersionId" TEXT;

CREATE INDEX "ClientActionToken_consentFormVersionId_kind_createdAt_idx"
  ON "ClientActionToken" ("consentFormVersionId", "kind", "createdAt");

-- CASCADE: a token pinned to a version that no longer exists shows nothing and
-- can sign nothing. A version somebody already SIGNED cannot be deleted at all
-- (ClientConsentRecord's RESTRICT foreign key, K14), so this only ever reaches
-- unsigned draft debris.
ALTER TABLE "ClientActionToken"
  ADD CONSTRAINT "ClientActionToken_consentFormVersionId_fkey"
  FOREIGN KEY ("consentFormVersionId") REFERENCES "ConsentFormVersion" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. The record's pointer back at the link the client used.
--
-- 🔴 UNIQUE — one signature per link, enforced by the database. A client who
-- double-taps, or a retried request, cannot produce two records attesting to the
-- same single act. The application also checks; only this makes it impossible.
--
-- Its presence is what makes ConsentProofMethod.CLIENT_TOKEN truthful: from K15
-- on, only the signing route writes that pair, so "signed via a link" can no
-- longer be claimed by hand with no link behind it (K14-B).
ALTER TABLE "ClientConsentRecord"
  ADD COLUMN "signatureTokenId" TEXT;

CREATE UNIQUE INDEX "ClientConsentRecord_signatureTokenId_key"
  ON "ClientConsentRecord" ("signatureTokenId");

-- SET NULL, never CASCADE: deleting the link must not delete the signature. The
-- record is the artifact; the token was only the doorway to it.
ALTER TABLE "ClientConsentRecord"
  ADD CONSTRAINT "ClientConsentRecord_signatureTokenId_fkey"
  FOREIGN KEY ("signatureTokenId") REFERENCES "ClientActionToken" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Enum values for the new link kind and its delivery. Neither label is
-- REFERENCED anywhere in this file, so adding them in the same transaction is
-- safe (Postgres only forbids using a value before its ADD VALUE commits) —
-- the same rule 20260703230000_add_no_show_fee_settings records.
ALTER TYPE "ClientActionTokenKind" ADD VALUE 'CONSENT_SIGNATURE';
ALTER TYPE "NotificationEventKey" ADD VALUE 'CONSENT_SIGNATURE_REQUEST';
