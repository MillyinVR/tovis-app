// lib/booking/prepay.ts
//
// How much money this booking takes UP FRONT, in cents. The one place that
// combines the pro's ordinary deposit rule with K10's per-service prepay
// requirement.
//
// Prepay is NOT a second payment rail (K10, D4 = per-service). It is a 100%
// deposit, so it inherits — unchanged and already proven — the deposit
// PaymentIntent, the credit against the final total
// (lib/booking/depositCredit.ts), partial-refund accounting, the dispute
// freeze, the release sweep, the unpaid reminder and closeout-at-zero. The only
// genuinely new question is the amount, and it is answered here by calling the
// EXISTING `computeDepositCents` with a 100% percentage rather than by writing
// a parallel money calculation.
//
// The three rules this must not get wrong:
//
//   - **The two terms never stack.** A pro can have BOTH an account-wide
//     deposit rule that fires and a prepay-required service. Adding them would
//     charge 125% of a bill. We take the LARGER: prepay is a floor on the
//     up-front charge, never a reduction of the deposit the pro configured.
//     (A cheap prepay-required base service under expensive add-ons really can
//     be smaller than a percentage of the whole subtotal.)
//
//   - **Prepay is capped at the bill.** 100% must mean exactly 100%, so
//     `deriveDepositCredit().coversTotal` is true and closeout settles at $0
//     with no second charge. Sizing it off the undiscounted subtotal when a
//     last-minute discount has reduced the total would collect more than is
//     owed and leave `excessHeldCents` behind on every prepaid booking.
//
//   - **The ordinary deposit term is left exactly as it was.** It is NOT capped
//     here. A pro whose flat deposit already exceeded a discounted bill kept
//     that behaviour before K10 (K10-A reports the difference as
//     `excessHeldCents`), and K10 must not change what an untouched pro
//     collects.
//
// Pure: no DB access, no Stripe I/O. The caller owns the query.

import { DepositType, OfferingPrepayScope } from '@/lib/prismaEnums'

import {
  computeDepositCents,
  type DepositSettings,
} from '@/lib/booking/discoveryDepositPlan'

/**
 * What a prepay-required service asks for: the whole of the covered amount.
 *
 * Expressed as PERCENT/100 rather than a new `DepositType.FULL` value on
 * purpose. A fourth enum member would surface in the pro's account-wide deposit
 * settings UI and its validation, where "full" is not on offer — prepay is a
 * per-service rule (D4), not an account-wide deposit type. This routes through
 * the same `computeDepositCents` every other deposit uses.
 */
export const PREPAY_DEPOSIT_SETTINGS: DepositSettings = {
  depositEnabled: true,
  depositType: DepositType.PERCENT,
  depositPercent: 100,
  depositFlatAmountCents: null,
}

export type PrepayCoverageInput = Readonly<{
  /** The prepay requirement in force, or null when the service demands none. */
  prepayScope: OfferingPrepayScope | null
  /**
   * The prepay-required BASE service's own charged price, in cents — after any
   * price-grace ramp, excluding add-ons.
   */
  baseServiceCents: number
  /** What the client will actually be billed for this booking, in cents. */
  bookingTotalCents: number
}>

/**
 * The slice of the bill a prepay requirement covers, in cents. 0 when the
 * service demands no prepay.
 *
 * `SERVICE_ONLY` covers the base service and leaves add-ons on the final bill;
 * `ENTIRE_BOOKING` covers the whole total. Both are capped at the bill, so a
 * discount that lands below the base price can never produce an up-front charge
 * bigger than the booking itself.
 */
export function resolvePrepayCoveredCents(args: PrepayCoverageInput): number {
  if (args.prepayScope == null) return 0

  const bookingTotalCents = Math.max(0, Math.round(args.bookingTotalCents))

  if (args.prepayScope === OfferingPrepayScope.ENTIRE_BOOKING) {
    return bookingTotalCents
  }

  return Math.min(Math.max(0, Math.round(args.baseServiceCents)), bookingTotalCents)
}

export type UpfrontDepositInput = PrepayCoverageInput &
  Readonly<{
    /** The pro's `depositScope` calls for an ordinary deposit on this booking. */
    scopeDepositRequired: boolean
    /** The pro's account-wide deposit configuration. */
    settings: DepositSettings
    /**
     * The service subtotal the ordinary deposit has always been sized against,
     * in cents (base + add-ons, before any discount). Unchanged by K10.
     */
    serviceSubtotalCents: number
  }>

/**
 * The up-front deposit to collect on this booking, in cents.
 *
 * Returns the larger of the pro's ordinary deposit and the service's prepay
 * requirement — see the file header for why they must not be added, and why
 * only the prepay term is capped at the bill.
 */
export function computeUpfrontDepositCents(args: UpfrontDepositInput): number {
  const scopeCents = args.scopeDepositRequired
    ? computeDepositCents({
        settings: args.settings,
        servicePriceCents: args.serviceSubtotalCents,
      })
    : 0

  const prepayCents =
    args.prepayScope == null
      ? 0
      : computeDepositCents({
          settings: PREPAY_DEPOSIT_SETTINGS,
          servicePriceCents: resolvePrepayCoveredCents(args),
        })

  return Math.max(scopeCents, prepayCents)
}
