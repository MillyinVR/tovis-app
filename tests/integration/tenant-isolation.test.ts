// tests/integration/tenant-isolation.test.ts
//
// Database-level tenant isolation matrix (docs/architecture/tenant-model.md).
// Runs against the docker test database like booking-overlap-concurrency:
//   pnpm test:integration
//
// Matrix:
// - white-label context sees only own-tenant Pros / bookings / NFC cards
// - tovis-root context sees everything
// (Contract phase: tenant columns are NOT NULL, so the expand-phase
// "un-backfilled NULL row" dimension no longer exists.)

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  NfcCardType,
  PrismaClient,
  Prisma,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
} from '@prisma/client'

import {
  rootTenantContext,
  whiteLabelTenantContext,
  type TenantContext,
} from '@/lib/tenant/context'
import {
  bookingTenantVisibilityFilter,
  nfcCardTenantVisibilityFilter,
  proDiscoveryVisibilityFilter,
} from '@/lib/tenant/visibility'
import { consumeTapIntent } from '@/lib/tapIntentConsume'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Missing DATABASE_URL. Run this test with: pnpm test:integration',
  )
}

const db = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
})

const tag = `tenant_isolation_${Date.now()}_${Math.random()
  .toString(36)
  .slice(2, 8)}`

type SeededPro = {
  professionalId: string
  locationId: string
}

let rootCtx: TenantContext
let salonACtx: TenantContext
let salonBCtx: TenantContext

let rootPro: SeededPro
let salonAPro: SeededPro
let salonBPro: SeededPro

const seededProIds: string[] = []
const seededBookingIds: string[] = []
const seededCardIds: string[] = []

function workingHoursJson(): Prisma.InputJsonValue {
  return {
    mon: { enabled: true, start: '09:00', end: '18:00' },
    tue: { enabled: true, start: '09:00', end: '18:00' },
    wed: { enabled: true, start: '09:00', end: '18:00' },
    thu: { enabled: true, start: '09:00', end: '18:00' },
    fri: { enabled: true, start: '09:00', end: '18:00' },
    sat: { enabled: true, start: '09:00', end: '18:00' },
    sun: { enabled: true, start: '09:00', end: '18:00' },
  }
}

async function seedTenant(slug: string, name: string): Promise<string> {
  const tenant = await db.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name, isActive: true },
    select: { id: true },
  })
  return tenant.id
}

async function seedPro(args: {
  label: string
  homeTenantId: string
}): Promise<SeededPro> {
  const user = await db.user.create({
    data: {
      email: `${tag}_${args.label}@example.com`,
      password: 'test-password',
      role: Role.PRO,
    },
    select: { id: true },
  })

  const pro = await db.professionalProfile.create({
    data: {
      userId: user.id,
      firstName: args.label,
      lastName: 'Isolation',
      businessName: `${args.label} studio`,
      homeTenantId: args.homeTenantId,
    },
    select: { id: true },
  })

  const location = await db.professionalLocation.create({
    data: {
      professionalId: pro.id,
      type: ProfessionalLocationType.SALON,
      name: `${args.label} salon`,
      isPrimary: true,
      isBookable: true,
      workingHours: workingHoursJson(),
    },
    select: { id: true },
  })

  seededProIds.push(pro.id)
  return { professionalId: pro.id, locationId: location.id }
}

beforeAll(async () => {
  const rootTenantId = await seedTenant('tovis-root', 'TOVIS')
  const salonATenantId = await seedTenant(`${tag}-salon-a`, 'Salon A')
  const salonBTenantId = await seedTenant(`${tag}-salon-b`, 'Salon B')

  rootCtx = rootTenantContext(rootTenantId)
  salonACtx = whiteLabelTenantContext({
    tenantId: salonATenantId,
    slug: `${tag}-salon-a`,
  })
  salonBCtx = whiteLabelTenantContext({
    tenantId: salonBTenantId,
    slug: `${tag}-salon-b`,
  })

  rootPro = await seedPro({ label: 'root_pro', homeTenantId: rootTenantId })
  salonAPro = await seedPro({ label: 'salon_a_pro', homeTenantId: salonATenantId })
  salonBPro = await seedPro({ label: 'salon_b_pro', homeTenantId: salonBTenantId })

  // One client + one booking per pro tenant, with tenant snapshots set the
  // way the booking write boundary will write them after the contract phase.
  const clientUser = await db.user.create({
    data: {
      email: `${tag}_client@example.com`,
      password: 'test-password',
      role: Role.CLIENT,
    },
    select: { id: true },
  })

  const client = await db.clientProfile.create({
    data: {
      userId: clientUser.id,
      firstName: 'Iso',
      lastName: 'Client',
      homeTenantId: rootTenantId,
    },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${tag} category`, slug: `${tag}-category`, isActive: true },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${tag} service`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('50.00'),
      isActive: true,
    },
    select: { id: true },
  })

  const bookingSpecs: Array<{
    pro: SeededPro
    proTenantId: string
    hourOffset: number
  }> = [
    { pro: salonAPro, proTenantId: salonATenantId, hourOffset: 10 },
    { pro: salonBPro, proTenantId: salonBTenantId, hourOffset: 11 },
    { pro: rootPro, proTenantId: rootTenantId, hourOffset: 12 },
  ]

  for (const spec of bookingSpecs) {
    const scheduledFor = new Date()
    scheduledFor.setUTCDate(scheduledFor.getUTCDate() + 30)
    scheduledFor.setUTCHours(spec.hourOffset, 0, 0, 0)

    const booking = await db.booking.create({
      data: {
        clientId: client.id,
        professionalId: spec.pro.professionalId,
        serviceId: service.id,
        scheduledFor,
        locationType: ServiceLocationType.SALON,
        locationId: spec.pro.locationId,
        subtotalSnapshot: new Prisma.Decimal('50.00'),
        totalDurationMinutes: 60,
        proTenantId: spec.proTenantId,
        clientHomeTenantId: rootTenantId,
      },
      select: { id: true },
    })
    seededBookingIds.push(booking.id)
  }

  const cardSpecs: Array<{ tenantId: string; code: string }> = [
    { tenantId: salonATenantId, code: `${tag}A` },
    { tenantId: salonBTenantId, code: `${tag}B` },
  ]

  for (const spec of cardSpecs) {
    const card = await db.nfcCard.create({
      data: {
        type: NfcCardType.SALON_WHITE_LABEL,
        shortCode: spec.code.slice(-24).toUpperCase(),
        tenantId: spec.tenantId,
      },
      select: { id: true },
    })
    seededCardIds.push(card.id)
  }
}, 60_000)

