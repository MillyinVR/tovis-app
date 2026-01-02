import { prisma } from '@/lib/prisma'

async function main() {
  const bookings = await prisma.booking.findMany({
    select: {
      id: true,
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      serviceItems: {
        select: {
          priceSnapshot: true,
          durationMinutesSnapshot: true,
        },
      },
    },
    take: 10000,
  })

  let updated = 0

  for (const b of bookings) {
    // Prefer serviceItems if they exist, else fall back to legacy single snapshots
    const hasItems = (b.serviceItems?.length || 0) > 0

    const subtotal = hasItems
      ? b.serviceItems.reduce((sum, it) => sum + Number(it.priceSnapshot || 0), 0)
      : Number(b.priceSnapshot || 0)

    const totalMinutes = hasItems
      ? b.serviceItems.reduce((sum, it) => sum + Number(it.durationMinutesSnapshot || 0), 0)
      : Number(b.durationMinutesSnapshot || 0)

    await prisma.booking.update({
      where: { id: b.id },
      data: {
        subtotalSnapshot: subtotal,
        totalDurationMinutes: totalMinutes || 60,
      } as any,
    })

    updated++
  }

  console.log(`Backfilled ${updated} bookings.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
