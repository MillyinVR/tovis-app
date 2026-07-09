// lib/booking/statusLabel.ts
//
// Sentence-case label for a booking status, used by status pills/badges
// (pro bookings list, active-session header). Centralized so the casing stays
// consistent across surfaces instead of drifting (was duplicated inline).
import { BookingStatus } from '@prisma/client'

import type { BadgeTone } from '@/app/_components/ui'

export function labelForBookingStatus(status: string): string {
  switch (status) {
    case BookingStatus.PENDING:
      return 'Pending'
    case BookingStatus.ACCEPTED:
      return 'Accepted'
    case BookingStatus.IN_PROGRESS:
      return 'In progress'
    case BookingStatus.COMPLETED:
      return 'Completed'
    case BookingStatus.CANCELLED:
      return 'Cancelled'
    case BookingStatus.NO_SHOW:
      return 'No-show'
    default:
      return status
  }
}

/**
 * Canonical Badge tone for a booking status pill. Centralized so status chips
 * stay consistent across the pro bookings list and the client Appointments list.
 */
export function badgeToneForBookingStatus(status: string): BadgeTone {
  switch (status) {
    case BookingStatus.ACCEPTED:
    case BookingStatus.IN_PROGRESS:
      return 'accent'
    case BookingStatus.COMPLETED:
      return 'success'
    case BookingStatus.CANCELLED:
    case BookingStatus.NO_SHOW:
      return 'danger'
    case BookingStatus.PENDING:
      return 'pending'
    default:
      return 'neutral'
  }
}
