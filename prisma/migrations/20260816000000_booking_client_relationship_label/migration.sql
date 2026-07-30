-- K5: NR/NNR/RR/RNR client-relationship mark, snapshotted per booking.
-- History backfills to UNKNOWN (the column default) rather than guessing:
-- BookingSource defaults to DISCOVERY, so deriving labels for old rows would
-- read a pro's imported book of loyal regulars as a wall of "non-request".
CREATE TYPE "ClientRelationshipLabel" AS ENUM ('UNKNOWN', 'NR', 'NNR', 'RR', 'RNR');

ALTER TABLE "Booking"
  ADD COLUMN "clientRelationshipLabel" "ClientRelationshipLabel" NOT NULL DEFAULT 'UNKNOWN';
