// lib/migration/migrationReview.ts
//
// Real summary counts for the migration review / go-live page. Reflects what the
// pro will actually see post-import: active offerings, clients visible via a
// booking (same gate as the pro clients list), imported appointments + blocked
// time, and the price-grace raises in flight.

import { BookingSource, BookingStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type MigrationRaise = {
  serviceName: string
  from: number
  to: number
  stepMode: 'PCT' | 'USD'
  stepValue: number
  cadenceWeeks: number
}

export type MigrationReviewSummary = {
  offerings: number
  clients: number
  importedBookings: number
  importedBlocks: number
  raises: MigrationRaise[]
}

// Same visibility gate the pro clients list uses (booking-gated), so the review
// count matches what the pro will find in their roster.
function visibleClientBookingWhere(now: Date): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: BookingStatus.PENDING },
      { startedAt: { not: null }, finishedAt: null },
      {
        status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS] },
        scheduledFor: { gte: now },
      },
    ],
  }
}

export async function loadMigrationReviewSummary(
  professionalId: string,
  now: Date = new Date(),
): Promise<MigrationReviewSummary> {
  const [offerings, clients, importedBookings, importedBlocks, ramps] = await Promise.all([
    prisma.professionalServiceOffering.count({
      where: { professionalId, isActive: true },
    }),
    prisma.clientProfile.count({
      where: {
        bookings: {
          some: { professionalId, ...visibleClientBookingWhere(now) },
        },
      },
    }),
    prisma.booking.count({
      where: { professionalId, source: BookingSource.IMPORTED },
    }),
    prisma.calendarBlock.count({
      where: { professionalId, note: { contains: 'import:' } },
    }),
    prisma.offeringPriceRamp.findMany({
      where: { offering: { professionalId }, completedAt: null },
      select: {
        currentPrice: true,
        targetPrice: true,
        stepMode: true,
        stepValue: true,
        cadenceWeeks: true,
        offering: { select: { service: { select: { name: true } } } },
      },
      orderBy: { startedAt: 'asc' },
      take: 200,
    }),
  ])

  const raises: MigrationRaise[] = ramps.map((r) => ({
    serviceName: r.offering.service.name,
    from: r.currentPrice.toNumber(),
    to: r.targetPrice.toNumber(),
    stepMode: r.stepMode,
    stepValue: r.stepValue.toNumber(),
    cadenceWeeks: r.cadenceWeeks,
  }))

  return { offerings, clients, importedBookings, importedBlocks, raises }
}
