// lib/membership/customHandleBackfill.ts
//
// Backfill the legacy ProfessionalProfile.isPremium (custom-handle gate) from
// the entitlement outcome, so every existing isPremium reader reflects
// membership without per-site changes. The column is the transition surface;
// entitlements are the source of truth. Shared by the Stripe webhook sync,
// admin comp grants/revokes, and the comp-expiry job — the handle-reservation
// timer logic must stay identical across all of them.

import type { Prisma } from '@prisma/client'

export async function applyCustomHandleBackfill(
  tx: Prisma.TransactionClient,
  args: { professionalId: string; grantsCustomHandle: boolean },
): Promise<void> {
  await tx.professionalProfile.update({
    where: { id: args.professionalId },
    data: {
      isPremium: args.grantsCustomHandle,
      // When the handle goes live, drop the reservation timer; when membership
      // lapses, restart it so a now-unpaid handle gets the full grace window
      // before release.
      handleReservedAt: args.grantsCustomHandle ? null : new Date(),
    },
  })
}
