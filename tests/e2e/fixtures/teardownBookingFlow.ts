import type { PrismaClient } from '@prisma/client'
import type { SeedBookingFlowResult } from './seedBookingFlow'

type TeardownArgs = {
  prisma: PrismaClient
  seed: SeedBookingFlowResult | null | undefined
}

type ManagedRef = {
  managedBySeed?: boolean
}

function readManagedBySeed(value: unknown, fallback: boolean): boolean {
  if (!value || typeof value !== 'object') return fallback

  const maybeManaged = value as ManagedRef
  return typeof maybeManaged.managedBySeed === 'boolean'
    ? maybeManaged.managedBySeed
    : fallback
}

export async function teardownBookingFlow({
  prisma,
  seed,
}: TeardownArgs): Promise<void> {
  if (!seed) return

  const clientManagedBySeed = readManagedBySeed(seed.credentials.client, true)
  const professionalManagedBySeed = readManagedBySeed(
    seed.credentials.professional,
    true,
  )

  const clientId = seed.credentials.client.clientId
  const clientUserId = seed.credentials.client.userId
  const professionalId = seed.credentials.professional.professionalId
  const professionalUserId = seed.credentials.professional.userId

  const baseServiceId = seed.services.base.id
  const addOnServiceId = seed.services.addOn?.id ?? null
  const offeringAddOnId = seed.services.addOn?.offeringAddOnId ?? null

  const offeringId = seed.offering.id

  const salonLocationId = seed.locations.salon.id
  const mobileBaseLocationId = seed.locations.mobileBase?.id ?? null

  const clientAddressId = seed.clientAddress?.id ?? null
  const categoryId = seed.category.id

  const bookingWhereOr: Array<Record<string, unknown>> = [
    { offeringId },
    { professionalId },
    { locationId: salonLocationId },
  ]

  if (mobileBaseLocationId) {
    bookingWhereOr.push({ locationId: mobileBaseLocationId })
  }

  if (clientAddressId) {
    bookingWhereOr.push({ clientAddressId })
  }

  if (clientManagedBySeed) {
    bookingWhereOr.push({ clientId })
  }

  const bookingIds = (
    await prisma.booking.findMany({
      where: {
        OR: bookingWhereOr,
      },
      select: { id: true },
    })
  ).map((row) => row.id)

  if (bookingIds.length > 0) {
    await prisma.bookingServiceItem.deleteMany({
      where: {
        bookingId: { in: bookingIds },
      },
    })

    await prisma.bookingCloseoutAuditLog.deleteMany({
      where: {
        bookingId: { in: bookingIds },
      },
    })

    await prisma.bookingOverrideAuditLog.deleteMany({
      where: {
        bookingId: { in: bookingIds },
      },
    })

    await prisma.aftercareSummary.deleteMany({
      where: {
        bookingId: { in: bookingIds },
      },
    })

    await prisma.booking.deleteMany({
      where: {
        id: { in: bookingIds },
      },
    })
  }

  const holdWhereOr: Array<Record<string, unknown>> = [
    { offeringId },
    { professionalId },
    { locationId: salonLocationId },
  ]

  if (mobileBaseLocationId) {
    holdWhereOr.push({ locationId: mobileBaseLocationId })
  }

  if (clientAddressId) {
    holdWhereOr.push({ clientAddressId })
  }

  if (clientManagedBySeed) {
    holdWhereOr.push({ clientId })
  }

  await prisma.bookingHold.deleteMany({
    where: {
      OR: holdWhereOr,
    },
  })

  if (offeringAddOnId) {
    await prisma.offeringAddOn.deleteMany({
      where: {
        id: offeringAddOnId,
      },
    })
  }

  await prisma.offeringAddOn.deleteMany({
    where: {
      offeringId,
    },
  })

  await prisma.professionalServiceOffering.deleteMany({
    where: {
      id: offeringId,
    },
  })

  if (clientAddressId) {
    await prisma.clientAddress.deleteMany({
      where: {
        id: clientAddressId,
      },
    })
  }

  await prisma.professionalLocation.deleteMany({
    where: {
      id: {
        in: [salonLocationId, mobileBaseLocationId].filter(
          (value): value is string => Boolean(value),
        ),
      },
    },
  })

  await prisma.service.deleteMany({
    where: {
      id: {
        in: [baseServiceId, addOnServiceId].filter(
          (value): value is string => Boolean(value),
        ),
      },
    },
  })

  await prisma.serviceCategory.deleteMany({
    where: {
      id: categoryId,
    },
  })

  if (clientManagedBySeed) {
    await prisma.clientProfile.deleteMany({
      where: {
        id: clientId,
      },
    })
  }

  if (professionalManagedBySeed) {
    await prisma.professionalProfile.deleteMany({
      where: {
        id: professionalId,
      },
    })
  }

  const userIdsToDelete: string[] = []

  if (clientManagedBySeed) {
    userIdsToDelete.push(clientUserId)
  }

  if (professionalManagedBySeed) {
    userIdsToDelete.push(professionalUserId)
  }

  if (userIdsToDelete.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIdsToDelete,
        },
      },
    })
  }
}