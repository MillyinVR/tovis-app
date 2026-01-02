import { prisma } from '../lib/prisma'

function toNumber(v: any, fallback = 0) {
  const n = typeof v === 'string' ? Number(v) : Number(v)
  return Number.isFinite(n) ? n : fallback
}

async function main() {
  const BATCH = 500
  let skip = 0
  let created = 0
  let updated = 0

  while (true) {
    const bookings = await prisma.booking.findMany({
      select: {
        id: true,
        serviceId: true,
        offeringId: true,
        priceSnapshot: true,
        durationMinutesSnapshot: true,
        serviceItems: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      skip,
    })

    if (bookings.length === 0) break

    for (const b of bookings) {
      // Only backfill if no items exist yet
      if (b.serviceItems.length > 0) continue

      await prisma.bookingServiceItem.create({
        data: {
          bookingId: b.id,
          serviceId: b.serviceId,
          offeringId: b.offeringId ?? null,
          priceSnapshot: b.priceSnapshot,
          durationMinutesSnapshot: b.durationMinutesSnapshot,
          sortOrder: 0,
        },
      })
      created++

      // These fields must exist in DB (and should be OPTIONAL during stage1)
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          subtotalSnapshot: b.priceSnapshot,
          totalDurationMinutes: toNumber(b.durationMinutesSnapshot, 60) || 60,
        } as any,
      })
      updated++
    }

    skip += bookings.length
    console.log(
      `Processed ${skip} bookings... createdItems=${created}, updatedBookings=${updated}`,
    )
  }

  console.log(`DONE. createdItems=${created}, updatedBookings=${updated}`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
