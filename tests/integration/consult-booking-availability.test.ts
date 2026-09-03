// tests/integration/consult-booking-availability.test.ts
//
// Book the Look, slice B4b — the OFFER window for a consult's booking proposal,
// driven against real PostgreSQL through the real availability routes.
//
// B4 proved the hold and the commit reserve the whole estimate. This proves the
// third window agrees with them.
//
// [[offer-reserve-commit-are-three-windows]] is the whole subject. The seeded
// balayage is 50 minutes and the gloss 20, which round UP to 60 + 30 = 90 on the
// pro's 30-minute grid — while the FLOOR offering alone is 50→60. A grid sized
// by the offering therefore advertises the 16:30 start on a day that closes at
// 18:00: 60 minutes plus the 15-minute buffer fits, 90 plus buffer does not. The
// hold then refuses it. That is four dead-end starts a day on this fixture, and
// it is exactly the failure B3-A fixed for reschedules.
//
// So each case below asserts the same fact from a different side:
//   * the width the routes report and compute with is the ESTIMATE's;
//   * the last start the consult-sized grid offers is one the consult-sized hold
//     actually accepts;
//   * the start the BASE-sized grid would have offered is refused by that hold —
//     i.e. the correction is load-bearing, not cosmetic;
//   * a refusal is a REFUSAL. A safety-routed analysis, or an offering that is
//     not the proposal's floor, must not quietly fall back to base sizing —
//     that is how a grid starts advertising a booking that cannot be made.

import {
  Prisma,
  PrismaClient,
  ServiceLocationType,
} from '@prisma/client'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

vi.mock('@/lib/consult/access', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/access')>()
  return {
    ...original,
    isAiConsultC6ExposureEnabledForPro: () => true,
    isAiConsultC7ExposureEnabledForPro: () => true,
  }
})

vi.mock('@/lib/consult/captureStorage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return fakes.buildFakeCaptureStorageModule()
})

vi.mock('@/lib/consult/captureVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/captureVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, checkConsultCapture: fakes.fakeCheckConsultCapture }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runConsultAnalysis: fakes.fakeRunConsultAnalysis }
})

import { GET as getBootstrap } from '@/app/api/v1/availability/bootstrap/route'
import { GET as getDay } from '@/app/api/v1/availability/day/route'
import { isBookingError } from '@/lib/booking/errors'
import { createHold } from '@/lib/booking/writeBoundary'
import { minutesSinceMidnightInTimeZone, ymdInTimeZone } from '@/lib/time'

import { resetConsultLookFakes } from './_support/consultLookFakes'
import {
  BALAYAGE_ESTIMATED_MINUTES,
  BALAYAGE_MINUTES,
  BALAYAGE_PRICE,
  GLOSS_ESTIMATED_MINUTES,
  SAFETY_ROUTED_ANSWERS,
  ZONE,
  body,
  createLook,
  fx,
  runConsultToCompletion,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

/** The whole estimate: balayage 50→60 plus gloss 20→30, on a 30-minute grid. */
const PROPOSAL_MINUTES = BALAYAGE_ESTIMATED_MINUTES + GLOSS_ESTIMATED_MINUTES
/**
 * What the FLOOR offering alone would have sized the grid to: its RAW 50
 * minutes. Availability does not round to the grid — `placement` does — whereas
 * the estimate rounds every line UP before summing, which is why the two widths
 * differ by 40 minutes here rather than by the gloss's 20.
 */
const BASE_MINUTES = BALAYAGE_MINUTES

const OPEN_HOUR = 9
const CLOSE_HOUR = 18

function workingHours(): Prisma.InputJsonValue {
  const all = {
    enabled: true,
    start: `${String(OPEN_HOUR).padStart(2, '0')}:00`,
    end: `${String(CLOSE_HOUR).padStart(2, '0')}:00`,
  }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
}

/** A future UTC instant at exactly `hh:mm` LOCAL in the fixture's zone. */
function futureLocal(daysAhead: number, hh: number, mm = 0): Date {
  const anchor = new Date()
  anchor.setUTCDate(anchor.getUTCDate() + daysAhead)
  anchor.setUTCHours(20, 0, 0, 0)
  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)
  return new Date(
    anchor.getTime() + (hh * 60 + mm - anchorLocalMinutes) * 60_000,
  )
}

const TARGET_DAYS_AHEAD = 3

