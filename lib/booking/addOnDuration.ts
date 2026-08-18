// lib/booking/addOnDuration.ts
//
// The ONE place that answers "which OfferingAddOn links count, and how many
// minutes does each one add?".
//
// Two callers resolve add-ons for the same booking, from opposite ends of the
// flow: `resolveDurationWithAddOns` (availability/hold — how wide is the
// window?) and `resolveBookingAddOns` (finalize/pro-create — what gets
// persisted?). They used to carry independent copies of the same where-clause
// and the same override → pro-offering → catalog-default fallback chain, and
// the copies had DRIFTED on the failure case: a non-positive stored duration
// was silently 0 minutes on the availability side and a thrown `ADDONS_INVALID`
// on the write side. That is the B1-A shape in miniature — a window the offer
// sizes one way and the write sizes another — so both now share these two
// helpers and both refuse a link they cannot price in minutes.
import { Prisma, ServiceLocationType } from '@prisma/client'

import { normalizePositiveDurationMinutes } from '@/lib/booking/serviceItems'

/**
 * Which `OfferingAddOn` links a selection is allowed to name: active links on
 * THIS offering, either mode-agnostic or matching the booking's mode, whose
 * add-on service is itself active and add-on eligible.
 */
export function buildOfferingAddOnWhere(args: {
  addOnIds: string[]
  offeringId: string
  locationType: ServiceLocationType
}): Prisma.OfferingAddOnWhereInput {
  return {
    id: { in: args.addOnIds },
    offeringId: args.offeringId,
    isActive: true,
    OR: [{ locationType: null }, { locationType: args.locationType }],
    addOnService: {
      isActive: true,
      isAddOnEligible: true,
    },
  }
}

/**
 * The minutes ONE add-on link adds, resolved link override → the pro's own
 * offering for that add-on service (mode-specific) → the service's catalog
 * default.
 *
 * Returns `null` when the chain lands on a negative/NaN/missing number.
 * Callers must refuse rather than substitute a zero themselves: a link that
 * cannot say how long it takes would otherwise reserve less time than the
 * appointment needs.
 *
 * An EXACT zero is the one add-on-specific exception: an instant/retail
 * add-on (e.g. a take-home product) legitimately adds no time. `??` only
 * skips null/undefined, so a chain that lands on 0 got there deliberately —
 * it never silently fell through to a later, larger fallback. This is
 * intentionally add-on-only: `normalizePositiveDurationMinutes` itself stays
 * untouched because it's shared with real service/rebook durations, which
 * must never collapse to a 0-minute appointment.
 */
export function resolveAddOnDurationMinutes(args: {
  durationOverrideMinutes: number | null
  proOffering: {
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
  } | null
  defaultDurationMinutes: number | null
  locationType: ServiceLocationType
}): number | null {
  const raw =
    args.durationOverrideMinutes ??
    (args.locationType === ServiceLocationType.MOBILE
      ? args.proOffering?.mobileDurationMinutes
      : args.proOffering?.salonDurationMinutes) ??
    args.defaultDurationMinutes

  if (raw === 0) return 0

  return normalizePositiveDurationMinutes(raw)
}
