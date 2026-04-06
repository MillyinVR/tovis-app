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
    },
  })

  return result.count
}