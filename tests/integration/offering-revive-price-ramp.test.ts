// tests/integration/offering-revive-price-ramp.test.ts
//
// Real-Postgres coverage for re-adding a service the pro previously removed.
//   node scripts/with-test-db.mjs npx vitest run \
//     tests/integration/offering-revive-price-ramp.test.ts \
//     --config vitest.integration.config.mts
//
// This one HAS to run against real Postgres. The whole subject is a soft-delete
// colliding with `@@unique([professionalId, serviceId])` — a constraint that
// lives in the database and nowhere else. The unit suites for these routes mock
// the Prisma client, so they assert that the code CALLS findUnique/update; they
// cannot see whether the unique slot is really occupied, whether the revive
// really lands on the same row, or whether the ramp rows are really gone.
//
// Two shipped behaviours are pinned here, both driven through the real route
// handlers rather than the helpers underneath them:
//
//   1. Removing a service only sets `isActive: false`. Adding it back used to
//      hit P2002 and tell the pro "you already added this service" about a row
//      invisible everywhere in the app. It must revive that row instead.
//
//   2. A revived offering must NOT inherit its old OfferingPriceRamp. A ramp
//      OUTRANKS the offering's own price at quote time — `effectiveUnitPrice`
//      returns the ramp's currentPrice/targetPrice and never reads listPrice —
//      so a surviving ramp keeps charging the price from the migration import
//      that created it while the pro looks at the new price they just typed.
//
// Both doors back on are covered, because only one of them goes through
// `writeOffering`: the add flow (POST) and PATCH `{isActive: true}`, whose
// lookup filters on id + professionalId with no isActive filter.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // lib/auth reads JWT_SECRET at module load, and the route module graph pulls
  // it in via lib/currentUser, so it must exist before the imports below.
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'

  // Adding a salon offering creates a placeholder ProfessionalLocation, and
  // that write goes through the address-privacy envelope — so the real route
  // needs a real keyring even though no address is supplied. The mocked unit
  // suites never reach this.
  const key32 = Buffer.alloc(32, 9).toString('base64')
  process.env.PII_LOOKUP_HMAC_KEYS_JSON ||= JSON.stringify({ 1: key32 })
  process.env.PII_AEAD_KEYS_JSON ||= JSON.stringify({ 'address-aead-v1': key32 })
})

const mockRequirePro = vi.hoisted(() => vi.fn())
const mockRefreshProfessional = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: mockRequirePro,
}))

// The search index is a network dependency and irrelevant to what is under test.
vi.mock('@/lib/search/index/refreshSearchIndex', () => ({
  refreshProfessional: mockRefreshProfessional,
}))

import {
  Prisma,
  PrismaClient,
  RaiseStepMode,
  Role,
  ServiceLocationType,
  VerificationStatus,
} from '@prisma/client'

