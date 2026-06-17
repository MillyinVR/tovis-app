// lib/booking/rampedUnitPrice.ts
//
// Quote-time price resolution for the booking charge paths. When a migrated
// pro's offering carries an OfferingPriceRamp (its grandfathered price was below
// the catalog minimum), the price actually charged depends on the client:
//   - new client      → the catalog minimum (ramp.targetPrice, == the stored
//                        offering price, == what the availability screen shows)
//   - existing client  → the current ramped price (a grace discount that walks
//                        up to the minimum over time)
// Offerings with no ramp (the common case) charge their stored price unchanged,
// and the existing-client lookup is skipped entirely.
//
// The new-vs-existing decision delegates to the canonical `effectiveUnitPrice`
// resolver in lib/migration/priceRamp so the formula lives in exactly one place.

import { Prisma, ServiceLocationType } from '@prisma/client'

import { effectiveUnitPrice } from '@/lib/migration/priceRamp'

// The mode-specific ramp for one offering (the caller picks salon vs mobile).
export type OfferingModeRamp = {
  currentPrice: Prisma.Decimal
  targetPrice: Prisma.Decimal
  startedAt: Date
}

// An offering carries at most one ramp per mode. Pick the one for this booking's
// mode (salon vs mobile); absent → no grace, charge the stored price.
export function pickOfferingModeRamp(
  ramps:
    | ReadonlyArray<{
        mode: ServiceLocationType
        currentPrice: Prisma.Decimal
        targetPrice: Prisma.Decimal
        startedAt: Date
      }>
    | null
    | undefined,
  mode: ServiceLocationType,
): OfferingModeRamp | null {
  const ramp = (ramps ?? []).find((r) => r.mode === mode)
  return ramp
    ? {
        currentPrice: ramp.currentPrice,
        targetPrice: ramp.targetPrice,
        startedAt: ramp.startedAt,
      }
    : null
}

// Pure resolution once the inputs are known. Returned as an exact Decimal: the
// no-ramp branch keeps cents; ramp prices are whole dollars (built via
// Math.round) so wrapping the resolver's number is lossless.
export function pickRampedUnitPrice(args: {
  listPrice: Prisma.Decimal
  minPrice: Prisma.Decimal
  ramp: OfferingModeRamp | null
  isExistingClient: boolean
}): Prisma.Decimal {
  if (!args.ramp) {
    return Prisma.Decimal.max(args.listPrice, args.minPrice)
  }
  const charged = effectiveUnitPrice({
    listPrice: args.listPrice.toNumber(),
    minPrice: args.minPrice.toNumber(),
    ramp: {
      currentPrice: args.ramp.currentPrice.toNumber(),
      targetPrice: args.ramp.targetPrice.toNumber(),
    },
    isExistingClient: args.isExistingClient,
  })
  return new Prisma.Decimal(charged)
}

// "Existing" = the client already had a booking with this pro before the ramp
// started (i.e. they were a client before the pro migrated + set this price).
async function clientBookedProBefore(
  tx: Prisma.TransactionClient,
  clientId: string,
  professionalId: string,
  before: Date,
): Promise<boolean> {
  const prior = await tx.booking.findFirst({
    where: { clientId, professionalId, createdAt: { lt: before } },
    select: { id: true },
  })
  return prior !== null
}

// Resolve the unit price to snapshot/charge for one offering + mode + client.
// With no ramp (the common case) this returns max(listPrice, minPrice) and never
// touches the DB. With a ramp it looks up whether the client predates the ramp.
export async function resolveChargedUnitPrice(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  clientId: string
  listPrice: Prisma.Decimal
  minPrice: Prisma.Decimal
  ramp: OfferingModeRamp | null
}): Promise<Prisma.Decimal> {
  // No ramp → resolve without touching the DB (skip the existing-client lookup).
  // The existing-client flag is irrelevant in this branch.
  if (!args.ramp) {
    return pickRampedUnitPrice({
      listPrice: args.listPrice,
      minPrice: args.minPrice,
      ramp: null,
      isExistingClient: false,
    })
  }
  const isExistingClient = await clientBookedProBefore(
    args.tx,
    args.clientId,
    args.professionalId,
    args.ramp.startedAt,
  )
  return pickRampedUnitPrice({
    listPrice: args.listPrice,
    minPrice: args.minPrice,
    ramp: args.ramp,
    isExistingClient,
  })
}
