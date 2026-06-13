// lib/tenant/bookingAttribution.ts
//
// Tenant attribution snapshots written at booking creation
// (docs/architecture/tenant-model.md): proTenantId mirrors the Pro's home
// tenant (revenue attribution); clientHomeTenantId mirrors the client's
// signup tenant (acquisition attribution). Snapshots are taken once at
// create time and never recomputed, matching the Booking model's snapshot
// philosophy for addresses and pricing.
//
// Contract phase: homeTenantId is NOT NULL on both profiles, so attribution
// is always resolvable — a missing profile row here is a data-integrity bug
// in the caller and throws rather than writing a null snapshot.

type AttributionTx = {
  professionalProfile: {
    findUnique: (args: {
      where: { id: string }
      select: { homeTenantId: true }
    }) => Promise<{ homeTenantId: string } | null>
  }
  clientProfile: {
    findUnique: (args: {
      where: { id: string }
      select: { homeTenantId: true }
    }) => Promise<{ homeTenantId: string } | null>
  }
}

export type BookingTenantAttribution = {
  proTenantId: string
  clientHomeTenantId: string
}

// Minimal client shape for resolving a single Pro's home tenant.
type ProProfileLookupClient = {
  professionalProfile: AttributionTx['professionalProfile']
}

/**
 * Resolves a single Pro's home tenant for attributing pro-owned rows created
 * outside the booking write boundary (MediaAsset, Notification). Mirrors the
 * booking attribution invariant: homeTenantId is NOT NULL (contract phase), so
 * a missing profile is a caller data-integrity bug and throws rather than
 * writing a null tenant.
 */
export async function resolveProTenantId(
  client: ProProfileLookupClient,
  professionalId: string,
): Promise<string> {
  const pro = await client.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { homeTenantId: true },
  })

  if (!pro) {
    throw new Error(`resolveProTenantId: professional ${professionalId} not found`)
  }

  return pro.homeTenantId
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

  if (!pro) {
    throw new Error(
      `resolveBookingTenantAttribution: professional ${args.professionalId} not found`,
    )
  }

  if (!client) {
    throw new Error(
      `resolveBookingTenantAttribution: client ${args.clientId} not found`,
    )
  }

  return {
    proTenantId: pro.homeTenantId,
    clientHomeTenantId: client.homeTenantId,
  }
}