import { POST } from '@/app/api/v1/pro/offerings/route'
import {
  DELETE as DELETE_ONE,
  PATCH as PATCH_ONE,
} from '@/app/api/v1/pro/offerings/[id]/route'
import { pickOfferingModeRamp, pickRampedUnitPrice } from '@/lib/booking/rampedUnitPrice'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `orv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// The catalog minimum. The ramp below sits UNDER it, which is the only way a
// ramp is ever created (migration import of a below-minimum legacy price).
const MIN_PRICE = '100.00'
const GRANDFATHERED = '60.00'
// What the pro types when they add the service back.
const NEW_PRICE = '195.00'

let professionalId = ''
let serviceId = ''

async function cleanup() {
  await db.offeringPriceRamp.deleteMany({
    where: { offering: { professional: { businessName: `${TAG} Studio` } } },
  })
  await db.professionalServiceOffering.deleteMany({
    where: { professional: { businessName: `${TAG} Studio` } },
  })
  await db.professionalProfile.deleteMany({
    where: { businessName: `${TAG} Studio` },
  })
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } })
  await db.service.deleteMany({ where: { name: `${TAG} Svc` } })
  await db.serviceCategory.deleteMany({ where: { slug: `${TAG}-category` } })
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const proUser = await db.user.create({
    data: { email: `${TAG}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })

  const professional = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenant.id,
      firstName: 'Ramp',
      lastName: 'Pro',
      businessName: `${TAG} Studio`,
      timeZone: 'America/Los_Angeles',
      verificationStatus: VerificationStatus.APPROVED,
    },
    select: { id: true },
  })
  professionalId = professional.id

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Category`, slug: `${TAG}-category`, isActive: true },
    select: { id: true },
  })

  const service = await db.service.create({
    data: {
      name: `${TAG} Svc`,
      categoryId: category.id,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal(MIN_PRICE),
      isActive: true,
    },
    select: { id: true },
  })
  serviceId = service.id
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

beforeEach(async () => {
  await db.offeringPriceRamp.deleteMany({
    where: { offering: { professionalId } },
  })
  await db.professionalServiceOffering.deleteMany({ where: { professionalId } })

  mockRequirePro.mockResolvedValue({
    ok: true,
    userId: `${TAG}_user`,
    professionalId,
  })
  mockRefreshProfessional.mockResolvedValue(undefined)
})

function addRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/v1/pro/offerings', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function patchRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/v1/pro/offerings/x', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) })

/** Add the service through the real endpoint the pro's "+ Add" button hits. */
async function addService(price: string) {
  return POST(
    addRequest({
      serviceId,
      offersInSalon: true,
      salonPriceStartingAt: price,
      salonDurationMinutes: 60,
    }),
  )
}

/** A below-minimum ramp, shaped exactly like the migration importer writes. */
async function seedRamp(offeringId: string) {
  return db.offeringPriceRamp.create({
    data: {
      offeringId,
      mode: ServiceLocationType.SALON,
      grandfatheredPrice: new Prisma.Decimal(GRANDFATHERED),
      targetPrice: new Prisma.Decimal(MIN_PRICE),
      currentPrice: new Prisma.Decimal(GRANDFATHERED),
      stepMode: RaiseStepMode.PCT,
      stepValue: new Prisma.Decimal('10.00'),
      cadenceWeeks: 4,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      nextStepAt: new Date('2026-12-01T00:00:00.000Z'),
    },
    select: { id: true },
  })
}

/**
 * What a booking would actually charge for this offering, resolved from the
 * rows currently in the database. Mirrors the quote path: read the offering's
 * ramps, pick the one for this mode, resolve against the catalog minimum.
 */
async function chargedPrice(offeringId: string, isExistingClient: boolean) {
  const offering = await db.professionalServiceOffering.findUniqueOrThrow({
    where: { id: offeringId },
    include: { priceRamps: true, service: true },
  })

  return pickRampedUnitPrice({
    listPrice: offering.salonPriceStartingAt ?? new Prisma.Decimal(0),
    minPrice: offering.service.minPrice ?? new Prisma.Decimal(0),
    ramp: pickOfferingModeRamp(offering.priceRamps, ServiceLocationType.SALON),
    isExistingClient,
  }).toFixed(2)
}

describe('re-adding a service the pro removed', () => {
  it('revives the soft-deleted row instead of 409ing on its unique slot', async () => {
    const created = await addService('150.00')
    expect(created.status).toBe(201)

    const original = await db.professionalServiceOffering.findFirstOrThrow({
      where: { professionalId, serviceId },
      select: { id: true },
    })

    const removed = await DELETE_ONE(
      new Request('http://localhost', { method: 'DELETE' }),
      ctxFor(original.id),
    )
    expect(removed.status).toBe(200)

    // Gone from the pro's view, but the row — and the unique slot — remain.
    const afterRemove = await db.professionalServiceOffering.findUniqueOrThrow({
      where: { professionalId_serviceId: { professionalId, serviceId } },
      select: { id: true, isActive: true },
    })
    expect(afterRemove).toEqual({ id: original.id, isActive: false })

    const readded = await addService(NEW_PRICE)
    expect(readded.status).toBe(201)

    const revived = await db.professionalServiceOffering.findUniqueOrThrow({
      where: { professionalId_serviceId: { professionalId, serviceId } },
      select: { id: true, isActive: true, salonPriceStartingAt: true },
    })

    // The SAME row came back on, carrying the new price.
    expect(revived.id).toBe(original.id)
    expect(revived.isActive).toBe(true)
    expect(revived.salonPriceStartingAt?.toFixed(2)).toBe(NEW_PRICE)

    // Still exactly one row in the unique slot.
    expect(
      await db.professionalServiceOffering.count({
        where: { professionalId, serviceId },
      }),
    ).toBe(1)
  })

  it('still refuses a service that is genuinely live on the menu', async () => {
    expect((await addService('150.00')).status).toBe(201)

    const duplicate = await addService('150.00')
    expect(duplicate.status).toBe(409)

    expect(
      await db.professionalServiceOffering.count({
        where: { professionalId, serviceId },
      }),
    ).toBe(1)
  })
})

describe('a revived offering and its old price ramp', () => {
  it('charges the ramp price while the ramp exists — the bug being prevented', async () => {
    expect((await addService('150.00')).status).toBe(201)

    const offering = await db.professionalServiceOffering.findFirstOrThrow({
      where: { professionalId, serviceId },
      select: { id: true },
    })
    await seedRamp(offering.id)

    // With a ramp attached, the offering's own price is not what gets charged.
    expect(await chargedPrice(offering.id, true)).toBe(GRANDFATHERED)
    expect(await chargedPrice(offering.id, false)).toBe(MIN_PRICE)
  })

  it('drops the ramp when the add flow revives it, so the new price governs', async () => {
    expect((await addService('150.00')).status).toBe(201)

    const offering = await db.professionalServiceOffering.findFirstOrThrow({
      where: { professionalId, serviceId },
      select: { id: true },
    })
    await seedRamp(offering.id)

    await DELETE_ONE(
      new Request('http://localhost', { method: 'DELETE' }),
      ctxFor(offering.id),
    )

    // The ramp outlives the removal — that is what made this reachable at all.
    expect(
      await db.offeringPriceRamp.count({ where: { offeringId: offering.id } }),
    ).toBe(1)

    expect((await addService(NEW_PRICE)).status).toBe(201)

    expect(
      await db.offeringPriceRamp.count({ where: { offeringId: offering.id } }),
    ).toBe(0)

    // Both client types now pay the price the pro actually typed.
    expect(await chargedPrice(offering.id, true)).toBe(NEW_PRICE)
    expect(await chargedPrice(offering.id, false)).toBe(NEW_PRICE)
  })

  it('drops the ramp when PATCH revives it, the door that skips writeOffering', async () => {
    expect((await addService('150.00')).status).toBe(201)

    const offering = await db.professionalServiceOffering.findFirstOrThrow({
      where: { professionalId, serviceId },
      select: { id: true },
    })
    await seedRamp(offering.id)

    await DELETE_ONE(
      new Request('http://localhost', { method: 'DELETE' }),
      ctxFor(offering.id),
    )

    const revived = await PATCH_ONE(
      patchRequest({ isActive: true }),
      ctxFor(offering.id),
    )
    expect(revived.status).toBe(200)

    expect(
      await db.professionalServiceOffering.findUniqueOrThrow({
        where: { id: offering.id },
        select: { isActive: true },
      }),
    ).toEqual({ isActive: true })

    expect(
      await db.offeringPriceRamp.count({ where: { offeringId: offering.id } }),
    ).toBe(0)
  })

  it('leaves the ramp alone when PATCH edits an offering that is already live', async () => {
    expect((await addService('150.00')).status).toBe(201)

    const offering = await db.professionalServiceOffering.findFirstOrThrow({
      where: { professionalId, serviceId },
      select: { id: true },
    })
    await seedRamp(offering.id)

    const edited = await PATCH_ONE(
      patchRequest({ isActive: true, description: 'Still on the menu' }),
      ctxFor(offering.id),
    )
    expect(edited.status).toBe(200)

    // No revive happened, so the grandfathered price survives untouched.
    expect(
      await db.offeringPriceRamp.count({ where: { offeringId: offering.id } }),
    ).toBe(1)
    expect(await chargedPrice(offering.id, true)).toBe(GRANDFATHERED)
  })
})
