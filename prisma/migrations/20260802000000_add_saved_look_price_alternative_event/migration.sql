-- AlterEnum
-- §6.8 price blocker response re-engagement trigger (personalization spec §6.8/§8.1):
-- a client saved a look priced well above their learned price band (spec §4.5) but
-- never booked → gently surface a similar, in-band look from a different pro.
-- Additive enum value — safe, no data change.
ALTER TYPE "NotificationEventKey" ADD VALUE 'SAVED_LOOK_PRICE_ALTERNATIVE';
