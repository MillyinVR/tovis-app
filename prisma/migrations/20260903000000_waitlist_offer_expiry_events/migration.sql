-- Two pro-facing waitlist notification events.
--
-- WAITLIST_OFFER_EXPIRED — nothing in the codebase ever wrote
-- `WaitlistOfferStatus.EXPIRED`. An offer's `expiresAt` was enforced only
-- defensively, at confirm time, so once it lapsed the offer stayed PENDING and
-- its WaitlistEntry stayed NOTIFIED forever; only a DECLINE ever returned an
-- entry to ACTIVE. The hourly sweep that fixes that needs a way to tell the pro
-- why the client reappeared on their list — quietly, in-app only, because the
-- event is that nobody did anything.
--
-- WAITLIST_CLIENT_LEFT — `cancelClientWaitlistEntry` withdrew a pending offer
-- silently, so the pro's promised slot went back on the market with no signal.
-- In-app + push, and emitted ONLY when a live offer was actually withdrawn.
--
-- Additive enum values. Postgres allows ALTER TYPE … ADD VALUE inside a
-- transaction block (PG 12+) as long as the new value is not USED in the same
-- transaction — nothing here uses either one. Precedent:
-- 20260703160000_add_look_comment_notification_event_keys adds two the same way.
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'WAITLIST_OFFER_EXPIRED';
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'WAITLIST_CLIENT_LEFT';