afterAll(async () => {
  await db.nfcCard.deleteMany({ where: { id: { in: seededCardIds } } })
  await db.booking.deleteMany({ where: { id: { in: seededBookingIds } } })
  await db.professionalLocation.deleteMany({
    where: { professionalId: { in: seededProIds } },
  })
  await db.professionalProfile.deleteMany({
    where: { id: { in: seededProIds } },
  })
  await db.clientProfile.deleteMany({
    where: { firstName: 'Iso', lastName: 'Client' },
  })
  await db.user.deleteMany({ where: { email: { startsWith: tag } } })
  await db.service.deleteMany({ where: { name: `${tag} service` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${tag}-category` } })
  await db.tenant.deleteMany({ where: { slug: { startsWith: `${tag}-` } } })
  await db.$disconnect()
}, 60_000)

function seededOnly<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  return rows.filter((row) => ids.includes(row.id))
}

describe('pro discovery isolation', () => {
  async function visiblePros(ctx: TenantContext): Promise<string[]> {
    const rows = await db.professionalProfile.findMany({
      where: {
        AND: [{ id: { in: seededProIds } }, proDiscoveryVisibilityFilter(ctx)],
      },
      select: { id: true },
    })
    return rows.map((row) => row.id)
  }

  it('white-label tenant A sees only its own pros', async () => {
    const ids = await visiblePros(salonACtx)

    expect(ids).toEqual([salonAPro.professionalId])
  })

  it('white-label tenant B cannot see tenant A pros', async () => {
    const ids = await visiblePros(salonBCtx)

    expect(ids).toContain(salonBPro.professionalId)
    expect(ids).not.toContain(salonAPro.professionalId)
    expect(ids).not.toContain(rootPro.professionalId)
  })

  it('tovis-root sees pros from every tenant', async () => {
    const ids = await visiblePros(rootCtx)

    expect(ids).toEqual(
      expect.arrayContaining([
        rootPro.professionalId,
        salonAPro.professionalId,
        salonBPro.professionalId,
      ]),
    )
  })

})

describe('booking tenant isolation', () => {
  async function visibleBookings(ctx: TenantContext): Promise<string[]> {
    const rows = await db.booking.findMany({
      where: {
        AND: [
          { id: { in: seededBookingIds } },
          bookingTenantVisibilityFilter(ctx),
        ],
      },
      select: { id: true, professionalId: true },
    })
    return rows.map((row) => row.professionalId)
  }

  it('tenant A sees only bookings attributed to its pros', async () => {
    const proIds = await visibleBookings(salonACtx)

    expect(proIds).toEqual([salonAPro.professionalId])
  })

  it('tenant A cannot see tenant B bookings', async () => {
    const proIds = await visibleBookings(salonACtx)

    expect(proIds).not.toContain(salonBPro.professionalId)
  })

  it('root sees bookings from every tenant', async () => {
    const proIds = await visibleBookings(rootCtx)

    expect(proIds).toEqual(
      expect.arrayContaining([
        salonAPro.professionalId,
        salonBPro.professionalId,
        rootPro.professionalId,
      ]),
    )
  })
})

describe('nfc card tenant isolation', () => {
  async function visibleCards(ctx: TenantContext): Promise<string[]> {
    const rows = await db.nfcCard.findMany({
      where: {
        AND: [{ id: { in: seededCardIds } }, nfcCardTenantVisibilityFilter(ctx)],
      },
      select: { id: true },
    })
    return seededOnly(rows, seededCardIds).map((row) => row.id)
  }

  it('tenant A sees only its own cards', async () => {
    const ids = await visibleCards(salonACtx)

    expect(ids).toEqual([seededCardIds[0]])
  })

  it('root sees all cards', async () => {
    const ids = await visibleCards(rootCtx)

    expect(ids).toEqual(expect.arrayContaining(seededCardIds))
  })
})

// NFC CLAIM (write path) — distinct from the read/visibility filter above.
// consumeTapIntent (lib/tapIntentConsume.ts) scopes the claim by tenant
// (Option A — docs/launch-readiness/tenant-isolation-audit.md): a white-label
// card is only claimable within its issuing tenant; root cards stay open.
describe('nfc claim tenant isolation', () => {
  // Seed a Pro (home tenant = claimerHomeTenantId) + an unclaimed card
  // (issuing tenant = cardTenantId), run the claim, and return the reloaded
  // card + logged attribution events with a cleanup handle.
  async function attemptProClaim(args: {
    label: string
    claimerHomeTenantId: string
    cardTenantId: string
    cardType?: NfcCardType
  }) {
    const proUser = await db.user.create({
      data: {
        email: `${tag}_${args.label}@example.com`,
        password: 'test-password',
        role: Role.PRO,
      },
      select: { id: true },
    })
    const proProfile = await db.professionalProfile.create({
      data: {
        userId: proUser.id,
        firstName: args.label,
        lastName: 'Claimer',
        businessName: `${args.label} studio`,
        homeTenantId: args.claimerHomeTenantId,
      },
      select: { id: true },
    })
    const card = await db.nfcCard.create({
      data: {
        type: args.cardType ?? NfcCardType.SALON_WHITE_LABEL,
        shortCode: `${tag}${args.label}`.slice(-24).toUpperCase(),
        tenantId: args.cardTenantId,
      },
      select: { id: true },
    })
    const expiresAt = new Date()
    expiresAt.setUTCHours(expiresAt.getUTCHours() + 1)
    const tapIntent = await db.tapIntent.create({
      data: { cardId: card.id, intentType: 'SIGNUP_PRO', expiresAt },
      select: { id: true },
    })

    const result = await consumeTapIntent({
      tapIntentId: tapIntent.id,
      userId: proUser.id,
    })

    const reloaded = await db.nfcCard.findUnique({
      where: { id: card.id },
      select: { claimedByUserId: true, professionalId: true, type: true },
    })
    const events = await db.attributionEvent.findMany({
      where: { cardId: card.id },
      select: { eventType: true },
    })

    async function cleanup() {
      await db.attributionEvent.deleteMany({ where: { cardId: card.id } })
      await db.tapIntent.deleteMany({ where: { cardId: card.id } })
      await db.nfcCard.delete({ where: { id: card.id } })
      await db.professionalProfile.delete({ where: { id: proProfile.id } })
      await db.user.delete({ where: { id: proUser.id } })
    }

    return {
      result,
      reloaded,
      events: events.map((e) => e.eventType),
      proUserId: proUser.id,
      proProfileId: proProfile.id,
      cleanup,
    }
  }

  it('white-label card is NOT claimable by a Pro outside its tenant', async () => {
    const { result, reloaded, events, cleanup } = await attemptProClaim({
      label: 'nfc_outside',
      claimerHomeTenantId: salonACtx.tenantId,
      cardTenantId: salonBCtx.tenantId, // issued by a DIFFERENT tenant
    })
    try {
      expect(result.ok).toBe(true) // graceful, does not brick signup
      expect(reloaded?.claimedByUserId).toBeNull()
      expect(reloaded?.professionalId).toBeNull()
      expect(reloaded?.type).toBe(NfcCardType.SALON_WHITE_LABEL)
      expect(events).toContain('NFC_CLAIM_TENANT_MISMATCH')
    } finally {
      await cleanup()
    }
  })

  it('white-label card IS claimable by a Pro in its own tenant', async () => {
    const { reloaded, proUserId, proProfileId, cleanup } =
      await attemptProClaim({
        label: 'nfc_inside',
        claimerHomeTenantId: salonBCtx.tenantId,
        cardTenantId: salonBCtx.tenantId,
      })
    try {
      expect(reloaded?.claimedByUserId).toBe(proUserId)
      expect(reloaded?.professionalId).toBe(proProfileId)
      expect(reloaded?.type).toBe(NfcCardType.PRO_BOOKING)
    } finally {
      await cleanup()
    }
  })

  it('root card stays open: claimable by a Pro from any tenant', async () => {
    const { reloaded, proUserId, cleanup } = await attemptProClaim({
      label: 'nfc_root',
      claimerHomeTenantId: salonACtx.tenantId,
      cardTenantId: rootCtx.tenantId,
      cardType: NfcCardType.UNASSIGNED,
    })
    try {
      expect(reloaded?.claimedByUserId).toBe(proUserId)
      expect(reloaded?.type).toBe(NfcCardType.PRO_BOOKING)
    } finally {
      await cleanup()
    }
  })
})
