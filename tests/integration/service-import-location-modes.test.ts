// tests/integration/service-import-location-modes.test.ts
//
// W6 for the CSV service-menu import, against a REAL Postgres.
//
// The import endpoints had NO capability derivation at all: an absent mode flag
// parsed as `false`, so both clients hardcoded `offersInSalon: true` /
// `offersMobile: false` rather than trip the NO_MODE refusal — and a mobile-only
// pro's whole imported menu was written salon-only, advertising an in-salon
// booking they cannot host.
//
// Driven through the real routes rather than the lib, because the defect lives
// in the interaction between the commit route's parser (absent vs stated
// `false`), `loadProLocationCapability`'s `isBookable: true` query over real
// ProfessionalLocation rows, and what `writeOffering` actually PERSISTS per mode.
// A mocked Prisma client proves none of that: it cannot show that the
// "Set salon address" placeholder writeOffering creates is invisible to the
// capability query, and it cannot show that the derived mode is the one whose
// price column ends up populated.
//
// Run with: pnpm test:integration
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
} from '@prisma/client'

import { isRecord } from '@/lib/guards'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL. Run with: pnpm test:integration')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const TAG = `svc_import_modes_${Date.now()}`
const ZONE = 'America/Los_Angeles'
/** Comfortably above the catalog minimum, so nothing here is a price ramp. */
const MENU_PRICE = 140
const MIN_PRICE = '100.00'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'service-import-modes-secret-not-for-signing'
  // Both endpoints 404 while the migration flow is gated off.
  process.env.ENABLE_PRO_MIGRATION = '1'
})

// Who the routes see. Mocked at the LEAF module, the way both migrate routes
// import it.
const authState = vi.hoisted(() => ({ professionalId: null as string | null }))

vi.mock('@/app/api/_utils/auth/requirePro', () => ({
  requirePro: async () => ({
    ok: true,
    user: null,
    userId: null,
    professionalId: authState.professionalId,
    proId: authState.professionalId,
  }),
}))

const { POST: previewPOST } = await import(
  '@/app/api/v1/pro/migrate/services/preview/route'
)
const { POST: commitPOST } = await import(
  '@/app/api/v1/pro/migrate/services/commit/route'
)

type Fixtures = {
  tenantId: string
  categoryId: string
  serviceId: string
  serviceName: string
  /** One bookable MOBILE_BASE and nothing else — the pro this bug is about. */
  mobileOnlyProId: string
  mobileOnlyUserId: string
  /** One bookable SALON — must behave exactly as it did before. */
  salonProId: string
  salonUserId: string
  /** No bookable location at all — the legacy salon fallback. */
  locationlessProId: string
  locationlessUserId: string
}

let fx: Fixtures

