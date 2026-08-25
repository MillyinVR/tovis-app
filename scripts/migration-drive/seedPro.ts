// scripts/migration-drive/seedPro.ts
//
// Seeds one disposable test pro (Booksy-style hair-color pro) into the LOCAL DEV
// database for the migration-wizard drive. Mirrors tests/e2e/fixtures/seedBookingFlow.ts
// (User + emailHashV2 blind index + ProfessionalProfile with license fields).
// Run: npx tsx --env-file=.env.development.local scripts/migration-drive/seedPro.ts

import {
  Prisma,
  PrismaClient,
  ProfessionType,
  ProfessionalLocationType,
  Role,
  VerificationStatus,
} from '@prisma/client'

import { hashPassword } from '../../lib/auth'
import { buildUserContactLookupData } from '../../lib/security/contactLookup'
import {
  TOVIS_ROOT_TENANT_NAME,
  TOVIS_ROOT_TENANT_SLUG,
} from '../../lib/tenant/constants'

const prisma = new PrismaClient()

const TAG = `mig_${Date.now().toString(36)}`
const PASSWORD = 'TestPassword123!'

async function main() {
  const rootTenant = await prisma.tenant.upsert({
    where: { slug: TOVIS_ROOT_TENANT_SLUG },
    update: {},
    create: {
      slug: TOVIS_ROOT_TENANT_SLUG,
      name: TOVIS_ROOT_TENANT_NAME,
      isActive: true,
    },
    select: { id: true },
  })

  const email = `${TAG}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      password: await hashPassword(PASSWORD),
      role: Role.PRO,
      // Without BOTH of these the login route mints a VERIFICATION-kind
      // session (isFullyVerified = phone && email) and the proxy 403s every
      // /api/v1 call with VERIFICATION_REQUIRED.
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      ...buildUserContactLookupData({ email }),
    },
    select: { id: true, email: true },
  })

  const handle = `${tagSafe(TAG)}-pro`
  const pro = await prisma.professionalProfile.create({
    data: {
      userId: user.id,
      homeTenantId: rootTenant.id,
      firstName: 'Rosa',
      lastName: 'Marquez',
      businessName: 'Rosa Marquez Color Studio',
      handle,
      handleNormalized: handle,
      location: 'San Diego, CA',
      timeZone: 'America/Los_Angeles',
      professionType: ProfessionType.HAIRSTYLIST,
      licenseNumber: 'SK-TEST-0001',
      licenseState: 'CA',
      licenseVerified: true,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerifiedAt: new Date(),
      licenseVerifiedSource: 'E2E_SEED',
      licenseStatusCode: 'CURRENT',
    },
    select: { id: true },
  })

  const salonTimeZone = 'America/Los_Angeles'
  const salonLocation = await prisma.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: ProfessionalLocationType.SALON,
      name: 'Migration Drive Salon',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Migration St, San Diego, CA 92101',
      addressLine1: '123 Migration St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: new Prisma.Decimal('32.7157000'),
      lng: new Prisma.Decimal('-117.1611000'),
      timeZone: salonTimeZone,
      workingHours: workingHoursJson(),
      bufferMinutes: 15,
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 60,
    },
    select: { id: true },
  })

  console.log(
    JSON.stringify(
      { tag: TAG, email, password: PASSWORD, userId: user.id, professionalId: pro.id, salonLocationId: salonLocation.id },
      null,
      2,
    ),
  )
}

function tagSafe(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9_-]/g, '')
}

function workingHoursJson(): Prisma.InputJsonValue {
  return {
    mon: { enabled: true, start: '00:00', end: '23:59' },
    tue: { enabled: true, start: '00:00', end: '23:59' },
    wed: { enabled: true, start: '00:00', end: '23:59' },
    thu: { enabled: true, start: '00:00', end: '23:59' },
    fri: { enabled: true, start: '00:00', end: '23:59' },
    sat: { enabled: true, start: '00:00', end: '23:59' },
    sun: { enabled: true, start: '00:00', end: '23:59' },
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err)
    return prisma.$disconnect().then(() => process.exit(1))
  })
