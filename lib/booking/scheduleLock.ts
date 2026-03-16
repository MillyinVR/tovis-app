import { Prisma } from '@prisma/client'

const BOOKING_SCHEDULE_LOCK_NAMESPACE = 41021

export async function lockProfessionalSchedule(
  tx: Prisma.TransactionClient,
  professionalId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${BOOKING_SCHEDULE_LOCK_NAMESPACE}::int4,
      hashtext(${professionalId})::int4
    )
  `
}