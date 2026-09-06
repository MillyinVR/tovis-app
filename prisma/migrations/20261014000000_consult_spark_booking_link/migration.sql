-- P7a-2 — the consult ↔ booking link becomes explicit.
--
-- `Booking.sourceConsultSessionId` has existed since the C6 brief migration
-- (20260910000001) but only ever carried the PROPOSAL path's attribution, and
-- carried it with a plain index. The spark now writes it too, and the whole
-- point of the slice is that the link is a fact rather than an inference — so
-- it has to be unique, or two bookings can claim one consult and the thread is
-- back to guessing which.
--
-- 🔴 PARTIAL, over LIVE statuses only. A consult's link is RELEASED when its
-- booking is cancelled or completed (Tori, 2026-09-06), so she can book that
-- look again from the same consult afterwards — she cannot open a second
-- consult for it, because ConsultSession is unique per
-- (clientId, professionalId, anchorLookPostId). A total unique index would
-- strand her the moment an appointment simply happened.
--
-- The status set is deliberately the same one lib/consult/thread.ts shows the
-- booking confirmation for (LIVE_BOOKING_STATUSES) and the same one
-- lib/consult/sparkLink.ts checks before stamping: "the thread says you are
-- booked", "the link is held" and "the database agrees" are one rule in three
-- places, and they must not be able to drift apart.
--
-- Prisma cannot express a partial unique index in schema.prisma, so this is
-- hand-written and `prisma migrate diff` will report drift for it. The schema
-- carries a matching comment so the next reader knows the index is deliberate.
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_sourceConsultSessionId_live_key"
  ON "Booking" ("sourceConsultSessionId")
  WHERE "sourceConsultSessionId" IS NOT NULL
    AND "status" IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS');
