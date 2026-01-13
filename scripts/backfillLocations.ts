// scripts/backfillLocations.ts
const { PrismaClient, Prisma } = require('@prisma/client')

const prisma = new PrismaClient()

function cleanStr(s: unknown) {
  const t = typeof s === 'string' ? s.trim() : ''
  return t.length ? t : null
}

function buildAddressSnapshot(pro: {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}) {
  return {
    addressLine1: cleanStr(pro.addressLine1),
    addressLine2: cleanStr(pro.addressLine2),
    city: cleanStr(pro.city),
    state: cleanStr(pro.state),
    postalCode: cleanStr(pro.postalCode),
  }
}

function derivePrimaryLocationType(pro: { isSuite: boolean; isInSalon: boolean; isMobile: boolean }) {
  if (pro.isSuite) return 'SUITE'
  if (pro.isInSalon) return 'SALON'
  if (pro.isMobile) return 'MOBILE_BASE'
  return 'OTHER'
}

async function main() {
  console.log('Backfill locations: start')

  const pros = await prisma.professionalProfile.findMany({
    select: {
      id: true,
      businessName: true,
      timeZone: true,
      workingHours: true,

      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      latitude: true,
      longitude: true,

      isMobile: true,
      isInSalon: true,
      isSuite: true,

      locations: {
        select: { id: true, isPrimary: true, timeZone: true },
      },
    },
  })

  let createdLocations = 0
  let updatedBookings = 0
  let updatedHolds = 0
  let updatedBlocks = 0

  for (const pro of pros) {
    let primary = pro.locations.find((l: any) => l.isPrimary)

    if (!primary) {
      const loc = await prisma.professionalLocation.create({
        data: {
          professionalId: pro.id,
          type: derivePrimaryLocationType(pro),
          name: cleanStr(pro.businessName),
          isPrimary: true,
          isBookable: true,

          addressLine1: cleanStr(pro.addressLine1),
          addressLine2: cleanStr(pro.addressLine2),
          city: cleanStr(pro.city),
          state: cleanStr(pro.state),
          postalCode: cleanStr(pro.postalCode),

          lat: pro.latitude ?? null,
          lng: pro.longitude ?? null,

          timeZone: cleanStr(pro.timeZone),

          workingHours:
            pro.workingHours == null ? Prisma.DbNull : (pro.workingHours as any),
        },
        select: { id: true, timeZone: true },
      })

      primary = { id: loc.id, isPrimary: true, timeZone: loc.timeZone } as any
      createdLocations++
      console.log(`Created primary location for pro=${pro.id} location=${loc.id}`)
    }

    if (!primary) {
      throw new Error(`Backfill failed to ensure primary location for pro=${pro.id}`)
    }

    const locationId = primary.id
    const proTz = cleanStr(primary.timeZone) ?? cleanStr(pro.timeZone)

    const addressSnapshot = buildAddressSnapshot(pro)
    const latSnap = pro.latitude ?? null
    const lngSnap = pro.longitude ?? null

    const b = await prisma.booking.updateMany({
      where: {
        professionalId: pro.id,
        OR: [
          { locationId: null },
          { locationTimeZone: null },
          { locationAddressSnapshot: { equals: Prisma.DbNull } },
        ],
      },
      data: {
        locationId,
        locationTimeZone: proTz,
        locationAddressSnapshot: addressSnapshot,
        locationLatSnapshot: latSnap,
        locationLngSnapshot: lngSnap,
      },
    })
    updatedBookings += b.count

    const h = await prisma.bookingHold.updateMany({
      where: {
        professionalId: pro.id,
        OR: [
          { locationId: null },
          { locationTimeZone: null },
          { locationAddressSnapshot: { equals: Prisma.DbNull } },
        ],
      },
      data: {
        locationId,
        locationTimeZone: proTz,
        locationAddressSnapshot: addressSnapshot,
        locationLatSnapshot: latSnap,
        locationLngSnapshot: lngSnap,
      },
    })
    updatedHolds += h.count

    const cb = await prisma.calendarBlock.updateMany({
      where: { professionalId: pro.id, locationId: null },
      data: { locationId },
    })
    updatedBlocks += cb.count
  }

  console.log('Backfill locations: done')
  console.log({
    prosProcessed: pros.length,
    createdLocations,
    updatedBookings,
    updatedHolds,
    updatedBlocks,
  })

  const missingBookingTz = await prisma.booking.count({ where: { locationTimeZone: null } })
  const missingHoldTz = await prisma.bookingHold.count({ where: { locationTimeZone: null } })
  console.log({ missingBookingTz, missingHoldTz })
}

main()
  .catch((e: any) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
