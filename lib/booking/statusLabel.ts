// lib/booking/statusLabel.ts
//
// Sentence-case label for a booking status, used by status pills/badges
// (pro bookings list, active-session header). Centralized so the casing stays
// consistent across surfaces instead of drifting (was duplicated inline).
import { BookingStatus } from '@prisma/client'

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
    default:
      return status
  }
}
