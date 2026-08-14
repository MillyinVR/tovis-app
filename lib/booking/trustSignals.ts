// lib/booking/trustSignals.ts
//
// The three reassurance chips the booking sheet shows under the service line
// ("Verified pro · 1.2k booked · Free cancel 24h"), and the cover the sheet
// opens with.
//
// Every value here is derived from something the product already knows. A chip
// with no real source does not ship: the count is COMPLETED bookings for this
// pro (not "requests", not a lifetime total that quietly includes cancellations),
// the rating is the same visible-reviews aggregate the public profile shows, and
// the free-cancellation window is the pro's own no-show settings rather than a
// hardcoded 24h. When a signal is unknown the field is null and the client omits
// that chip — never a zero dressed up as a fact.
//
// Read by `GET /api/v1/availability/bootstrap`, so web and iOS get identical
// values from one place.
import { BookingStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isBlockedVerificationStatus } from '@/lib/pro/readiness/proReadiness'
import { visibleReviewsWhere } from '@/lib/reviews/visibility'
import { getProNoShowSettings } from '@/lib/noShowProtection/settings'

type Db = Prisma.TransactionClient | typeof prisma

export type BookingTrustSignals = {
  /** The pro's licence/identity check has been approved. */
  verified: boolean
  /**
   * Appointments this pro has actually completed. `null` when the count is too
   * low to be worth showing — a "3 booked" chip reads as a warning, not a
   * reassurance, so below the floor the client omits the chip entirely.
   */
  completedBookings: number | null
  /** Visible-review aggregate, or null when the pro has none yet. */
  rating: { average: number; count: number } | null
  /**
   * Hours before the appointment up to which cancelling is free.
   * `null` means cancellation is always free (the pro charges no late-cancel
   * fee), which the client renders as "Free cancellation".
   */
  freeCancellationHours: number | null
}

/**
 * Below this a completed-booking count is not a trust signal. Chosen to be the
 * point where the number reads as a track record rather than as "nobody has
 * booked this yet" — deliberately conservative, and Tori's to move.
 */
export const MIN_BOOKED_COUNT_TO_SHOW = 10

/**
 * The visible-review aggregate for one pro, on its own — null when they have no
 * visible reviews, so a caller never renders "0.0★" or a star with nothing
 * behind it.
 *
 * Split out of the full trust-signal load because the surfaces that want ONLY a
 * rating (the client home's next-booking card) would otherwise pay for a
 * verification lookup, a completed-booking count and the no-show settings to get
 * one number — or, more likely, hand-copy the aggregate. It stays the same
 * `visibleReviewsWhere` either way, which is the part that must not drift.
 */
export async function loadProRating(
  professionalId: string,
  db: Db = prisma,
): Promise<BookingTrustSignals['rating']> {
  const reviewStats = await db.review.aggregate({
    where: { professionalId, ...visibleReviewsWhere },
    _avg: { rating: true },
    _count: { _all: true },
  })

  const average = reviewStats._avg.rating
  const count = reviewStats._count._all
  return average != null && count > 0 ? { average, count } : null
}

export async function loadBookingTrustSignals(
  professionalId: string,
  db: Db = prisma,
): Promise<BookingTrustSignals> {
  const [pro, completed, rating, noShow] = await Promise.all([
    db.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { verificationStatus: true },
    }),
    db.booking.count({
      where: { professionalId, status: BookingStatus.COMPLETED },
    }),
    loadProRating(professionalId, db),
    getProNoShowSettings(professionalId).catch(() => null),
  ])

  return {
    verified: pro ? !isBlockedVerificationStatus(pro.verificationStatus) : false,
    completedBookings: completed >= MIN_BOOKED_COUNT_TO_SHOW ? completed : null,
    rating,
    // A fee the pro never charges is not a cancellation window. Both switches
    // matter: `enabled` is the master opt-in, and a pro can run no-show fees
    // while still letting clients cancel free at any point.
    freeCancellationHours:
      noShow?.enabled && noShow.chargeLateCancel ? noShow.cancelWindowHours : null,
  }
}
