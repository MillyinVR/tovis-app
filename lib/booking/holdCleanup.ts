// lib/booking/holdCleanup.ts 

import { Prisma } from '@prisma/client'

export async function deleteExpiredHoldsForProfessional(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  now: Date
}): Promise<number> {
  const result = await args.tx.bookingHold.deleteMany({
    where: {
      professionalId: args.professionalId,
      expiresAt: { lte: args.now },
    },
  })

  return result.count
}

/**
 * Drop the client's own live holds with this professional, so picking a new slot
 * replaces the old one rather than hoarding both.
 *
 * `waitlistOfferId: null` scopes that to holds the CLIENT placed. A waitlist
 * offer's hold (F14) is the PRO reserving a time they chose and promised — the
 * client browsing for an unrelated appointment must not silently hand it back,
 * and declining the offer is the way to give it up.
 */
export async function deleteActiveHoldsForClient(args: {
  tx: Prisma.TransactionClient
  professionalId: string
  clientId: string
  now: Date
}): Promise<number> {
  const result = await args.tx.bookingHold.deleteMany({
    where: {
      professionalId: args.professionalId,
      clientId: args.clientId,
      expiresAt: { gt: args.now },
      waitlistOfferId: null,
    },
  })

  return result.count
}