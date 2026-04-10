// prisma/test-data/createTestOpening.cjs
const path = require('path')
const dotenv = require('dotenv')

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') })
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

const {
  PrismaClient,
  LastMinuteOfferType,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  OpeningStatus,
} = require('@prisma/client')

const prisma = new PrismaClient()

function requireEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value.trim()
}

function optionalEnv(name) {
  const value = process.env[name]
  if (!value || !value.trim()) return null
  return value.trim()
}

function parseDateEnv(name) {
  const raw = optionalEnv(name)
  if (!raw) return null
  const date = new Date(raw)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid date env var: ${name}`)
  }
  return date
}

function parseIntegerEnv(name, fallback) {
  const raw = optionalEnv(name)
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer env var: ${name}`)
  }
  return parsed
}

function minutesFrom(base, minutes) {
  return new Date(base.getTime() + minutes * 60 * 1000)
}

function buildOfferConfigForTier(tier) {
  if (tier === LastMinuteTier.WAITLIST) {
    return {
      offerType: LastMinuteOfferType.NONE,
      percentOff: null,
      amountOff: null,
      freeAddOnServiceId: null,
    }
  }

  if (tier === LastMinuteTier.REACTIVATION) {
    return {
      offerType: LastMinuteOfferType.PERCENT_OFF,
      percentOff: 15,
      amountOff: null,
      freeAddOnServiceId: null,
    }
  }

  return {
    offerType: LastMinuteOfferType.AMOUNT_OFF,
    percentOff: null,
    amountOff: '20.00',
    freeAddOnServiceId: null,
  }
}

async function main() {
  const professionalId = requireEnv('LM_PROFESSIONAL_ID')
  const serviceId = requireEnv('LM_SERVICE_ID')
  const offeringId = requireEnv('LM_OFFERING_ID')
  const locationId = requireEnv('LM_LOCATION_ID')
  const locationType = requireEnv('LM_LOCATION_TYPE')
  const timeZone = requireEnv('LM_TIME_ZONE')

  const explicitStartAt = parseDateEnv('LM_TEST_OPENING_START_AT')
  const explicitEndAt = parseDateEnv('LM_TEST_OPENING_END_AT')

  const startDelayMinutes = parseIntegerEnv('LM_TEST_OPENING_START_DELAY_MINUTES', 180)
  const durationMinutes = parseIntegerEnv('LM_TEST_OPENING_DURATION_MINUTES', 60)

  const now = new Date()

  const startAt = explicitStartAt ?? minutesFrom(now, startDelayMinutes)
  const endAt = explicitEndAt ?? minutesFrom(startAt, durationMinutes)

  if (endAt <= startAt) {
    throw new Error('Opening endAt must be after startAt')
  }

  const visibilityMode = LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY

  // Testing modes:
  // 1) default: stagger tiers in the near future so you can run them one by one
  // 2) if LM_TEST_ALL_TIERS_DUE_NOW=true, all tiers become due immediately
  const allTiersDueNow = optionalEnv('LM_TEST_ALL_TIERS_DUE_NOW') === 'true'

  const waitlistOffsetMinutes = parseIntegerEnv('LM_WAITLIST_OFFSET_MINUTES', allTiersDueNow ? -1 : -1)
  const reactivationOffsetMinutes = parseIntegerEnv('LM_REACTIVATION_OFFSET_MINUTES', allTiersDueNow ? -1 : 2)
  const discoveryOffsetMinutes = parseIntegerEnv('LM_DISCOVERY_OFFSET_MINUTES', allTiersDueNow ? -1 : 4)

  const waitlistScheduledFor = minutesFrom(now, waitlistOffsetMinutes)
  const reactivationScheduledFor = minutesFrom(now, reactivationOffsetMinutes)
  const discoveryScheduledFor = minutesFrom(now, discoveryOffsetMinutes)

  const publicVisibleFrom = discoveryScheduledFor
  const publicVisibleUntil = endAt

  const opening = await prisma.lastMinuteOpening.create({
    data: {
      professionalId,
      locationId,
      locationType,
      timeZone,
      startAt,
      endAt,
      status: OpeningStatus.ACTIVE,
      visibilityMode,
      launchAt: now,
      expiresAt: endAt,
      publicVisibleFrom,
      publicVisibleUntil,
      note: 'Seeded test opening for last-minute pipeline verification',
      services: {
        create: [
          {
            serviceId,
            offeringId,
            sortOrder: 0,
          },
        ],
      },
      tierPlans: {
        create: [
          {
            tier: LastMinuteTier.WAITLIST,
            scheduledFor: waitlistScheduledFor,
            ...buildOfferConfigForTier(LastMinuteTier.WAITLIST),
          },
          {
            tier: LastMinuteTier.REACTIVATION,
            scheduledFor: reactivationScheduledFor,
            ...buildOfferConfigForTier(LastMinuteTier.REACTIVATION),
          },
          {
            tier: LastMinuteTier.DISCOVERY,
            scheduledFor: discoveryScheduledFor,
            ...buildOfferConfigForTier(LastMinuteTier.DISCOVERY),
          },
        ],
      },
    },
    select: {
      id: true,
      professionalId: true,
      locationId: true,
      locationType: true,
      timeZone: true,
      startAt: true,
      endAt: true,
      status: true,
      visibilityMode: true,
      publicVisibleFrom: true,
      publicVisibleUntil: true,
      services: {
        select: {
          id: true,
          serviceId: true,
          offeringId: true,
        },
      },
      tierPlans: {
        orderBy: { scheduledFor: 'asc' },
        select: {
          id: true,
          tier: true,
          scheduledFor: true,
          offerType: true,
          percentOff: true,
          amountOff: true,
          processedAt: true,
          cancelledAt: true,
          lastError: true,
        },
      },
    },
  })

  console.log('\n✅ Created test opening\n')
  console.log({
    openingId: opening.id,
    professionalId: opening.professionalId,
    locationId: opening.locationId,
    locationType: opening.locationType,
    timeZone: opening.timeZone,
    startAt: opening.startAt.toISOString(),
    endAt: opening.endAt ? opening.endAt.toISOString() : null,
    status: opening.status,
    visibilityMode: opening.visibilityMode,
    publicVisibleFrom: opening.publicVisibleFrom
      ? opening.publicVisibleFrom.toISOString()
      : null,
    publicVisibleUntil: opening.publicVisibleUntil
      ? opening.publicVisibleUntil.toISOString()
      : null,
  })

  console.log('\nService link:')
  for (const serviceRow of opening.services) {
    console.log({
      openingServiceId: serviceRow.id,
      serviceId: serviceRow.serviceId,
      offeringId: serviceRow.offeringId,
    })
  }

  console.log('\nTier plans:')
  for (const plan of opening.tierPlans) {
    console.log({
      tierPlanId: plan.id,
      tier: plan.tier,
      scheduledFor: plan.scheduledFor.toISOString(),
      offerType: plan.offerType,
      percentOff: plan.percentOff,
      amountOff: plan.amountOff ? plan.amountOff.toString() : null,
      processedAt: plan.processedAt,
      cancelledAt: plan.cancelledAt,
      lastError: plan.lastError,
    })
  }

  console.log('\nPowerShell helper:')
  console.log(`$env:LM_OPENING_ID="${opening.id}"`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('❌ Failed to create test opening')
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })