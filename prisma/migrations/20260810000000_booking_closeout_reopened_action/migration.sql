-- AlterEnum
-- M9 follow-up "undo a mistaken manual close-out": a pro can now reverse an
-- accidental mark-paid / waive on a still-in-progress booking. The reversal is
-- recorded as its own BookingCloseoutAuditLog action so the money-reversal
-- trail is queryable on its own (one-code-two-meanings discipline), rather than
-- overloading CHECKOUT_UPDATED. Additive enum value — safe, no data change.
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CHECKOUT_REOPENED';