function targetYmd(): string {
  return ymdInTimeZone(futureLocal(TARGET_DAYS_AHEAD, 12), ZONE)
}

function availabilityRequest(
  path: string,
  params: Record<string, string>,
): Request {
  const qs = new URLSearchParams(params)
  return new Request(`http://test${path}?${qs.toString()}`)
}

function dayRequest(params: Record<string, string>): Request {
  return availabilityRequest('/api/v1/availability/day', {
    professionalId: fx.professionalId,
    serviceId: fx.balayageServiceId,
    locationType: 'SALON',
    locationId: fx.locationId,
    date: targetYmd(),
    ...params,
  })
}

function bootstrapRequest(params: Record<string, string>): Request {
  return availabilityRequest('/api/v1/availability/bootstrap', {
    professionalId: fx.professionalId,
    serviceId: fx.balayageServiceId,
    locationType: 'SALON',
    locationId: fx.locationId,
    startDate: targetYmd(),
    days: '1',
    includeOtherPros: '0',
    ...params,
  })
}

/** Local `hh:mm` for each offered start, so an assertion reads like the day. */
function localStarts(slots: string[]): string[] {
  return slots.map((iso) => {
    const minutes = minutesSinceMidnightInTimeZone(new Date(iso), ZONE)
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
    const mm = String(minutes % 60).padStart(2, '0')
    return `${hh}:${mm}`
  })
}

function proposalOffering() {
  return {
    id: fx.balayageOfferingId,
    professionalId: fx.professionalId,
    serviceId: fx.balayageServiceId,
    serviceCategoryId: fx.categoryId,
    offersInSalon: true,
    offersMobile: false,
    salonDurationMinutes: 50,
    mobileDurationMinutes: null,
    salonPriceStartingAt: new Prisma.Decimal(BALAYAGE_PRICE),
    mobilePriceStartingAt: null,
    professionalTimeZone: ZONE,
  }
}

async function holdFromConsult(args: { start: Date; consultId: string | null }) {
  return createHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds: [],
    consultId: args.consultId,
    offering: proposalOffering(),
    requestedStart: args.start,
    requestedLocationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
  })
}

/** The booking error code a thrown refusal carries, or a rethrow. */
async function refusalCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error: unknown) {
    if (isBookingError(error)) return error.code
    throw error
  }
  throw new Error('Expected a refusal, but the call succeeded')
}

async function driveToProposal(
  label: string,
  answers?: Readonly<Record<string, string>>,
): Promise<string> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  return runConsultToCompletion(db, lookPostId, label, answers)
}

let consultId = ''

beforeAll(async () => {
  await seedLookConsultFixture(db, {
    tagPrefix: 'bt1_avail',
    workingHours: workingHours(),
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
    bookable: true,
    withSafetyOfferings: true,
  })

  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })

  consultId = await driveToProposal('avail-ok')
})

beforeEach(() => {
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })
})

afterEach(async () => {
  await db.bookingHold.deleteMany({ where: { professionalId: fx.professionalId } })
})

afterAll(async () => {
  await teardownLookConsultFixture(db, async () => {
    await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
    await db.bookingHold.deleteMany({
      where: { professionalId: fx.professionalId },
    })
  })
  await db.$disconnect()
})

