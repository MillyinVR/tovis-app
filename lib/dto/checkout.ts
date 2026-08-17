// lib/dto/checkout.ts
//
// Wire DTOs for the booking → pay leg. A native client routes card payments
// through a hosted Stripe Checkout redirect: it reads `stripeCheckout.url`,
// opens it in an in-app browser, and intercepts the return via the deep-link
// claimed domain. Non-card methods (cash/Venmo/Zelle/…) confirm in-app and get
// the checkout-confirm response instead.
//
// All money fields are serialized as strings on the wire (Prisma.Decimal →
// `.toString()`); timestamps are ISO-8601 strings (Date → `.toISOString()`).
// Enum fields serialize as their string members. Each response is `satisfies`-
// checked at its route return so the schema can't silently drift.

import type {
  BookingCheckoutStatus,
  PaymentMethod,
  PaymentProvider,
  StripeCheckoutSessionStatus,
  StripePaymentStatus,
} from '@prisma/client'

import type { MutationMetaDTO } from '@/lib/dto/holds'

// The created hosted Checkout session. `url` is null when Stripe omits it.
export type StripeCheckoutSessionDTO = {
  sessionId: string
  url: string | null
}

// POST /api/v1/client/bookings/[id]/deposit/stripe-session — the up-front
// discovery deposit + one-time platform fee (the only charge carrying the fee).
export type DepositStripeSessionResponseDTO = {
  booking: { id: string }
  deposit: {
    depositCents: number
    feeCents: number
    totalCents: number
    currency: string
  }
  stripeCheckout: StripeCheckoutSessionDTO
}

/**
 * The final bill's session, which — unlike the deposit's — may legitimately not
 * exist: when a paid deposit covers the whole total there is nothing to charge
 * and no session is created. Kept separate from `StripeCheckoutSessionDTO` so
 * the deposit route's non-null contract is not weakened for every consumer.
 */
export type CheckoutStripeSessionOrSettledDTO = {
  sessionId: string | null
  url: string | null
}

// POST /api/v1/client/bookings/[id]/checkout/stripe-session — post-service card
// checkout. The booking echo mirrors the freshly-attached Stripe columns.
export type CheckoutStripeSessionResponseDTO = {
  booking: {
    id: string
    checkoutStatus: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    paymentProvider: PaymentProvider
    stripeCheckoutSessionId: string | null
    stripePaymentIntentId: string | null
    stripeCheckoutSessionStatus: StripeCheckoutSessionStatus | null
    stripePaymentStatus: StripePaymentStatus | null
    stripeAmountTotal: number | null
    stripeCurrency: string | null
    tipAmount: string | null
    totalAmount: string | null
  }
  stripeCheckout: CheckoutStripeSessionOrSettledDTO
  /**
   * The deposit covered the entire bill: checkout is already PAID, no session
   * was created, and the client owes nothing. `stripeCheckout.url` is null on
   * this branch — a client that only reads the url still behaves correctly
   * (it has nowhere to send them) rather than charging a stale amount.
   */
  settledByDeposit: boolean
  /**
   * The client's platform CREDIT closed the remaining balance, so there is
   * nothing to charge. Distinct from `settledByDeposit` on purpose: they are
   * different money from different funders, and a surface that says "your
   * deposit covered it" when the client spent their own credit is telling them
   * the wrong thing about where their money went. Both are false on the charge
   * branch, and at most one is ever true.
   */
  settledByCredit: boolean
  /**
   * Deposit money credited against this bill, in cents. On the charge branch
   * this is what was subtracted from the total to get the amount charged; 0
   * when no deposit applies.
   */
  depositCreditCents: number
  /**
   * Platform credit applied to this bill, in cents. Subtracted from the amount
   * charged alongside the deposit; 0 when the client did not apply any.
   */
  creatorCreditCents: number
}

// POST /api/v1/client/bookings/[id]/checkout — confirm a non-card payment
// method (cash/Venmo/Zelle/…). Card methods are rejected here with
// STRIPE_CHECKOUT_REQUIRED and must use the stripe-session route above.
export type ClientCheckoutConfirmResponseDTO = {
  booking: {
    id: string
    checkoutStatus: BookingCheckoutStatus
    selectedPaymentMethod: PaymentMethod | null
    serviceSubtotalSnapshot: string | null
    productSubtotalSnapshot: string | null
    subtotalSnapshot: string | null
    tipAmount: string | null
    taxAmount: string | null
    discountAmount: string | null
    totalAmount: string | null
    paymentAuthorizedAt: string | null // ISO-8601
    paymentCollectedAt: string | null // ISO-8601
  }
  meta: MutationMetaDTO
}
