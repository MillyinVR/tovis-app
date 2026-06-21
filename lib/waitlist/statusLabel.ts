// lib/waitlist/statusLabel.ts
//
// Sentence-case label for a waitlist entry's status. Shared by the inbox and
// thread context surfaces so the casing stays consistent — this was duplicated
// inline with divergent casing (ALL CAPS in the inbox, sentence case in the
// thread) for the same status values.
import { WaitlistStatus } from '@prisma/client'

export function labelForWaitlistStatus(status: WaitlistStatus): string {
  if (status === WaitlistStatus.ACTIVE) return 'Position active'
  if (status === WaitlistStatus.NOTIFIED) return 'Notified'
  if (status === WaitlistStatus.BOOKED) return 'Booked'
  if (status === WaitlistStatus.CANCELLED) return 'Cancelled'

  return 'Waitlist'
}