describe('the day grid a consult proposal is offered', () => {
  it('is sized by the whole estimate, not by the floor offering', async () => {
    const base = await body(await getDay(dayRequest({})))
    const consult = await body(await getDay(dayRequest({ consultId })))

    expect(base.ok).toBe(true)
    expect(consult.ok).toBe(true)
    expect(base.durationMinutes).toBe(BASE_MINUTES)
    expect(consult.durationMinutes).toBe(PROPOSAL_MINUTES)
    // Not a tautology on the same number: the correction has to MOVE something.
    expect(PROPOSAL_MINUTES).toBeGreaterThan(BASE_MINUTES)
  })

  it('stops offering starts the wider booking cannot finish inside the day', async () => {
    const base = await body(await getDay(dayRequest({})))
    const consult = await body(await getDay(dayRequest({ consultId })))

    const baseStarts = localStarts(base.slots as string[])
    const consultStarts = localStarts(consult.slots as string[])

    expect(baseStarts.length).toBeGreaterThan(0)
    expect(consultStarts.length).toBeGreaterThan(0)

    // Both open at the same time — the width only bites at the END of the day.
    expect(consultStarts[0]).toBe(baseStarts[0])
    expect(consultStarts.length).toBeLessThan(baseStarts.length)

    const lastBase = baseStarts[baseStarts.length - 1]
    const lastConsult = consultStarts[consultStarts.length - 1]
    expect(lastConsult).not.toBe(lastBase)
    // Every start the wider grid offers is also on the narrower one; the
    // difference is a suffix of late starts, never a different set.
    expect(baseStarts).toEqual(expect.arrayContaining(consultStarts))
  })

  it('offers exactly the starts the consult-sized hold accepts', async () => {
    const base = await body(await getDay(dayRequest({})))
    const consult = await body(await getDay(dayRequest({ consultId })))

    const baseStarts = base.slots as string[]
    const consultStarts = consult.slots as string[]

    // Asserted rather than `!`-ed: an empty grid would otherwise make both
    // holds below pass vacuously on `new Date(undefined)`.
    expect(consultStarts.length).toBeGreaterThan(0)
    expect(baseStarts.length).toBeGreaterThan(0)
    const lastConsultStart = consultStarts.at(-1) ?? ''
    const lastBaseStart = baseStarts.at(-1) ?? ''

    // The last start the corrected grid offers is really bookable...
    const hold = await holdFromConsult({
      start: new Date(lastConsultStart),
      consultId,
    })
    expect(hold.hold.durationMinutes).toBe(PROPOSAL_MINUTES)
    await db.bookingHold.delete({ where: { id: hold.hold.id } })

    // ...and the last start the UNcorrected grid would have offered is not.
    // Without the sizing this whole slice adds, that start is on screen.
    expect(
      await refusalCode(() =>
        holdFromConsult({ start: new Date(lastBaseStart), consultId }),
      ),
    ).toBe('OUTSIDE_WORKING_HOURS')
  })
})

describe('the bootstrap window', () => {
  it('reports and computes with the estimate’s width', async () => {
    const base = await body(await getBootstrap(bootstrapRequest({})))
    const consult = await body(await getBootstrap(bootstrapRequest({ consultId })))

    expect(base.durationMinutes).toBe(BASE_MINUTES)
    expect(consult.durationMinutes).toBe(PROPOSAL_MINUTES)

    // The opening day's slots come from the same computation, so the sheet's
    // first paint agrees with `/day` rather than being one width behind.
    const baseSelected = base.selectedDay as { slots: string[] } | null
    const consultSelected = consult.selectedDay as { slots: string[] } | null
    expect(baseSelected?.slots.length ?? 0).toBeGreaterThan(0)
    expect(consultSelected?.slots.length ?? 0).toBeGreaterThan(0)
    expect(consultSelected!.slots.length).toBeLessThan(
      baseSelected!.slots.length,
    )
  })
})

describe('a refusal is a refusal, never a fallback', () => {
  it('refuses the grid when the analysis routed to safety prerequisites', async () => {
    const safetyConsultId = await driveToProposal(
      'avail-safety',
      SAFETY_ROUTED_ANSWERS,
    )

    const response = await getDay(dayRequest({ consultId: safetyConsultId }))
    const payload = await body(response)

    expect(response.status).toBe(409)
    expect(payload.ok).toBe(false)
    expect(payload.code).toBe('CONSULT_PROPOSAL_UNAVAILABLE')
    // 🔴 The point: no `slots`, no base-sized consolation grid. A safety-routed
    // consult that answered with times would be advertising a chemical service
    // its own analysis declined to recommend.
    expect(payload.slots).toBeUndefined()
    expect(payload.durationMinutes).toBeUndefined()
  })

  it('refuses a service that is not the proposal’s floor', async () => {
    const response = await getDay(
      dayRequest({ consultId, serviceId: fx.glossServiceId }),
    )
    const payload = await body(response)

    expect(response.status).toBe(409)
    expect(payload.code).toBe('CONSULT_PROPOSAL_OFFERING_MISMATCH')
  })

  it('refuses another client’s consult without saying it exists', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'not-this-client',
      user: { id: 'not-this-user' },
    })

    const response = await getDay(dayRequest({ consultId }))
    const payload = await body(response)

    expect(response.status).toBe(404)
    expect(payload.code).toBe('CONSULT_NOT_FOUND')
  })

  it('refuses an anonymous caller rather than answering publicly', async () => {
    mockRequireClient.mockResolvedValue({
      ok: false,
      res: new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
      }),
    })

    const response = await getDay(dayRequest({ consultId }))
    expect(response.status).toBe(401)
  })
})
