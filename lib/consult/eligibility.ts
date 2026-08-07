import { BookingStatus, Prisma } from '@prisma/client'

import { isAiConsultEnabledForPro } from '@/lib/consult/access'
import { addElapsedDays } from '@/lib/time'

export const AI_CONSULT_PILOT_CATEGORY_SLUGS = Object.freeze(['hair-color'])
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

const PILOT_CATEGORY_SLUGS = new Set<string>(
  AI_CONSULT_PILOT_CATEGORY_SLUGS,
)

/**
 * One authoritative eligibility rule for the booking-attached founder pilot.
 *
 * This is deliberately pure apart from the feature-gate read, and accepts
 * `now` so routes, notifications, and tests cannot drift on time semantics.
 * Consent and the 18+ attestation are not representable in C1. The future
 * intake/media writers must require both before collecting sensitive content;
 * creating this empty draft must not pretend either has occurred.
 */
export function evaluateAiConsultBookingEligibility(
  booking: AiConsultEligibilityBooking,
  now = new Date(),
): AiConsultBookingEligibility {
  if (!isAiConsultEnabledForPro(booking.professionalId)) {
    return { eligible: false, reason: 'FEATURE_DISABLED', hidden: true }
  }

  if (
    !booking.service.category.slug ||
    !PILOT_CATEGORY_SLUGS.has(booking.service.category.slug)
  ) {
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
