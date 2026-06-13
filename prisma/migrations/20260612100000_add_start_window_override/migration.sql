-- Allow pros to explicitly start a booking outside the 15-minute window.
-- The override is recorded in BookingOverrideAuditLog for traceability.

ALTER TYPE "BookingOverrideRule" ADD VALUE 'START_WINDOW';
ALTER TYPE "BookingOverrideAction" ADD VALUE 'START';
