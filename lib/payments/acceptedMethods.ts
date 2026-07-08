// Server-side accepted payment methods for a pro, as a Set<PaymentMethod> for
// validating a chosen method (client self-checkout or a pro recording payment).
//
// This is the gated, write-path counterpart to listPublicAcceptedMethods in
// publicAcceptedMethods.ts — that one builds a handle-free list for public
// display; this one answers "is this method enabled?" for checkout writes.
import { PaymentMethod, type Prisma } from '@prisma/client'

// Prisma select for the accept* flags this module reads. Use when loading a
// pro's payment settings purely to validate a chosen method.
export const acceptedPaymentMethodsSelect = {
  acceptCash: true,
  acceptCardOnFile: true,
  acceptTapToPay: true,
  acceptVenmo: true,
  acceptZelle: true,
  acceptAppleCash: true,
  acceptStripeCard: true,
} satisfies Prisma.ProfessionalPaymentSettingsSelect

// Only the accept* booleans are read; callers may pass a wider settings row
// (e.g. one that also selects tipsEnabled) — extra fields are ignored.
export type AcceptedPaymentMethodFlags = {
  acceptCash: boolean
  acceptCardOnFile: boolean
  acceptTapToPay: boolean
  acceptVenmo: boolean
  acceptZelle: boolean
  acceptAppleCash: boolean
  acceptStripeCard: boolean
}

// Normalize a free-form request value (e.g. "cash", "tap to pay", "APPLE_CASH")
// into a checkout-supported PaymentMethod, or undefined when unrecognized.
// Mirrors the set of methods checkout actually supports — APPLE_PAY / PAYPAL are
// intentionally excluded (not collectible through this path).
export function normalizePaymentMethodInput(
  value: unknown,
): PaymentMethod | undefined {
  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (!normalized) return undefined

  switch (normalized) {
    case PaymentMethod.CASH:
      return PaymentMethod.CASH
    case PaymentMethod.CARD_ON_FILE:
      return PaymentMethod.CARD_ON_FILE
    case PaymentMethod.TAP_TO_PAY:
      return PaymentMethod.TAP_TO_PAY
    case PaymentMethod.VENMO:
      return PaymentMethod.VENMO
    case PaymentMethod.ZELLE:
      return PaymentMethod.ZELLE
    case PaymentMethod.APPLE_CASH:
      return PaymentMethod.APPLE_CASH
    case PaymentMethod.STRIPE_CARD:
      return PaymentMethod.STRIPE_CARD
    default:
      return undefined
  }
}

// Off-platform payment methods whose receipt the platform cannot verify — client
// attests they paid, but only the pro can confirm the money actually arrived.
// Card rails (STRIPE_CARD / CARD_ON_FILE / TAP_TO_PAY) are verifiable (Stripe /
// terminal rails) and stay on the immediate-PAID path. Kept as a set so callers
// read intent, not a hard-coded list.
const UNVERIFIABLE_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set([
  PaymentMethod.CASH,
  PaymentMethod.VENMO,
  PaymentMethod.ZELLE,
  PaymentMethod.APPLE_CASH,
  PaymentMethod.PAYPAL,
])

// True when a confirmed payment on this method must wait for the pro to confirm
// receipt (drives the AWAITING_CONFIRMATION checkout state) rather than closing
// out immediately. Null/undefined → false (no method chosen yet).
export function isUnverifiablePaymentMethod(
  method: PaymentMethod | null | undefined,
): boolean {
  return method != null && UNVERIFIABLE_PAYMENT_METHODS.has(method)
}

export function buildAcceptedPaymentMethods(
  settings: AcceptedPaymentMethodFlags | null,
): Set<PaymentMethod> {
  const out = new Set<PaymentMethod>()

  if (!settings) return out

  if (settings.acceptCash) out.add(PaymentMethod.CASH)
  if (settings.acceptCardOnFile) out.add(PaymentMethod.CARD_ON_FILE)
  if (settings.acceptTapToPay) out.add(PaymentMethod.TAP_TO_PAY)
  if (settings.acceptVenmo) out.add(PaymentMethod.VENMO)
  if (settings.acceptZelle) out.add(PaymentMethod.ZELLE)
  if (settings.acceptAppleCash) out.add(PaymentMethod.APPLE_CASH)
  if (settings.acceptStripeCard) out.add(PaymentMethod.STRIPE_CARD)

  return out
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Cash',
  [PaymentMethod.CARD_ON_FILE]: 'Card on file',
  [PaymentMethod.TAP_TO_PAY]: 'Tap to pay',
  [PaymentMethod.VENMO]: 'Venmo',
  [PaymentMethod.ZELLE]: 'Zelle',
  [PaymentMethod.APPLE_CASH]: 'Apple Cash',
  [PaymentMethod.APPLE_PAY]: 'Apple Pay',
  [PaymentMethod.PAYPAL]: 'PayPal',
  [PaymentMethod.STRIPE_CARD]: 'Credit/debit card',
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method] ?? method
}

export type ManualCollectablePaymentMethod = {
  value: PaymentMethod
  label: string
}

// The payment methods a pro can record as collected by hand, in display order.
// Excludes STRIPE_CARD: a Stripe card is only "paid" once Stripe confirms the
// charge, so it can never be marked paid manually.
export function listManualCollectablePaymentMethods(
  settings: AcceptedPaymentMethodFlags | null,
): ManualCollectablePaymentMethod[] {
  const accepted = buildAcceptedPaymentMethods(settings)

  const ORDER: PaymentMethod[] = [
    PaymentMethod.CASH,
    PaymentMethod.TAP_TO_PAY,
    PaymentMethod.CARD_ON_FILE,
    PaymentMethod.VENMO,
    PaymentMethod.ZELLE,
    PaymentMethod.APPLE_CASH,
  ]

  return ORDER.filter((method) => accepted.has(method)).map((method) => ({
    value: method,
    label: paymentMethodLabel(method),
  }))
}
