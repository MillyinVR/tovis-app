import { BookingStatus, Prisma } from '@prisma/client'

import { isAiConsultEnabledForPro } from '@/lib/consult/access'
import { isConsultCategoryInScope } from '@/lib/consult/serviceScope'
import { addElapsedDays } from '@/lib/time'

export const AI_CONSULT_BOOKING_WINDOW_DAYS = 90

export const AI_CONSULT_ELIGIBILITY_BOOKING_SELECT = {
  status: true,
  scheduledFor: true,
  professionalId: true,
  service: {
    select: {
      categoryId: true,
      category: { select: { slug: true } },
    },
  },
} satisfies Prisma.BookingSelect

export type AiConsultEligibilityBooking = Prisma.BookingGetPayload<{
  select: typeof AI_CONSULT_ELIGIBILITY_BOOKING_SELECT
}>

export type AiConsultBookingIneligibleReason =
  | 'FEATURE_DISABLED'
  | 'VERTICAL_NOT_ENABLED'
  | 'BOOKING_NOT_UPCOMING'
  | 'BOOKING_OUTSIDE_PILOT_WINDOW'

export type AiConsultBookingEligibility =
  | { eligible: true }
  | {
      eligible: false
      reason: AiConsultBookingIneligibleReason
      /** Hidden reasons return a no-leak 404 while the pilot is dark. */
      hidden: boolean
    }

const UPCOMING_BOOKING_STATUSES = new Set<BookingStatus>([
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
])

/**
 * One authoritative eligibility rule for the booking-attached founder pilot.
 *
 * This is deliberately pure apart from the feature-gate read, and accepts
 * `now` so routes, notifications, and tests cannot drift on time semantics.
 * Consent and the 18+ attestation deliberately follow shell creation. The
 * lifecycle/write boundary requires both before any future sensitive intake
 * or media writer can proceed; creating the empty shell proves neither.
 */
export function evaluateAiConsultBookingEligibility(
  booking: AiConsultEligibilityBooking,
  now = new Date(),
): AiConsultBookingEligibility {
  if (!isAiConsultEnabledForPro(booking.professionalId)) {
    return { eligible: false, reason: 'FEATURE_DISABLED', hidden: true }
  }

  if (!isConsultCategoryInScope(booking.service.category)) {
    return { eligible: false, reason: 'VERTICAL_NOT_ENABLED', hidden: true }
  }

  if (
    !UPCOMING_BOOKING_STATUSES.has(booking.status) ||
    booking.scheduledFor.getTime() <= now.getTime()
  ) {
    return { eligible: false, reason: 'BOOKING_NOT_UPCOMING', hidden: false }
  }

  const latestEligibleAt = addElapsedDays(
    now,
    AI_CONSULT_BOOKING_WINDOW_DAYS,
  )
  if (booking.scheduledFor.getTime() > latestEligibleAt.getTime()) {
    return {
      eligible: false,
      reason: 'BOOKING_OUTSIDE_PILOT_WINDOW',
      hidden: false,
    }
  }

  return { eligible: true }
}
