const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  // NOTE: if you defined an enum SessionStep in Prisma,
  // you can just write strings here as long as they match the enum values.
  const bookings = await prisma.booking.findMany({
    select: { id: true, status: true, startedAt: true, finishedAt: true },
  })

  for (const b of bookings) {
    let step = 'NONE'

    if (b.finishedAt || b.status === 'COMPLETED') step = 'DONE'
    else if (b.startedAt) step = 'BEFORE_PHOTOS'

    await prisma.booking.update({
      where: { id: b.id },
      data: { sessionStep: step },
    })
  }

  console.log(`Backfilled ${bookings.length} bookings.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
