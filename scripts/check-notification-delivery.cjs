require('dotenv').config({ path: '.env.local' })

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  const deliveryId = process.argv[2]

  if (!deliveryId) {
    throw new Error('Usage: node scripts/check-notification-delivery.cjs <deliveryId>')
  }

  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      provider: true,
      channel: true,
      status: true,
      destination: true,
      providerStatus: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      attemptCount: true,
      maxAttempts: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
      suppressedAt: true,
      createdAt: true,
      updatedAt: true,
      dispatch: {
        select: {
          id: true,
          eventKey: true,
          recipientKind: true,
          title: true,
          body: true,
          href: true,
          recipientPhone: true,
          recipientEmail: true,
          sourceKey: true,
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          message: true,
          payload: true,
          createdAt: true,
        },
      },
    },
  })

  console.dir(delivery, { depth: null })
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
