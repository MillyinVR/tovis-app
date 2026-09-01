// tests/integration/consult-booking-proposal.test.ts
//
// Book the Look, slice B4 (docs/product/BOOK-THE-LOOK-DIRECTION.md): a
// look-anchored consult becomes a booking a client can commit to, driven end to
// end against real PostgreSQL.
//
// What only a real database can prove, and why each case is here:
//
//   * BOTH toggle states through the ONE fork. `autoAcceptBookings` on gives an
//     ACCEPTED booking, off gives PENDING — and it is `statusRules.ts` deciding,
//     the same function every other client-submitted flow passes through
//     (decision 4). A second decision about ACCEPTED-vs-PENDING would be the
//     bug, not the feature.
//
//   * PENDING REALLY OWNS THE SLOT. "Held for you; the pro confirms in the
//     morning" is only honest if the reservation is real. Nothing short of the
//     actual EXCLUDE-backed conflict machinery can show that, so a second
//     client is sent at the same minute and must be refused.
//
//   * THE SLOT IS SIZED BY THE ESTIMATE. The seeded balayage is 50 minutes and
//     the gloss 20; the booking must reserve 90 (60 + 30, each rounded UP to the
//     30-minute grid), not the 60 the base offering alone would take. A booking
//     sized by the base offering is a lie about the pro's day (decision 11).
//
//   * THE PROXIMITY EXPIRY RELEASES IT — and, just as load-bearing, does NOT
//     release the impulse booking it was minutes too early to judge.
//
//   * The RLS grant on both new tables, which nothing else catches.
//
// The world — the seeded pro, her two-service menu, and the consult drive —
// lives in tests/integration/_support/lookConsultFixture.ts, shared with B3's
// suite so neither can drift about how a consult is driven.

import {
  BookingSource,
  BookingStatus,
  Prisma,
  PrismaClient,
  ServiceLocationType,
} from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  return { ...original, checkHairColorCapture: fakes.fakeCheckHairColorCapture }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runHairColorAnalysis: fakes.fakeRunHairColorAnalysis }
})

import { GET as getProposal } from '@/app/api/v1/client/consult/[id]/proposal/route'
import { isBookingError } from '@/lib/booking/errors'
import { expireProximatePendingBookings } from '@/lib/booking/pendingProximityExpirySweep'
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { createHold, finalizeBookingFromHold } from '@/lib/booking/writeBoundary'
import {
  CONSULT_BOOKING_PROPOSAL_DERIVATION_VERSION,
  CONSULT_BOOKING_PROPOSAL_SCHEMA_VERSION,
} from '@/lib/consult/bookingProposal'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

