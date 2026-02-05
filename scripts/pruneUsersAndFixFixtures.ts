import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const KEEP_EMAILS = new Set(['admin@test.com', 'pro@test.com', 'client@test.com'])

type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type WorkingHoursDay = { enabled: boolean; start: string; end: string }
type WorkingHoursObj = Record<WeekdayKey, WorkingHoursDay>

function defaultWorkingHours(): WorkingHoursObj {
  const make = (enabled: boolean): WorkingHoursDay => ({ enabled, start: '09:00', end: '17:00' })
  return {
    mon: make(true),
    tue: make(true),
    wed: make(true),
    thu: make(true),
    fri: make(true),
    sat: make(false),
    sun: make(false),
  }
}

async function main() {
  // 0) Confirm keep users exist
  const keepUsers = await prisma.user.findMany({
    where: { email: { in: Array.from(KEEP_EMAILS) } },
    select: { id: true, email: true, role: true },
  })

  const foundEmails = new Set(keepUsers.map((u) => u.email))
  const missing = Array.from(KEEP_EMAILS).filter((e) => !foundEmails.has(e))
  if (missing.length) {
    throw new Error(`Missing keep users in DB: ${missing.join(', ')}`)
  }

  // 1) Delete everything for users we don't keep.
  // NOTE: If your schema doesn't cascade perfectly, this may throw.
  // If it throws, scroll down for the "nuclear option" (reset+seed).
  const deleteResult = await prisma.user.deleteMany({
    where: { email: { notIn: Array.from(KEEP_EMAILS) } },
  })

  console.log(`✅ Deleted users: ${deleteResult.count}`)

  // 2) Re-fetch kept users (ids)
  const adminUser = keepUsers.find((u) => u.email === 'admin@test.com')!
  const proUser = keepUsers.find((u) => u.email === 'pro@test.com')!
  const clientUser = keepUsers.find((u) => u.email === 'client@test.com')!

  // 3) Normalize roles (so requirePro / admin guards behave)
  await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'ADMIN' as any } })
  await prisma.user.update({ where: { id: proUser.id }, data: { role: 'PRO' as any } })
  await prisma.user.update({ where: { id: clientUser.id }, data: { role: 'CLIENT' as any } })

  // 4) Ensure PRO has a ProfessionalProfile
  const proProfile = await prisma.professionalProfile.upsert({
    where: { userId: proUser.id },
    update: {
      verificationStatus: 'APPROVED' as any,
      licenseVerified: true,
      businessName: 'Pro Test Salon',
      location: 'Los Angeles, CA',
      timeZone: 'America/Los_Angeles',
      handle: 'protest',
      handleNormalized: 'protest',
    } as any,
    create: {
      userId: proUser.id,
      firstName: 'Pro',
      lastName: 'Test',
      businessName: 'Pro Test Salon',
      location: 'Los Angeles, CA',
      timeZone: 'America/Los_Angeles',
      handle: 'protest',
      handleNormalized: 'protest',
      verificationStatus: 'APPROVED' as any,
      licenseVerified: true,
      autoAcceptBookings: false,
    } as any,
    select: { id: true },
  })

  // 5) Ensure PRO has exactly one primary, bookable location WITH GEO (so search pins work)
  // If they already have a valid geo location, we’ll prefer that and just normalize flags.
  const existing = await prisma.professionalLocation.findMany({
    where: { professionalId: proProfile.id },
    select: { id: true, isPrimary: true, isBookable: true, lat: true, lng: true, type: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    take: 50,
  })

  const hasGoodGeo = (l: any) => l.lat != null && l.lng != null

  const best = existing.find((l) => l.isPrimary && l.isBookable && hasGoodGeo(l))
    ?? existing.find((l) => l.isBookable && hasGoodGeo(l))
    ?? existing.find((l) => hasGoodGeo(l))
    ?? null

  await prisma.$transaction(async (tx) => {
    // clear primary flags (we will re-assert one)
    await tx.professionalLocation.updateMany({
      where: { professionalId: proProfile.id },
      data: { isPrimary: false },
    })

    if (best) {
      // make best the primary + bookable
      await tx.professionalLocation.update({
        where: { id: best.id },
        data: {
          isPrimary: true,
          isBookable: true,
          timeZone: 'America/Los_Angeles',
          workingHours: defaultWorkingHours() as any,
        } as any,
      })
      return
    }

    // else: create a fully valid SALON location (with coords)
    await tx.professionalLocation.create({
      data: {
        professionalId: proProfile.id,
        type: 'SALON' as any,
        name: 'Pro Test Salon',
        isPrimary: true,
        isBookable: true,

        formattedAddress: '6801 Hollywood Blvd, Los Angeles, CA 90028, USA',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90028',
        countryCode: 'US',
        placeId: 'TEST_PLACE_ID',

        // Hollywood coords (fine for dev)
        lat: 34.1016 as any,
        lng: -118.3409 as any,

        timeZone: 'America/Los_Angeles',
        workingHours: defaultWorkingHours() as any,
      } as any,
      select: { id: true },
    })
  })

  // 6) Optional: sanity print
  const finalLoc = await prisma.professionalLocation.findFirst({
    where: { professionalId: proProfile.id, isPrimary: true },
    select: { id: true, type: true, isBookable: true, lat: true, lng: true, timeZone: true, placeId: true },
  })

  console.log('✅ Fixture PRO profile:', proProfile.id)
  console.log('✅ Fixture PRO primary location:', finalLoc)

  console.log('✅ Done. Only 3 users remain + pro has a valid primary geo location.')
}

main()
  .catch((e) => {
    console.error('❌ pruneUsersAndFixFixtures failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
