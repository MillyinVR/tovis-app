// lib/booking/closeoutState.ts
//
// Single source of truth for "is this booking's closeout complete?" checks.
// Used both by the write boundary (to decide when to auto-complete a booking)
// and by read surfaces like the pro bookings list (to flag bookings that have
// sent aftercare but still need payment/checkout finished).
import { BookingCheckoutStatus } from '@prisma/client'

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