import { resetConsultLookFakes } from './_support/consultLookFakes'
import {
  BALAYAGE_ESTIMATED_MINUTES,
  BALAYAGE_PRICE,
  BUFFER_MINUTES,
  GLOSS_ESTIMATED_MINUTES,
  GLOSS_PRICE,
  SAFETY_ROUTED_ANSWERS,
  ZONE,
  body,
  context,
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
const PROPOSAL_PRICE = '225.00' // 180.00 + 45.00

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

function workingHours(): Prisma.InputJsonValue {
  const all = { enabled: true, start: '09:00', end: '18:00' }
  return { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all }
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

async function holdFromConsult(args: {
  start: Date
  consultId: string | null
  clientId?: string
}) {
  return createHold({
    clientId: args.clientId ?? fx.clientId,
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

/** Commit through the same fork every client-submitted flow passes through. */
async function commit(args: {
  holdId: string
  consultId: string | null
  autoAccept: boolean
}) {
  return finalizeBookingFromHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    holdId: args.holdId,
    openingId: null,
    addOnIds: [],
    locationType: ServiceLocationType.SALON,
    source: BookingSource.REQUESTED,
    consultId: args.consultId,
    initialStatus: getClientSubmittedBookingStatus(args.autoAccept),
    rebookOfBookingId: null,
    offering: proposalOffering(),
    discovery: null,
    cancellationPolicySnapshot: null,
    cancellationPolicyAcceptedAt: null,
    fallbackTimeZone: 'UTC',
    idempotencyKey: `b4-${Math.random().toString(36).slice(2)}`,
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

const bookingIds: string[] = []

async function driveToProposal(
  label: string,
  answers?: Readonly<Record<string, string>>,
): Promise<string> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  return runConsultToCompletion(db, lookPostId, label, answers)
}

beforeAll(async () => {
  await seedLookConsultFixture(db, {
    tagPrefix: 'bt1_propos',
    workingHours: workingHours(),
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
    bookable: true,
    withSafetyOfferings: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })
})

afterEach(async () => {
  if (bookingIds.length) {
    await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
    bookingIds.length = 0
  }
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

describe('row level security', () => {
  it('is enabled on both new tables', async () => {
    const rows = await db.$queryRaw<Array<{ relname: string }>>(Prisma.sql`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relrowsecurity = true
        AND c.relname IN ('ConsultBookingProposal', 'ConsultBookingProposalLine')
    `)
    expect(rows.map((row) => row.relname).sort()).toEqual([
      'ConsultBookingProposal',
      'ConsultBookingProposalLine',
    ])
  })
})

describe('the proposal a client is shown', () => {
  it('prices the whole estimate as one "Starting at", with the pro-decides framing', async () => {
    const consultId = await driveToProposal('preview')

    const response = await getProposal(
      new Request(
        `http://test/api/v1/client/consult/${consultId}/proposal?locationType=SALON`,
      ),
      context(consultId),
    )
    expect(response.status).toBe(200)

    const proposal = (await body(response)).proposal as {
      available: boolean
      reason: string | null
      proposal: {
        offeringId: string
        totalDurationMinutes: number
        startingAtPrice: string
        startingAtLabel: string
        estimateNote: string
        proDecidesNote: string
        autoAccepts: boolean
        commitNote: string
        lines: Array<{ serviceName: string; price: string; durationMinutes: number }>
      } | null
    }

    expect(proposal.available).toBe(true)
    expect(proposal.reason).toBeNull()
    expect(proposal.proposal?.offeringId).toBe(fx.balayageOfferingId)
    expect(proposal.proposal?.totalDurationMinutes).toBe(PROPOSAL_MINUTES)
    expect(proposal.proposal?.startingAtPrice).toBe(PROPOSAL_PRICE)
    // Composed through the copy table, never assembled by a caller, and never a
    // bare figure (Tori's standing rule).
    expect(proposal.proposal?.startingAtLabel).toBe('Starting at $225')
    expect(proposal.proposal?.estimateNote).toContain('your photos')
    expect(proposal.proposal?.proDecidesNote).toContain('final call')
    // The seeded pro has the schema default (autoAcceptBookings false), so the
    // client is told the truth about request mode BEFORE she commits: the slot
    // is already hers, the confirmation is not (decision 4).
    expect(proposal.proposal?.autoAccepts).toBe(false)
    expect(proposal.proposal?.commitNote).toContain('held for you')
    expect(proposal.proposal?.lines).toHaveLength(2)
    // 🔴 The client's line carries no rationale and no source — the reasons are
    // the pro's half of decision 6, and a look never names its service (B1).
    expect(Object.keys(proposal.proposal?.lines[0] ?? {}).sort()).toEqual([
      'durationMinutes',
      'price',
      'serviceName',
    ])
  })

  it('promises instant booking when the pro auto-accepts, through the same fork', async () => {
    const consultId = await driveToProposal('autoaccept-note')
    await db.professionalProfile.update({
      where: { id: fx.professionalId },
      data: { autoAcceptBookings: true },
    })
    try {
      const response = await getProposal(
        new Request(
          `http://test/api/v1/client/consult/${consultId}/proposal?locationType=SALON`,
        ),
        context(consultId),
      )
      const proposal = (await body(response)).proposal as {
        proposal: { autoAccepts: boolean; commitNote: string } | null
      }
      expect(proposal.proposal?.autoAccepts).toBe(true)
      expect(proposal.proposal?.commitNote).toContain('as soon as you book')
    } finally {
      await db.professionalProfile.update({
        where: { id: fx.professionalId },
        data: { autoAcceptBookings: false },
      })
    }
  })

  it('requires a mode rather than defaulting to salon', async () => {
    const consultId = await driveToProposal('nomode')
    const response = await getProposal(
      new Request(`http://test/api/v1/client/consult/${consultId}/proposal`),
      context(consultId),
    )
    expect(response.status).toBe(400)
  })

  // 🔴 The load-bearing refusal. The pro's menu prices MOBILE for nothing here,
  // so a mode the client picks that the pro does not offer must refuse rather
  // than quietly hand back the salon number the estimate already had.
  it('refuses a mode the pro does not offer instead of reusing the salon price', async () => {
    const consultId = await driveToProposal('mobile')
    const response = await getProposal(
      new Request(
        `http://test/api/v1/client/consult/${consultId}/proposal?locationType=MOBILE`,
      ),
      context(consultId),
    )
    expect(response.status).toBe(200)
    const proposal = (await body(response)).proposal as {
      available: boolean
      reason: string | null
    }
    expect(proposal.available).toBe(false)
    // No bookable MOBILE location at all for this pro, so the slot cannot even
    // be sized — which is a truthful, differently-named refusal from a menu one.
    expect(proposal.reason).toBe('PRO_SCHEDULING_NOT_READY')
  })

  // 🔴 The whole reason B4 does not simply book the estimate. When the analysis
  // routes to safety prerequisites, the estimate legitimately contains the
  // chemical floor — a service the analysis explicitly declined to recommend.
  it('refuses entirely when the analysis routed to safety prerequisites', async () => {
    // Driven from the INTAKE, which is the real routing input: a reported prior
    // reaction requires a patch test, and the analysis then replaces every
    // colour recommendation with the tests plus a professional review.
    const consultId = await driveToProposal('safety', SAFETY_ROUTED_ANSWERS)

    // The estimate itself is unchanged and still priced — B3's honest
    // pro-facing answer.
    const estimate = await db.consultServiceEstimate.findUniqueOrThrow({
      where: { consultSessionId: consultId },
      select: { status: true },
    })
    expect(estimate.status).toBe('ESTIMATED')

    const response = await getProposal(
      new Request(
        `http://test/api/v1/client/consult/${consultId}/proposal?locationType=SALON`,
      ),
      context(consultId),
    )
    const proposal = (await body(response)).proposal as {
      available: boolean
      reason: string | null
    }
    expect(proposal.available).toBe(false)
    expect(proposal.reason).toBe('SAFETY_REVIEW_REQUIRED')

    // And the commit path refuses too — the preview is not the only gate.
    const start = futureLocal(3, 10)
    const code = await refusalCode(() =>
      holdFromConsult({ start, consultId }),
    )
    expect(code).toBe('CONSULT_PROPOSAL_UNAVAILABLE')
  })
})

describe('the same fork, both toggle states', () => {
  it('auto-accept ON commits an ACCEPTED booking sized by the estimate', async () => {
    const consultId = await driveToProposal('autoon')
    const start = futureLocal(4, 10)

    const held = await holdFromConsult({ start, consultId })
    // The reservation is the WHOLE estimate, not the base offering's 50→60.
    expect(held.hold.durationMinutes).toBe(PROPOSAL_MINUTES)

    const finalized = await commit({
      holdId: held.hold.id,
      consultId,
      autoAccept: true,
    })
    bookingIds.push(finalized.booking.id)

    expect(finalized.booking.status).toBe(BookingStatus.ACCEPTED)

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: finalized.booking.id },
      select: {
        totalDurationMinutes: true,
        bufferMinutes: true,
        sourceConsultSessionId: true,
        sourceConsultServiceEstimateId: true,
      },
    })
    expect(booking.totalDurationMinutes).toBe(PROPOSAL_MINUTES)
    expect(booking.bufferMinutes).toBe(BUFFER_MINUTES)
    // Provenance stamped at the write: which consult, and WHICH derivation of it.
    expect(booking.sourceConsultSessionId).toBe(consultId)
    expect(booking.sourceConsultServiceEstimateId).not.toBeNull()
  })

  it('auto-accept OFF commits a PENDING request, and the proposal is recorded either way', async () => {
    const consultId = await driveToProposal('autooff')
    const start = futureLocal(5, 10)

    const held = await holdFromConsult({ start, consultId })
    const finalized = await commit({
      holdId: held.hold.id,
      consultId,
      autoAccept: false,
    })
    bookingIds.push(finalized.booking.id)

    expect(finalized.booking.status).toBe(BookingStatus.PENDING)

    const proposal = await db.consultBookingProposal.findUniqueOrThrow({
      where: { bookingId: finalized.booking.id },
      select: {
        consultSessionId: true,
        locationType: true,
        totalDurationMinutes: true,
        startingAtPrice: true,
        stepMinutes: true,
        bufferMinutes: true,
        schemaVersion: true,
        derivationVersion: true,
        lines: {
          select: {
            sortOrder: true,
            serviceId: true,
            serviceName: true,
            source: true,
            price: true,
            durationMinutes: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    expect(proposal.consultSessionId).toBe(consultId)
    expect(proposal.locationType).toBe(ServiceLocationType.SALON)
    expect(proposal.totalDurationMinutes).toBe(PROPOSAL_MINUTES)
    expect(proposal.startingAtPrice.toString()).toBe('225')
    expect(proposal.schemaVersion).toBe(CONSULT_BOOKING_PROPOSAL_SCHEMA_VERSION)
    expect(proposal.derivationVersion).toBe(
      CONSULT_BOOKING_PROPOSAL_DERIVATION_VERSION,
    )
    expect(proposal.lines).toHaveLength(2)
    expect(proposal.lines[0]?.source).toBe('LOOK_LINKED_SERVICE')
    expect(proposal.lines[0]?.serviceId).toBe(fx.balayageServiceId)
    expect(proposal.lines[0]?.price.toString()).toBe('180')
    expect(proposal.lines[0]?.durationMinutes).toBe(BALAYAGE_ESTIMATED_MINUTES)
    expect(proposal.lines[1]?.source).toBe('ANALYSIS_RECOMMENDATION')
    expect(proposal.lines[1]?.serviceId).toBe(fx.glossServiceId)
    expect(proposal.lines[1]?.price.toString()).toBe(
      new Prisma.Decimal(GLOSS_PRICE).toString(),
    )
    expect(proposal.lines[1]?.durationMinutes).toBe(GLOSS_ESTIMATED_MINUTES)
  })

  // 🔴 "Held for you; the pro confirms in the morning" is only honest if the
  // reservation is real. PENDING is in BOOKING_BLOCKING_STATUSES and the range
  // is EXCLUDE-backed, so a second client at the same minute must be refused.
  it('a PENDING request really owns its slot — and the whole estimate’s width', async () => {
    const consultId = await driveToProposal('blocks')
    const start = futureLocal(6, 10)

    const held = await holdFromConsult({ start, consultId })
    const finalized = await commit({
      holdId: held.hold.id,
      consultId,
      autoAccept: false,
    })
    bookingIds.push(finalized.booking.id)
    expect(finalized.booking.status).toBe(BookingStatus.PENDING)

    const other = await db.clientProfile.create({
      data: {
        userId: fx.proUserId, // any distinct user; this client never books
        firstName: 'Second',
        lastName: 'Client',
        homeTenantId: fx.tenantId,
      },
      select: { id: true },
    })

    try {
      // Same minute — refused, and refused specifically as TIME_BOOKED: a
      // BOOKING occupies this range, which is the whole claim "PENDING owns
      // its slot" makes.
      expect(
        await refusalCode(() =>
          holdFromConsult({ start, consultId: null, clientId: other.id }),
        ),
      ).toBe('TIME_BOOKED')

      // And 60 minutes in: inside the estimate's 90-minute width but PAST the
      // 60 the base offering alone would have reserved. This is the assertion
      // that fails if the slot is ever sized by the offering again.
      expect(
        await refusalCode(() =>
          holdFromConsult({
            start: new Date(start.getTime() + 60 * 60_000),
            consultId: null,
            clientId: other.id,
          }),
        ),
      ).toBe('TIME_BOOKED')
    } finally {
      await db.bookingHold.deleteMany({ where: { clientId: other.id } })
      await db.clientProfile.deleteMany({ where: { id: other.id } })
    }
  })
})

describe('the database refuses a proposal that lies', () => {
  /** Commit a real proposal, then hand its row back for the guards to attack. */
  async function committedProposal(label: string) {
    const consultId = await driveToProposal(label)
    const held = await holdFromConsult({ start: futureLocal(20, 10), consultId })
    const finalized = await commit({
      holdId: held.hold.id,
      consultId,
      autoAccept: true,
    })
    bookingIds.push(finalized.booking.id)
    const row = await db.consultBookingProposal.findUniqueOrThrow({
      where: { bookingId: finalized.booking.id },
      select: {
        id: true,
        estimateId: true,
        stepMinutes: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        startingAtPrice: true,
        lines: { select: { id: true } },
      },
    })
    return { consultId, bookingId: finalized.booking.id, row }
  }

  // 🔴 The claim this whole slice rests on — "the slot is sized by the estimate"
  // — is only worth having if the stored total cannot quietly stop matching the
  // lines it is supposed to be the sum of.
  it('refuses a header total that disagrees with its own lines', async () => {
    const { consultId, bookingId, row } = await committedProposal('guard-totals')

    await db.consultBookingProposal.delete({ where: { id: row.id } })

    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "ConsultBookingProposal"
            ("id", "bookingId", "consultSessionId", "estimateId", "locationType",
             "stepMinutes", "bufferMinutes", "totalDurationMinutes",
             "startingAtPrice", "schemaVersion", "derivationVersion", "updatedAt")
          VALUES ('lie_totals_1', ${bookingId}, ${consultId}, ${row.estimateId},
                  'SALON', ${row.stepMinutes}, ${row.bufferMinutes},
                  ${PROPOSAL_MINUTES + 30}, ${new Prisma.Decimal(PROPOSAL_PRICE)},
                  1, 'look-proposal-v1', now())
        `
        await tx.$executeRaw`
          INSERT INTO "ConsultBookingProposalLine"
            ("id", "proposalId", "estimateLineId", "sortOrder", "serviceId",
             "offeringId", "serviceName", "source", "price", "durationMinutes")
          VALUES ('lie_line_1', 'lie_totals_1', 'whatever', 0,
                  ${fx.balayageServiceId}, ${fx.balayageOfferingId}, 'Balayage',
                  'LOOK_LINKED_SERVICE', 180.00, ${PROPOSAL_MINUTES})
        `
      }),
    ).rejects.toThrow(/total duration must equal its lines/)
  })

  it('refuses a proposal whose consult is not the one stamped on its booking', async () => {
    const { bookingId, row } = await committedProposal('guard-scope')
    const otherConsultId = await driveToProposal('guard-scope-other')

    await db.consultBookingProposal.delete({ where: { id: row.id } })

    await expect(
      db.$executeRaw`
        INSERT INTO "ConsultBookingProposal"
          ("id", "bookingId", "consultSessionId", "estimateId", "locationType",
           "stepMinutes", "bufferMinutes", "totalDurationMinutes",
           "startingAtPrice", "schemaVersion", "derivationVersion", "updatedAt")
        VALUES ('lie_scope_1', ${bookingId}, ${otherConsultId}, ${row.estimateId},
                'SALON', ${row.stepMinutes}, ${row.bufferMinutes},
                ${PROPOSAL_MINUTES}, ${new Prisma.Decimal(PROPOSAL_PRICE)},
                1, 'look-proposal-v1', now())
      `,
    ).rejects.toThrow(/invalid consult booking proposal scope/)
  })

  // A proposal is the record of one commitment a person made. Correcting a price
  // is B5's job and lands on the ESTIMATE line's pro-final half, never by
  // rewriting what the client agreed to.
  it('freezes what the client agreed to', async () => {
    const { row } = await committedProposal('guard-immutable')

    await expect(
      db.$executeRaw`
        UPDATE "ConsultBookingProposal"
        SET "startingAtPrice" = 1.00
        WHERE "id" = ${row.id}
      `,
    ).rejects.toThrow(/consult booking proposal is immutable/)

    await expect(
      db.$executeRaw`
        UPDATE "ConsultBookingProposalLine"
        SET "price" = 1.00
        WHERE "id" = ${row.lines[0]?.id ?? ''}
      `,
    ).rejects.toThrow(/consult booking proposal lines are immutable/)
  })
})

describe('the proximity expiry', () => {
  async function pendingBooking(label: string, start: Date) {
    const consultId = await driveToProposal(label)
    const held = await holdFromConsult({ start, consultId })
    const finalized = await commit({
      holdId: held.hold.id,
      consultId,
      autoAccept: false,
    })
    bookingIds.push(finalized.booking.id)
    expect(finalized.booking.status).toBe(BookingStatus.PENDING)
    return finalized.booking.id
  }

  it('releases an unanswered request and frees the slot', async () => {
    const start = futureLocal(7, 10)
    const bookingId = await pendingBooking('expire', start)

    // Three hours before the appointment: inside the 6-hour proximity window,
    // and comfortably past the 2-hour minimum answer window since the booking
    // was created just now.
    const result = await expireProximatePendingBookings({
      now: new Date(start.getTime() - 3 * 60 * 60_000),
    })

    expect(result.enabled).toBe(true)
    expect(result.results).toContainEqual({ bookingId, outcome: 'expired' })

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true, cancelledAt: true, cancelledByRole: true },
    })
    expect(booking.status).toBe(BookingStatus.CANCELLED)
    expect(booking.cancelledAt).not.toBeNull()
    // SYSTEM provenance: no human cancelled this.
    expect(booking.cancelledByRole).toBeNull()

    // The slot is genuinely free again — the point of releasing it.
    const reheld = await holdFromConsult({ start, consultId: null })
    expect(reheld.hold.id).toBeTruthy()
  })

  // 🔴 The rule that keeps the sacred case alive. A 3 AM client booking a slot
  // later the same day is ALREADY inside the proximity window when she commits;
  // without the minimum answer window the very next sweep tick would cancel the
  // impulse booking this whole slice exists to enable (decision 3).
  it('does NOT release a request the pro has barely had a chance to see', async () => {
    const start = futureLocal(8, 10)
    const bookingId = await pendingBooking('impulse', start)

    // One hour after the booking was created and well inside the proximity
    // window — but inside the 2-hour minimum answer window too.
    const result = await expireProximatePendingBookings({
      now: new Date(Date.now() + 60 * 60_000),
    })

    expect(
      result.results.some((row) => row.bookingId === bookingId),
    ).toBe(false)

    expect(
      await db.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { status: true },
      }),
    ).toEqual({ status: BookingStatus.PENDING })
  })

  it('leaves an ACCEPTED booking alone — that is the pro’s decision, not a sweep’s', async () => {
    const consultId = await driveToProposal('accepted')
    const start = futureLocal(9, 10)
    const held = await holdFromConsult({ start, consultId })
    const finalized = await commit({
      holdId: held.hold.id,
      consultId,
      autoAccept: true,
    })
    bookingIds.push(finalized.booking.id)
    expect(finalized.booking.status).toBe(BookingStatus.ACCEPTED)

    const result = await expireProximatePendingBookings({
      now: new Date(start.getTime() - 3 * 60 * 60_000),
    })

    expect(
      result.results.some((row) => row.bookingId === finalized.booking.id),
    ).toBe(false)
    expect(
      await db.booking.findUniqueOrThrow({
        where: { id: finalized.booking.id },
        select: { status: true },
      }),
    ).toEqual({ status: BookingStatus.ACCEPTED })
  })

  // 🔴 The BLAST RADIUS case, INVERTED (Tori, 2026-08-31). This used to assert
  // that the sweep left an ordinary pending request alone, because widening it
  // was a product change nobody had made. Tori made it: the expiry now applies
  // to EVERY pending request on the same rules and windows. The case is kept,
  // pointed the other way, because it is still the one that proves what the
  // sweep's `where` clause actually reaches — a booking with no proposal behind
  // it at all.
  it('releases a PENDING booking that came from no proposal', async () => {
    const start = futureLocal(11, 10)
    const held = await holdFromConsult({ start, consultId: null })
    const finalized = await commit({
      holdId: held.hold.id,
      consultId: null,
      autoAccept: false,
    })
    bookingIds.push(finalized.booking.id)
    expect(finalized.booking.status).toBe(BookingStatus.PENDING)

    // No proposal row, precisely because no consult was named.
    expect(
      await db.consultBookingProposal.findUnique({
        where: { bookingId: finalized.booking.id },
        select: { id: true },
      }),
    ).toBeNull()

    const result = await expireProximatePendingBookings({
      now: new Date(start.getTime() - 3 * 60 * 60_000),
    })

    expect(
      result.results.some(
        (row) =>
          row.bookingId === finalized.booking.id && row.outcome === 'expired',
      ),
    ).toBe(true)
    expect(
      await db.booking.findUniqueOrThrow({
        where: { id: finalized.booking.id },
        select: { status: true },
      }),
    ).toEqual({ status: BookingStatus.CANCELLED })
  })

  it('observes without releasing when the kill switch is off', async () => {
    const start = futureLocal(10, 10)
    const bookingId = await pendingBooking('killswitch', start)

    process.env.PENDING_PROXIMITY_EXPIRY_ENABLED = 'false'
    try {
      const result = await expireProximatePendingBookings({
        now: new Date(start.getTime() - 3 * 60 * 60_000),
      })
      expect(result.enabled).toBe(false)
      expect(result.candidatesScanned).toBeGreaterThan(0)
      expect(result.expiredCount).toBe(0)
    } finally {
      delete process.env.PENDING_PROXIMITY_EXPIRY_ENABLED
    }

    expect(
      await db.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { status: true },
      }),
    ).toEqual({ status: BookingStatus.PENDING })
  })
})