function workingHours(): Prisma.InputJsonValue {
  const all = { enabled: true, start: '00:00', end: '23:59' }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Run the preview route as `professionalId`. */
async function preview(professionalId: string): Promise<Record<string, unknown>> {
  authState.professionalId = professionalId
  const res = await previewPOST(
    jsonRequest('https://tovis.test/api/v1/pro/migrate/services/preview', {
      rows: [{ name: fx.serviceName, price: MENU_PRICE, durationMinutes: 90 }],
    }),
  )
  const payload: unknown = await res.json()
  expect(res.status).toBe(200)
  if (!isRecord(payload)) throw new Error('preview payload was not an object')
  return payload
}

/**
 * Commit one decision the way the fixed clients send it: NEITHER mode stated,
 * and the CSV's single price/duration carried for BOTH modes so whichever the
 * server derives is the one it can store a price for.
 */
async function commitUnstated(professionalId: string): Promise<Record<string, unknown>> {
  authState.professionalId = professionalId
  const res = await commitPOST(
    jsonRequest('https://tovis.test/api/v1/pro/migrate/services/commit', {
      decisions: [
        {
          serviceId: fx.serviceId,
          salonPrice: MENU_PRICE,
          salonDurationMinutes: 90,
          mobilePrice: MENU_PRICE,
          mobileDurationMinutes: 90,
          ramp: { stepMode: 'PCT', stepValue: 10, cadenceWeeks: 10 },
        },
      ],
    }),
  )
  const payload: unknown = await res.json()
  expect(res.status).toBe(200)
  if (!isRecord(payload)) throw new Error('commit payload was not an object')
  return payload
}

/** What the import ACTUALLY persisted for this pro. */
async function persistedOffering(professionalId: string) {
  const row = await db.professionalServiceOffering.findFirst({
    where: { professionalId, serviceId: fx.serviceId },
    select: {
      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: true,
      mobilePriceStartingAt: true,
      salonDurationMinutes: true,
      mobileDurationMinutes: true,
    },
  })
  if (!row) throw new Error('no offering was written')
  return {
    offersInSalon: row.offersInSalon,
    offersMobile: row.offersMobile,
    salonPrice: row.salonPriceStartingAt === null ? null : Number(row.salonPriceStartingAt),
    mobilePrice: row.mobilePriceStartingAt === null ? null : Number(row.mobilePriceStartingAt),
    salonDurationMinutes: row.salonDurationMinutes,
    mobileDurationMinutes: row.mobileDurationMinutes,
  }
}

async function makePro(
  slug: string,
  first: string,
): Promise<{ userId: string; professionalId: string }> {
  const user = await db.user.create({
    data: { email: `${TAG}_${slug}@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  const pro = await db.professionalProfile.create({
    data: {
      userId: user.id,
      homeTenantId: fx.tenantId,
      firstName: first,
      lastName: 'Import',
      businessName: `${first} Studio`,
      timeZone: ZONE,
    },
    select: { id: true },
  })
  return { userId: user.id, professionalId: pro.id }
}

async function makeLocation(
  professionalId: string,
  type: ProfessionalLocationType,
): Promise<void> {
  await db.professionalLocation.create({
    data: {
      professionalId,
      type,
      name: `${type} base`,
      isPrimary: true,
      // The whole capability test. A placeholder location is written
      // isBookable:false and must NOT read as a mode the pro can host.
      isBookable: true,
      countryCode: 'US',
      timeZone: ZONE,
      workingHours: workingHours(),
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 365,
    },
    select: { id: true },
  })
}

beforeAll(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'tovis-root' },
    update: {},
    create: { slug: 'tovis-root', name: 'TOVIS', isActive: true },
    select: { id: true },
  })

  const category = await db.serviceCategory.create({
    data: { name: `${TAG} Cat`, slug: `${TAG}-cat`, isActive: true },
    select: { id: true },
  })

  const serviceName = `${TAG} Silk Press`
  const service = await db.service.create({
    data: {
      name: serviceName,
      categoryId: category.id,
      defaultDurationMinutes: 90,
      minPrice: new Prisma.Decimal(MIN_PRICE),
      isActive: true,
      allowMobile: true,
    },
    select: { id: true },
  })

  fx = {
    tenantId: tenant.id,
    categoryId: category.id,
    serviceId: service.id,
    serviceName,
    mobileOnlyProId: '',
    mobileOnlyUserId: '',
    salonProId: '',
    salonUserId: '',
    locationlessProId: '',
    locationlessUserId: '',
  }

  const mobileOnly = await makePro('mobile', 'Mobile')
  fx.mobileOnlyProId = mobileOnly.professionalId
  fx.mobileOnlyUserId = mobileOnly.userId
  await makeLocation(mobileOnly.professionalId, ProfessionalLocationType.MOBILE_BASE)

  const salon = await makePro('salon', 'Salon')
  fx.salonProId = salon.professionalId
  fx.salonUserId = salon.userId
  await makeLocation(salon.professionalId, ProfessionalLocationType.SALON)

  const nowhere = await makePro('nowhere', 'Nowhere')
  fx.locationlessProId = nowhere.professionalId
  fx.locationlessUserId = nowhere.userId
}, 60_000)

afterAll(async () => {
  const proIds = [fx.mobileOnlyProId, fx.salonProId, fx.locationlessProId].filter(Boolean)
  const userIds = [fx.mobileOnlyUserId, fx.salonUserId, fx.locationlessUserId].filter(Boolean)
  const pro = { professionalId: { in: proIds } }

  await db.offeringPriceRamp.deleteMany({
    where: { offering: { professionalId: { in: proIds } } },
  })
  await db.professionalServiceOffering.deleteMany({ where: pro })
  await db.professionalSearchIndex.deleteMany({ where: pro })
  await db.professionalLocation.deleteMany({ where: pro })
  await db.professionalPaymentSettings.deleteMany({ where: pro })
  await db.service.deleteMany({ where: { id: fx.serviceId } })
  await db.serviceCategory.deleteMany({ where: { id: fx.categoryId } })
  await db.professionalProfile.deleteMany({ where: { id: { in: proIds } } })
  await db.user.deleteMany({ where: { id: { in: userIds } } })
  await db.$disconnect()
})

describe('service-import preview seeds the modes it will derive', () => {
  it('reports a MOBILE-ONLY pro as mobile-capable, mobile-default', async () => {
    const payload = await preview(fx.mobileOnlyProId)

    expect(payload.locationCapability).toEqual({ salon: false, mobile: true })
    expect(payload.defaultOfferingModes).toEqual({
      offersInSalon: false,
      offersMobile: true,
    })
  })

  it('reports a SALON pro as salon-default (what both clients hardcoded)', async () => {
    const payload = await preview(fx.salonProId)

    expect(payload.locationCapability).toEqual({ salon: true, mobile: false })
    expect(payload.defaultOfferingModes).toEqual({
      offersInSalon: true,
      offersMobile: false,
    })
  })
})

describe('service-import commit derives the modes it was not told', () => {
  it("writes a MOBILE-ONLY pro's menu as mobile, priced, and never as NO_MODE", async () => {
    const payload = await commitUnstated(fx.mobileOnlyProId)

    expect(payload.summary).toMatchObject({ created: 1, skipped: 0 })

    // The defect, stated as data: before the fix this row read
    // offersInSalon:true / offersMobile:false with the price in the SALON
    // column, for a pro who cannot host a single in-salon appointment.
    expect(await persistedOffering(fx.mobileOnlyProId)).toEqual({
      offersInSalon: false,
      offersMobile: true,
      salonPrice: null,
      mobilePrice: MENU_PRICE,
      salonDurationMinutes: null,
      mobileDurationMinutes: 90,
    })
  })

  it('leaves a SALON pro exactly where it was (regression guard)', async () => {
    const payload = await commitUnstated(fx.salonProId)

    expect(payload.summary).toMatchObject({ created: 1, skipped: 0 })
    expect(await persistedOffering(fx.salonProId)).toEqual({
      offersInSalon: true,
      offersMobile: false,
      salonPrice: MENU_PRICE,
      mobilePrice: null,
      salonDurationMinutes: 90,
      mobileDurationMinutes: null,
    })
  })

  it('falls back to salon for a pro with NO bookable location', async () => {
    const payload = await commitUnstated(fx.locationlessProId)

    // Never a refusal: `defaultOfferingModes` never yields neither mode, and the
    // read boundary takes an unhostable mode back off before a client sees it.
    expect(payload.summary).toMatchObject({ created: 1, skipped: 0 })
    expect(await persistedOffering(fx.locationlessProId)).toMatchObject({
      offersInSalon: true,
      offersMobile: false,
      salonPrice: MENU_PRICE,
    })

    // And the placeholder writeOffering leaves behind is NOT a capability
    // claim — a second import for this pro must still derive salon, not read
    // its own leftover row as a bookable salon.
    const placeholders = await db.professionalLocation.findMany({
      where: { professionalId: fx.locationlessProId },
      select: { type: true, isBookable: true },
    })
    expect(placeholders).toEqual([
      { type: ProfessionalLocationType.SALON, isBookable: false },
    ])
  })

  it('still refuses a row that STATES both modes off', async () => {
    authState.professionalId = fx.mobileOnlyProId
    const res = await commitPOST(
      jsonRequest('https://tovis.test/api/v1/pro/migrate/services/commit', {
        decisions: [
          {
            serviceId: fx.serviceId,
            offersInSalon: false,
            offersMobile: false,
            salonPrice: MENU_PRICE,
            salonDurationMinutes: 90,
            mobilePrice: MENU_PRICE,
            mobileDurationMinutes: 90,
            ramp: { stepMode: 'PCT', stepValue: 10, cadenceWeeks: 10 },
          },
        ],
      }),
    )
    const payload: unknown = await res.json()
    if (!isRecord(payload) || !Array.isArray(payload.rows)) {
      throw new Error('commit payload was not an object with rows')
    }

    expect(payload.rows[0]).toMatchObject({ ok: false, code: 'NO_MODE' })
    expect(payload.summary).toMatchObject({ created: 0, skipped: 1 })
  })
})
