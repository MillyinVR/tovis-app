import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lockProfessionalSchedule } from '@/lib/booking/scheduleLock'
import { bookingError } from '@/lib/booking/errors'

export type LockedScheduleContext = {
  tx: Prisma.TransactionClient
  now: Date
}

// Interactive-transaction budgets for every schedule-locked write. Exported so
// the few hand-rolled `prisma.$transaction` creation paths that can't use the
// wrappers below (they read → lock → re-read inside the same tx) still run with
// the SAME budgets — a lock-contending booking-create must not abort on Prisma's
// tight 2s/5s defaults where every wrapper-based create would wait and succeed.
export const SCHEDULE_TX_MAX_WAIT_MS = 10_000
export const SCHEDULE_TX_TIMEOUT_MS = 20_000

export async function withLockedProfessionalTransaction<T>(
  professionalId: string,
  run: (ctx: LockedScheduleContext) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockProfessionalSchedule(tx, professionalId)

      return run({
        tx,
        now: new Date(),
      })
    },
    {
      maxWait: SCHEDULE_TX_MAX_WAIT_MS,
      timeout: SCHEDULE_TX_TIMEOUT_MS,
    },
  )
}

// Schedule-locked interactive transaction whose lock target isn't known until a
// row is read INSIDE the transaction. The aftercare rebook paths resolve the
// professional to lock from the AftercareSummary's booking, so they can't use
// `withLockedProfessionalTransaction` (which takes the id up front).
// `resolveProfessionalId` runs pre-lock to yield the id; the lock and `run`
// follow — all in
// ONE transaction under the shared schedule-tx budgets, so no caller hand-rolls
// `prisma.$transaction` with its own drift-prone maxWait/timeout (the exact
// footgun M10 had to reconcile by hand). Callers re-read + re-validate the row
// under the lock inside `run`, mirroring `withLockedProfessionalTransaction`'s
// pre-lock-read siblings (e.g. confirmClientWaitlistOffer).
export async function withLockedProfessionalScheduleByLookup<T>(args: {
  resolveProfessionalId: (tx: Prisma.TransactionClient) => Promise<string>
  run: (ctx: LockedScheduleContext) => Promise<T>
}): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const professionalId = await args.resolveProfessionalId(tx)

      await lockProfessionalSchedule(tx, professionalId)

      return args.run({
        tx,
        now: new Date(),
      })
    },
    {
      maxWait: SCHEDULE_TX_MAX_WAIT_MS,
      timeout: SCHEDULE_TX_TIMEOUT_MS,
    },
  )
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

  // A missing booking and a booking owned by someone else return the SAME
  // uniform 404 — never a 403 — so a client cannot enumerate other clients'
  // bookings by probing reschedule/cancel/checkout for a status difference.
  // (Matches the ownership-leak fix applied to the pro/admin booking routes.)
  if (!bookingRef || bookingRef.clientId !== args.clientId) {
    throw bookingError('BOOKING_NOT_FOUND')
  }

  await lockProfessionalSchedule(args.tx, bookingRef.professionalId)

  return {
    professionalId: bookingRef.professionalId,
    now: new Date(),
  }
}

export async function withLockedClientOwnedBookingTransaction<T>(args: {
  bookingId: string
  clientId: string
  run: (ctx: {
    tx: Prisma.TransactionClient
    now: Date
    professionalId: string
  }) => Promise<T>
}): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const { professionalId, now } = await lockClientOwnedBookingSchedule({
        tx,
        bookingId: args.bookingId,
        clientId: args.clientId,
      })

      return args.run({
        tx,
        now,
        professionalId,
      })
    },
    {
      maxWait: SCHEDULE_TX_MAX_WAIT_MS,
      timeout: SCHEDULE_TX_TIMEOUT_MS,
    },
  )
}