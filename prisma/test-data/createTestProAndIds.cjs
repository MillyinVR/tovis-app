// prisma/test-data/createTestProAndIds.cjs
const path = require('path')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') })
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

const bcrypt = require('bcrypt')
const {
  PrismaClient,
  ProfessionType,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  VerificationStatus,
  PaymentCollectionTiming,
  NotificationEventKey,
} = require('@prisma/client')

const prisma = new PrismaClient()

const TEST_PRO_EMAIL = 'testpro-lastminute@test.com'
const TEST_PRO_PASSWORD = 'password123'
const TEST_HANDLE = 'testprolastminute'
const TEST_BUSINESS_NAME = 'Test Pro Last Minute Studio'

function buildWorkingHours() {
  return {
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: true, start: '10:00', end: '16:00' },
    sun: { enabled: false, start: '09:00', end: '17:00' },
  }
}

async function getOrCreateService() {
const existing = await prisma.service.findFirst({
  where: { isActive: true },
  orderBy: { name: 'asc' },
  select: {
    id: true,
    name: true,
    allowMobile: true,
    defaultDurationMinutes: true,
    minPrice: true,
  },
})

  if (existing) {
    return existing
  }

  const category = await prisma.serviceCategory.upsert({
    where: { slug: 'test-category-last-minute' },
    update: {},
    create: {
      name: 'Test Category',
      slug: 'test-category-last-minute',
      description: 'Test category for last-minute fixture data',
      isActive: true,
    },
    select: { id: true },
  })

  return prisma.service.create({
    data: {
      name: 'Test Haircut',
      categoryId: category.id,
      description: 'Seeded test service',
      defaultDurationMinutes: 60,
      minPrice: '100.00',
      allowMobile: true,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      allowMobile: true,
      defaultDurationMinutes: true,
      minPrice: true,
    },
  })
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL')
  }

  const passwordHash = await bcrypt.hash(TEST_PRO_PASSWORD, 10)
  const service = await getOrCreateService()

  const user = await prisma.user.upsert({
    where: { email: TEST_PRO_EMAIL },
    update: {
      password: passwordHash,
      role: Role.PRO,
      phone: '+15550000001',
      phoneVerifiedAt: new Date(),
    },
    create: {
      email: TEST_PRO_EMAIL,
      password: passwordHash,
      role: Role.PRO,
      phone: '+15550000001',
      phoneVerifiedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
    },
  })

  const professionalProfile = await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    update: {
      firstName: 'Test',
      lastName: 'Pro',
      phone: '+15550000001',
      phoneVerifiedAt: new Date(),
      businessName: TEST_BUSINESS_NAME,
      handle: TEST_HANDLE,
      handleNormalized: TEST_HANDLE,
      bio: 'Seeded professional profile for last-minute testing.',
      location: 'San Diego, CA',
      timeZone: 'America/Los_Angeles',
      mobileRadiusMiles: 15,
      mobileBasePostalCode: '92101',
      professionType: ProfessionType.COSMETOLOGIST,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerified: true,
      licenseVerifiedAt: new Date(),
      licenseVerifiedSource: 'TEST_SEED',
      licenseStatusCode: 'CURRENT',
      autoAcceptBookings: true,
    },
    create: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Pro',
      phone: '+15550000001',
      phoneVerifiedAt: new Date(),
      businessName: TEST_BUSINESS_NAME,
      handle: TEST_HANDLE,
      handleNormalized: TEST_HANDLE,
      bio: 'Seeded professional profile for last-minute testing.',
      location: 'San Diego, CA',
      timeZone: 'America/Los_Angeles',
      mobileRadiusMiles: 15,
      mobileBasePostalCode: '92101',
      professionType: ProfessionType.COSMETOLOGIST,
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerified: true,
      licenseVerifiedAt: new Date(),
      licenseVerifiedSource: 'TEST_SEED',
      licenseStatusCode: 'CURRENT',
      autoAcceptBookings: true,
    },
    select: {
      id: true,
      userId: true,
      businessName: true,
      handle: true,
      timeZone: true,
      mobileRadiusMiles: true,
    },
  })

  const location = await prisma.professionalLocation.upsert({
    where: {
      id: (
        await prisma.professionalLocation.findFirst({
          where: {
            professionalId: professionalProfile.id,
            name: 'Test Salon HQ',
          },
          select: { id: true },
        })
      )?.id ?? 'missing',
    },
    update: {
      type: ProfessionalLocationType.SALON,
      name: 'Test Salon HQ',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Test St, San Diego, CA 92101',
      addressLine1: '123 Test St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: '32.715736',
      lng: '-117.161087',
      timeZone: 'America/Los_Angeles',
      workingHours: buildWorkingHours(),
      bufferMinutes: 15,
      stepMinutes: 30,
      advanceNoticeMinutes: 15,
      maxDaysAhead: 365,
    },
    create: {
      professionalId: professionalProfile.id,
      type: ProfessionalLocationType.SALON,
      name: 'Test Salon HQ',
      isPrimary: true,
      isBookable: true,
      formattedAddress: '123 Test St, San Diego, CA 92101',
      addressLine1: '123 Test St',
      city: 'San Diego',
      state: 'CA',
      postalCode: '92101',
      countryCode: 'US',
      lat: '32.715736',
      lng: '-117.161087',
      timeZone: 'America/Los_Angeles',
      workingHours: buildWorkingHours(),
      bufferMinutes: 15,
      stepMinutes: 30,
      advanceNoticeMinutes: 15,
      maxDaysAhead: 365,
    },
    select: {
      id: true,
      type: true,
      timeZone: true,
      lat: true,
      lng: true,
      city: true,
      state: true,
    },
  }).catch(async () => {
    const existing = await prisma.professionalLocation.findFirstOrThrow({
      where: {
        professionalId: professionalProfile.id,
        name: 'Test Salon HQ',
      },
      select: {
        id: true,
        type: true,
        timeZone: true,
        lat: true,
        lng: true,
        city: true,
        state: true,
      },
    })

    return prisma.professionalLocation.update({
      where: { id: existing.id },
      data: {
        isPrimary: true,
        isBookable: true,
        formattedAddress: '123 Test St, San Diego, CA 92101',
        addressLine1: '123 Test St',
        city: 'San Diego',
        state: 'CA',
        postalCode: '92101',
        countryCode: 'US',
        lat: '32.715736',
        lng: '-117.161087',
        timeZone: 'America/Los_Angeles',
        workingHours: buildWorkingHours(),
      },
      select: {
        id: true,
        type: true,
        timeZone: true,
        lat: true,
        lng: true,
        city: true,
        state: true,
      },
    })
  })

  const offering = await prisma.professionalServiceOffering.upsert({
    where: {
      professionalId_serviceId: {
        professionalId: professionalProfile.id,
        serviceId: service.id,
      },
    },
    update: {
      title: `Test ${service.name}`,
      description: 'Seeded offering for last-minute test flows',
      offersInSalon: true,
      offersMobile: Boolean(service.allowMobile),
      salonPriceStartingAt: '100.00',
      salonDurationMinutes: service.defaultDurationMinutes,
      mobilePriceStartingAt: service.allowMobile ? '120.00' : null,
      mobileDurationMinutes: service.allowMobile ? service.defaultDurationMinutes : null,
      isActive: true,
    },
    create: {
      professionalId: professionalProfile.id,
      serviceId: service.id,
      title: `Test ${service.name}`,
      description: 'Seeded offering for last-minute test flows',
      offersInSalon: true,
      offersMobile: Boolean(service.allowMobile),
      salonPriceStartingAt: '100.00',
      salonDurationMinutes: service.defaultDurationMinutes,
      mobilePriceStartingAt: service.allowMobile ? '120.00' : null,
      mobileDurationMinutes: service.allowMobile ? service.defaultDurationMinutes : null,
      isActive: true,
    },
    select: {
      id: true,
      serviceId: true,
      offersInSalon: true,
      offersMobile: true,
    },
  })

  await prisma.professionalPaymentSettings.upsert({
    where: { professionalId: professionalProfile.id },
    update: {
      collectPaymentAt: PaymentCollectionTiming.AFTER_SERVICE,
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptVenmo: false,
      acceptZelle: false,
      acceptAppleCash: false,
      tipsEnabled: true,
      allowCustomTip: true,
    },
    create: {
      professionalId: professionalProfile.id,
      collectPaymentAt: PaymentCollectionTiming.AFTER_SERVICE,
      acceptCash: true,
      acceptCardOnFile: true,
      acceptTapToPay: true,
      acceptVenmo: false,
      acceptZelle: false,
      acceptAppleCash: false,
      tipsEnabled: true,
      allowCustomTip: true,
    },
  })

  await prisma.lastMinuteSettings.upsert({
    where: { professionalId: professionalProfile.id },
    update: {
      enabled: true,
      minCollectedSubtotal: '50.00',
      defaultVisibilityMode: 'PUBLIC_AT_DISCOVERY',
      tier2NightBeforeMinutes: 1140,
      tier3DayOfMinutes: 540,
    },
    create: {
      professionalId: professionalProfile.id,
      enabled: true,
      minCollectedSubtotal: '50.00',
      defaultVisibilityMode: 'PUBLIC_AT_DISCOVERY',
      tier2NightBeforeMinutes: 1140,
      tier3DayOfMinutes: 540,
    },
  })

  const allClientEvents = [
    NotificationEventKey.BOOKING_REQUEST_CREATED,
    NotificationEventKey.BOOKING_CONFIRMED,
    NotificationEventKey.BOOKING_RESCHEDULED,
    NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
    NotificationEventKey.BOOKING_CANCELLED_BY_PRO,
    NotificationEventKey.BOOKING_CANCELLED_BY_ADMIN,
    NotificationEventKey.CONSULTATION_PROPOSAL_SENT,
    NotificationEventKey.CONSULTATION_APPROVED,
    NotificationEventKey.CONSULTATION_REJECTED,
    NotificationEventKey.REVIEW_RECEIVED,
    NotificationEventKey.APPOINTMENT_REMINDER,
    NotificationEventKey.AFTERCARE_READY,
    NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
    NotificationEventKey.PAYMENT_COLLECTED,
    NotificationEventKey.PAYMENT_ACTION_REQUIRED,
  ]

  for (const eventKey of allClientEvents) {
    await prisma.professionalNotificationPreference.upsert({
      where: {
        professionalId_eventKey: {
          professionalId: professionalProfile.id,
          eventKey,
        },
      },
      update: {},
      create: {
        professionalId: professionalProfile.id,
        eventKey,
        inAppEnabled: true,
        smsEnabled: false,
        emailEnabled: true,
      },
    })
  }

  console.log('\n✅ Test pro ready\n')
  console.log(`Login email: ${TEST_PRO_EMAIL}`)
  console.log(`Login password: ${TEST_PRO_PASSWORD}\n`)

  console.log('PowerShell env values:')
  console.log(`$env:LM_PROFESSIONAL_ID="${professionalProfile.id}"`)
  console.log(`$env:LM_SERVICE_ID="${service.id}"`)
  console.log(`$env:LM_OFFERING_ID="${offering.id}"`)
  console.log(`$env:LM_LOCATION_ID="${location.id}"`)
  console.log(`$env:LM_LOCATION_TYPE="SALON"`)
  console.log(`$env:LM_LOCATION_LAT="${location.lat.toString()}"`)
  console.log(`$env:LM_LOCATION_LNG="${location.lng.toString()}"`)
  console.log(`$env:LM_TIME_ZONE="${location.timeZone || 'America/Los_Angeles'}"\n`)

  console.log('Summary:')
  console.log({
    proUserId: user.id,
    professionalId: professionalProfile.id,
    serviceId: service.id,
    offeringId: offering.id,
    locationId: location.id,
    businessName: professionalProfile.businessName,
    handle: professionalProfile.handle,
    timeZone: professionalProfile.timeZone,
  })
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('❌ Failed to create test pro fixture')
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })