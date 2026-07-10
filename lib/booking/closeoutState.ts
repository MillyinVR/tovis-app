// lib/booking/closeoutState.ts
//
// Single source of truth for "is this booking's closeout complete?" checks.
// Used both by the write boundary (to decide when to auto-complete a booking)
// and by read surfaces like the pro bookings list (to flag bookings that have
// sent aftercare but still need payment/checkout finished).
import { BookingCheckoutStatus, BookingStatus } from '@prisma/client'

export function isCheckoutCloseoutComplete(
  checkoutStatus: BookingCheckoutStatus | null | undefined,
): boolean {
  return (
    checkoutStatus === BookingCheckoutStatus.PAID ||
    checkoutStatus === BookingCheckoutStatus.WAIVED
  )
}

export function isCloseoutPaymentAndAftercareComplete(args: {
  aftercareSentAt: Date | null | undefined
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
}): boolean {
  return (
    Boolean(args.aftercareSentAt) &&
    Boolean(args.paymentCollectedAt) &&
    isCheckoutCloseoutComplete(args.checkoutStatus)
  )
}

/**
 * Whether a booking is far enough through closeout to accept (or edit) the
 * client's review: the booking is COMPLETED + finished, and payment + aftercare
 * are both finalized. Single source of truth shared by the write boundary
 * (`canBookingAcceptClientReview` / the server-side review-eligibility assert)
 * and the client aftercare read DTO's `reviewEligible` flag, so the read surface
 * can never claim a review is allowed in a state the write path would reject.
 */
export function isBookingReviewEligible(args: {
  bookingStatus: BookingStatus | null | undefined
  finishedAt: Date | null | undefined
  aftercareSentAt: Date | null | undefined
  checkoutStatus: BookingCheckoutStatus | null | undefined
  paymentCollectedAt: Date | null | undefined
}): boolean {
  return (
    args.bookingStatus === BookingStatus.COMPLETED &&
    Boolean(args.finishedAt) &&
    isCloseoutPaymentAndAftercareComplete({
      aftercareSentAt: args.aftercareSentAt,
      checkoutStatus: args.checkoutStatus,
      paymentCollectedAt: args.paymentCollectedAt,
    })
  )
}
