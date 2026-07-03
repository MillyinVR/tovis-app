-- Post-visit "leave a review" nudge to the client, scheduled a few hours
-- after the booking completes (lib/notifications/reviewRequests.ts).
--
-- Additive enum value; safe on a live database.
ALTER TYPE "NotificationEventKey" ADD VALUE 'REVIEW_REQUESTED';
