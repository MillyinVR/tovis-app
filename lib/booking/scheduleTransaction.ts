import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'

export type LockedScheduleContext = {
  tx: Prisma.TransactionClient
  now: Date
}

export async function withLockedProfessionalTransaction<T>(
  professionalId: string,
  run: (ctx: LockedScheduleContext) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockProfessionalSchedule(tx, professionalId)

    return run({
      tx,
      now: new Date(),
    })
  })
}

export async function lockClientOwnedBookingSchedule(args: {
  tx: Prisma.TransactionClient
  bookingId: string
  clientId: string
}): Promise<{
  professionalId: string
  now: Date
}> {
  const bookingRef = await args.tx.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
    },
  })

  if (!bookingRef) {
    throw new Error('BOOKING_NOT_FOUND')
  }

  if (bookingRef.clientId !== args.clientId) {
    throw new Error('FORBIDDEN')
  }

  await lockProfessionalSchedule(args.tx, bookingRef.professionalId)

  return {
    professionalId: bookingRef.professionalId,
    now: new Date(),
  }
}