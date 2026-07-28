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
  acceptPaypal: true,
  acceptApplePay: true,
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
  acceptPaypal: boolean
  acceptApplePay: boolean
  acceptStripeCard: boolean
}

// Parse a free-form request value (e.g. "cash", "tap to pay", "APPLE_CASH") into
// a PaymentMethod, or undefined when it names no method at all.
//
// This is PARSING ONLY — it deliberately covers every enum member. Whether a
// given actor may actually choose a method is an authorization question answered
// by buildAcceptedPaymentMethods (does the pro take it?) and
// buildClientSelfServePaymentMethods (may a CLIENT pick it themselves?). Keeping
// the two apart is what this module got wrong before: PAYPAL was unparseable, so
// a client could be offered PayPal, pay for real through the working paypal.me
// deep link, and then be unable to record it — the confirm was rejected here
// with "not one of…" rather than by any deliberate policy.
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
    case PaymentMethod.PAYPAL:
      return PaymentMethod.PAYPAL
    case PaymentMethod.APPLE_PAY:
      return PaymentMethod.APPLE_PAY
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

// The accept* flag that turns each method on, in the canonical checkout display
// order. Single source of truth for "which methods exist and what enables them"
// — buildAcceptedPaymentMethods, the client-selectable list and the pro's
// manual-collect list all read this rather than repeating their own switch.
const PAYMENT_METHOD_FLAGS: ReadonlyArray<{
  method: PaymentMethod
  flag: keyof AcceptedPaymentMethodFlags
}> = [
  { method: PaymentMethod.CASH, flag: 'acceptCash' },
  { method: PaymentMethod.CARD_ON_FILE, flag: 'acceptCardOnFile' },
  { method: PaymentMethod.TAP_TO_PAY, flag: 'acceptTapToPay' },
  { method: PaymentMethod.VENMO, flag: 'acceptVenmo' },
  { method: PaymentMethod.ZELLE, flag: 'acceptZelle' },
  { method: PaymentMethod.APPLE_CASH, flag: 'acceptAppleCash' },
  { method: PaymentMethod.PAYPAL, flag: 'acceptPaypal' },
  { method: PaymentMethod.APPLE_PAY, flag: 'acceptApplePay' },
  { method: PaymentMethod.STRIPE_CARD, flag: 'acceptStripeCard' },
]

export function buildAcceptedPaymentMethods(
  settings: AcceptedPaymentMethodFlags | null,
): Set<PaymentMethod> {
  const out = new Set<PaymentMethod>()

  if (!settings) return out

  for (const { method, flag } of PAYMENT_METHOD_FLAGS) {
    if (settings[flag]) out.add(method)
  }

  return out
}

// Rails the PRO runs on their own hardware/account: the client never executes
// these themselves, they just watch the pro take the card. A client "confirming"
// one used to stamp the booking PAID + paymentCollectedAt with nothing having
// been charged — a self-serve close-out on money that never moved. They stay
// available to the pro's manual mark-paid flow, where a human has actually run
// the card, and are excluded from the client's own checkout entirely.
const PRO_RUN_PAYMENT_METHODS: ReadonlySet<PaymentMethod> = new Set([
  PaymentMethod.CARD_ON_FILE,
  PaymentMethod.TAP_TO_PAY,
  PaymentMethod.APPLE_PAY,
])

/**
 * May a CLIENT pick this method in their own checkout? False for pro-run card
 * rails. Everything else is either off-platform (client pays in another app and
 * attests) or Stripe (client pays through hosted checkout).
 */
export function isClientSelfServePaymentMethod(
  method: PaymentMethod | null | undefined,
): boolean {
  return method != null && !PRO_RUN_PAYMENT_METHODS.has(method)
}

/**
 * The methods a client may choose in self-checkout: what the pro accepts, minus
 * the pro-run card rails. The client checkout route authorizes against THIS, and
 * buildClientAcceptedMethods renders from it, so the offered list and the
 * accepted write can never drift apart again.
 */
export function buildClientSelfServePaymentMethods(
  settings: AcceptedPaymentMethodFlags | null,
): Set<PaymentMethod> {
  const out = new Set<PaymentMethod>()

  for (const method of buildAcceptedPaymentMethods(settings)) {
    if (isClientSelfServePaymentMethod(method)) out.add(method)
  }

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

// The lowercase wire/UI key each method travels under on client surfaces (web
// checkout card, native checkout, public profile). Paired with the enum here so
// a new method can't pick up a different key on one surface than another.
export const PAYMENT_METHOD_KEYS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'cash',
  [PaymentMethod.CARD_ON_FILE]: 'card_on_file',
  [PaymentMethod.TAP_TO_PAY]: 'tap_to_pay',
  [PaymentMethod.VENMO]: 'venmo',
  [PaymentMethod.ZELLE]: 'zelle',
  [PaymentMethod.APPLE_CASH]: 'apple_cash',
  [PaymentMethod.APPLE_PAY]: 'apple_pay',
  [PaymentMethod.PAYPAL]: 'paypal',
  [PaymentMethod.STRIPE_CARD]: 'stripe_card',
}

export function paymentMethodKey(method: PaymentMethod): string {
  return PAYMENT_METHOD_KEYS[method] ?? method.toLowerCase()
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

  // Pro-centric order (the rails they run themselves first). PAYPAL / APPLE_PAY
  // belong here too: a pro can receive a PayPal transfer or take Apple Pay in
  // person, and marking it collected is the only way either gets recorded.
  const ORDER: PaymentMethod[] = [
    PaymentMethod.CASH,
    PaymentMethod.TAP_TO_PAY,
    PaymentMethod.CARD_ON_FILE,
    PaymentMethod.APPLE_PAY,
    PaymentMethod.VENMO,
    PaymentMethod.ZELLE,
    PaymentMethod.APPLE_CASH,
    PaymentMethod.PAYPAL,
  ]

  return ORDER.filter((method) => accepted.has(method)).map((method) => ({
    value: method,
    label: paymentMethodLabel(method),
  }))
}
