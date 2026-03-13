// lib/booking/statusRules.ts 
import { BookingStatus } from '@prisma/client'

/**
 * Status for bookings initiated by a client-facing flow
 * (standard booking, discovery booking, request flow, waitlist promotion, etc).
 */
export function getClientSubmittedBookingStatus(
  autoAcceptBookings: boolean,
): BookingStatus {
  return autoAcceptBookings
    ? BookingStatus.ACCEPTED
    : BookingStatus.PENDING
}

/**
 * Status for bookings created directly by the professional/team.
 * These are accepted immediately because the pro is creating them intentionally.
 */
export function getProCreatedBookingStatus(): BookingStatus {
  return BookingStatus.ACCEPTED
}