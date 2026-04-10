// prisma/test-data/resetLastMinuteTestData.cjs
const {
  prisma,
  LETTERS,
  emailFor,
  disconnect,
} = require('./_shared.cjs')

async function main() {
  const emails = LETTERS.map((letter) => emailFor(letter))

  const users = await prisma.user.findMany({
    where: {
      email: { in: emails },
    },
    select: {
      id: true,
      email: true,
      clientProfile: {
        select: {
          id: true,
        },
      },
    },
  })

  const clientIds = users.flatMap((user) =>
    user.clientProfile?.id ? [user.clientProfile.id] : [],
  )

  if (clientIds.length > 0) {
    await prisma.lastMinuteRecipient.deleteMany({
      where: { clientId: { in: clientIds } },
    })

    await prisma.clientIntentEvent.deleteMany({
      where: { clientId: { in: clientIds } },
    })

    await prisma.waitlistEntry.deleteMany({
      where: { clientId: { in: clientIds } },
    })

    await prisma.clientAddress.deleteMany({
      where: { clientId: { in: clientIds } },
    })

    await prisma.clientNotification.deleteMany({
      where: { clientId: { in: clientIds } },
    })

    await prisma.scheduledClientNotification.deleteMany({
      where: { clientId: { in: clientIds } },
    })

    await prisma.notificationDispatch.deleteMany({
      where: { clientId: { in: clientIds } },
    })

    await prisma.booking.deleteMany({
      where: { clientId: { in: clientIds } },
    })
  }

  const userIds = users.map((user) => user.id)

  if (userIds.length > 0) {
    await prisma.professionalFavorite.deleteMany({
      where: { userId: { in: userIds } },
    })

    await prisma.serviceFavorite.deleteMany({
      where: { userId: { in: userIds } },
    })
  }

  console.log(`Reset test-client last-minute data for ${users.length} seeded clients`)
}

main()
  .then(disconnect)
  .catch(async (error) => {
    console.error(error)
    await disconnect()
    process.exit(1)
  })