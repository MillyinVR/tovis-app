// lib/booking/checkoutProductsEditable.ts
//
// Single source of truth for the *lifecycle* gate on client checkout-product
// edits — the −/+ product picker the client uses to add pro-recommended
// products to their booking checkout. Ownership is verified separately by the
// caller (a booking the client does not own is a uniform 404, never a
// distinguishable "locked" state); this predicate covers only the
// booking/checkout state that blocks editing once ownership is established.
//
// Two consumers share it, so the read surface and the write gate can never
// drift:
//   • `assertClientCanEditBookingCheckoutProducts` (lib/booking/writeBoundary.ts)
//     maps each reason to a thrown bookingError.
//   • the client aftercare read DTO (lib/dto/clientAftercare.ts) surfaces the
//     boolean as `checkoutProductsEditable`, so the native + web pickers lock in
//     exactly the states the write path would reject.

import { BookingCheckoutStatus, BookingStatus } from '@prisma/client'

/** Why the client cannot currently edit their booking checkout products. */
export type CheckoutProductsEditBlockReason =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'AFTERCARE_NOT_SENT'
  | 'PAYMENT_AUTHORIZED'
  | 'PAYMENT_COLLECTED'
  | 'CHECKOUT_LOCKED'

/** The booking/checkout state the editability gate reads. */
export type CheckoutProductsEditState = {
  status: BookingStatus | null
  finishedAt: Date | null
  checkoutStatus: BookingCheckoutStatus | null
  paymentAuthorizedAt: Date | null
  paymentCollectedAt: Date | null
  /** The instant the aftercare summary was SENT to the client, or null. */
  aftercareSentAt: Date | null
}

/**
 * The first reason the client cannot edit checkout products, or null when they
 * can. Ordered so the message matches the write path's throw order: a cancelled
 * or completed booking is reported before the softer aftercare/payment gates.
 */
export function clientCheckoutProductsEditBlockReason(
  state: CheckoutProductsEditState,
): CheckoutProductsEditBlockReason | null {
  if (state.status === BookingStatus.CANCELLED) return 'CANCELLED'
  if (state.status === BookingStatus.COMPLETED || state.finishedAt) {
    return 'COMPLETED'
  }
  // Products can only be selected once the pro has finalized (sent) aftercare —
  // a missing summary or an unsent draft both block editing.
  if (!state.aftercareSentAt) return 'AFTERCARE_NOT_SENT'
  if (state.paymentAuthorizedAt) return 'PAYMENT_AUTHORIZED'
  if (state.paymentCollectedAt) return 'PAYMENT_COLLECTED'
  if (
    state.checkoutStatus === BookingCheckoutStatus.PARTIALLY_PAID ||
    state.checkoutStatus === BookingCheckoutStatus.PAID ||
    state.checkoutStatus === BookingCheckoutStatus.WAIVED
  ) {
    return 'CHECKOUT_LOCKED'
  }
  return null
}

/** Whether the client may edit their booking checkout products right now. */
export function clientCanEditBookingCheckoutProducts(
  state: CheckoutProductsEditState,
): boolean {
  return clientCheckoutProductsEditBlockReason(state) === null
}
