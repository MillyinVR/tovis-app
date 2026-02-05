import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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

// Simple deterministic dev password.
// (If your auth expects bcrypt/argon hashes, we’ll switch it after we see which field exists.)
const DEV_PASSWORD_PLAIN = 'password123'

async function createUserAdaptive(args: { email: string; role: string }) {
  const { email, role } = args

  // Try a few shapes because your schema recently added "password" (migration shows that),
  // but the exact field name might be passwordHash/passwordDigest/etc.
  const attempts: Array<{ label: string; data: any }> = [
    {
      label: 'email+role+password (plain)',
      data: { email, role, password: DEV_PASSWORD_PLAIN },
    },
    {
      label: 'email+role+passwordHash (plain placeholder)',
      data: { email, role, passwordHash: DEV_PASSWORD_PLAIN },
    },
    {
      label: 'email+role+hashedPassword (plain placeholder)',
      data: { email, role, hashedPassword: DEV_PASSWORD_PLAIN },
    },
    {
      label: 'email+role only',
      data: { email, role },
    },
  ]

  let lastErr: any = null

  for (const a of attempts) {
    try {
      const u = await prisma.user.create({
        data: a.data,
        select: { id: true, email: true, role: true },
      } as any)

      console.log(`✅ Created user (${a.label}):`, u.email, u.role)
      return u
    } catch (e: any) {
      lastErr = e
      // keep going
    }
  }

  console.error('❌ Failed creating user. Tried:')
  for (const a of attempts) console.error('  -', a.label, '=> keys:', Object.keys(a.data).join(', '))
  throw lastErr
}

async function main() {
  // --- 1) Create the 3 users ---
  const admin = await createUserAdaptive({ email: 'admin@test.com', role: 'ADMIN' })
  const proUser = await createUserAdaptive({ email: 'pro@test.com', role: 'PRO' })
  const clientUser = await createUserAdaptive({ email: 'client@test.com', role: 'CLIENT' })

  // --- 2) Ensure ClientProfile exists for client user (your FK error earlier proves this is required) ---
  await prisma.clientProfile.upsert({
    where: { userId: clientUser.id },
    update: {},
    create: {
      userId: clientUser.id,
      firstName: 'Client',
      lastName: 'Test',
    } as any,
    select: { id: true },
  })
  console.log('✅ ClientProfile ensured for client@test.com')

  // --- 3) Ensure ProfessionalProfile exists + APPROVED for pro user ---
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
      verificationStatus: 'APPROVED' as any,
      licenseVerified: true,
      businessName: 'Pro Test Salon',
      location: 'Los Angeles, CA',
      timeZone: 'America/Los_Angeles',
      handle: 'protest',
      handleNormalized: 'protest',
    } as any,
    select: { id: true },
  })
  console.log('✅ ProfessionalProfile ensured for pro@test.com:', proProfile.id)

  // --- 4) Ensure at least one primary+bookable location WITH GEO (pins) ---
  await prisma.$transaction(async (tx) => {
    // clear primary flags
    await tx.professionalLocation.updateMany({
      where: { professionalId: proProfile.id },
      data: { isPrimary: false },
    })

    // if any location has coords, promote it
    const withGeo = await tx.professionalLocation.findFirst({
      where: { professionalId: proProfile.id, lat: { not: null }, lng: { not: null } } as any,
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    })

    if (withGeo) {
      await tx.professionalLocation.update({
        where: { id: withGeo.id },
        data: {
          isPrimary: true,
          isBookable: true,
          timeZone: 'America/Los_Angeles',
          workingHours: defaultWorkingHours() as any,
        } as any,
      })
      console.log('✅ Promoted existing geo location to primary:', withGeo.id)
      return
    }

    const created = await tx.professionalLocation.create({
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

        // Good enough for dev pins:
        lat: 34.1016 as any,
        lng: -118.3409 as any,

        timeZone: 'America/Los_Angeles',
        workingHours: defaultWorkingHours() as any,
      } as any,
      select: { id: true },
    })

    console.log('✅ Created primary SALON location w/geo:', created.id)
  })

  // --- 5) OPTIONAL: Admin permissions (only if your admin UI checks AdminPermission rows)
  // If your getAdminUiPerms relies on AdminPermission, seed something broad:
  try {
    // If your schema uses adminPermissions relation like you showed,
    // this creates one permission row. Adjust "role" field name if needed.
    await prisma.adminPermission.create({
      data: {
        userId: admin.id,
        role: 'SUPER_ADMIN' as any,
      } as any,
    })
    console.log('✅ AdminPermission seeded for admin@test.com')
  } catch {
    console.log('ℹ️ Skipped AdminPermission seed (table/fields may differ). If admin UI blocks you, paste getAdminUiPerms.')
  }

  console.log('\n🎉 Seed complete.')
  console.log('Logins:')
  console.log('  admin@test.com / password123')
  console.log('  pro@test.com / password123')
  console.log('  client@test.com / password123')
}

main()
  .catch((e) => {
    console.error('❌ seedAfterReset failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
