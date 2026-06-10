// lib/tenant/bookingAttribution.ts
//
// Tenant attribution snapshots written at booking creation
// (docs/architecture/tenant-model.md): proTenantId mirrors the Pro's home
// tenant (revenue attribution); clientHomeTenantId mirrors the client's
// signup tenant (acquisition attribution). Snapshots are taken once at
// create time and never recomputed, matching the Booking model's snapshot
// philosophy for addresses and pricing.
//
// During the expand phase either value may be null (un-backfilled profiles);
// the contract migration makes the columns NOT NULL once the launch-env
// backfill is verified.

type AttributionTx = {
  professionalProfile: {
    findUnique: (args: {
      where: { id: string }
      select: { homeTenantId: true }
    }) => Promise<{ homeTenantId: string | null } | null>
  }
  clientProfile: {
    findUnique: (args: {
      where: { id: string }
      select: { homeTenantId: true }
    }) => Promise<{ homeTenantId: string | null } | null>
  }
}

export type BookingTenantAttribution = {
  proTenantId: string | null
  clientHomeTenantId: string | null
}

export async function resolveBookingTenantAttribution(
  tx: AttributionTx,
  args: { professionalId: string; clientId: string },
): Promise<BookingTenantAttribution> {
  const [pro, client] = await Promise.all([
    tx.professionalProfile.findUnique({
      where: { id: args.professionalId },
      select: { homeTenantId: true },
    }),
    tx.clientProfile.findUnique({
      where: { id: args.clientId },
      select: { homeTenantId: true },
    }),
  ])

  return {
    proTenantId: pro?.homeTenantId ?? null,
    clientHomeTenantId: client?.homeTenantId ?? null,
  }
}
