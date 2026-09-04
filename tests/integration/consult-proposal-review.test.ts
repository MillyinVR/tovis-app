// tests/integration/consult-proposal-review.test.ts
//
// Book the Look, slice B5 (docs/product/BOOK-THE-LOOK-DIRECTION.md): the PRO's
// review of a booking a client committed to, driven end to end against real
// PostgreSQL.
//
// What only a real database can prove, and why each case is here:
//
//   * ONE SURFACE, TWO PLACEMENTS. `placement` follows the booking's own status,
//     which is what decision 4's `autoAcceptBookings` fork produced. Both toggle
//     states are committed for real and the same loader is asked.
//
//   * THE NUMBERS SHE IS SHOWN ARE THE CLIENT'S. Every proposed figure comes off
//     the PROPOSAL line — the mode-reconciled thing the client was sold — while
//     the reason beside it comes off the ESTIMATE line. Only a database can show
//     the join landing on the right row of each.
//
//   * THE CORRECTION LANDS WHERE THE TRIGGERS ALLOW IT. B3 froze the AI half of
//     the estimate line and B4 froze the proposal line WHOLLY. A write that went
//     anywhere else would be refused by Postgres, not by a mock.
//
//   * NOTHING MOVES UNDER THE CLIENT. The revision-notice threshold is still
//     Tori's open decision, so the booking's status, price and reserved width
//     must be byte-identical after a correction that doubles the price.
//
//   * ANOTHER PRO'S BOOKING IS NOT HERS, and a closed booking is read-only.
//
// The world — the seeded pro, her two-service menu, and the consult drive —
// lives in tests/integration/_support/lookConsultFixture.ts, shared with B3's
// and B4's suites so none of them can drift about how a consult is driven.

import {
  BookingSource,
  BookingStatus,
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

vi.mock('@/lib/consult/inspirationImage', async () => {
  const fakes = await import('./_support/consultLookFakes')
  return { fetchConsultInspirationImage: fakes.fakeFetchConsultInspirationImage }
})

vi.mock('@/lib/consult/inspirationVision', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/inspirationVision')>()
  const fakes = await import('./_support/consultLookFakes')
  return {
    ...original,
    runConsultInspirationVision: fakes.fakeRunConsultInspirationVision,
  }
})

vi.mock('@/lib/consult/analysisEngine', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/consult/analysisEngine')>()
  const fakes = await import('./_support/consultLookFakes')
  return { ...original, runConsultAnalysis: fakes.fakeRunConsultAnalysis }
})

import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { createHold, finalizeBookingFromHold } from '@/lib/booking/writeBoundary'
import {
  ProProposalReviewError,
  loadAuthorizedProProposalReview,
  recordProProposalReview,
} from '@/lib/consult/proProposalReview'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'

import { resetConsultLookFakes } from './_support/consultLookFakes'
import {
  BALAYAGE_ESTIMATED_MINUTES,
  BALAYAGE_PRICE,
  GLOSS_ESTIMATED_MINUTES,
  GLOSS_PRICE,
  ZONE,
  createLook,
  fx,
  runConsultToCompletion,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const PROPOSAL_MINUTES = BALAYAGE_ESTIMATED_MINUTES + GLOSS_ESTIMATED_MINUTES
const PROPOSAL_PRICE = '225.00' // 180.00 + 45.00

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

const bookingIds: string[] = []

/**
 * Drive a consult to a committed booking carrying a proposal.
 *
 * B7 — the client TAKES the analysis's enhancement here by default, because
 * this suite's subject is the pro reviewing a multi-line booking. Her opt-in is
 * what puts the second line on it at all (decision 10); a declined enhancement
 * is exercised in tests/integration/consult-booking-proposal.test.ts.
 */
async function bookedProposal(args: {
  label: string
  hour: number
  autoAccept: boolean
  daysAhead?: number
  takeEnhancements?: boolean
}): Promise<{ bookingId: string; consultId: string }> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  const consultId = await runConsultToCompletion(db, lookPostId, args.label)
  const start = futureLocal(args.daysAhead ?? 30, args.hour)

  const enhancementIds =
    args.takeEnhancements === false
      ? []
      : (
          await db.consultServiceEstimateLine.findMany({
            where: {
              estimate: { consultSessionId: consultId },
              source: 'ANALYSIS_RECOMMENDATION',
            },
            select: { id: true },
          })
        ).map((line) => line.id)

  const hold = await createHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds: [],
    consultId,
    offering: proposalOffering(),
    requestedStart: start,
    requestedLocationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
  })

  const finalized = await finalizeBookingFromHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    holdId: hold.hold.id,
    openingId: null,
    addOnIds: [],
    consultEnhancementLineIds: enhancementIds,
    locationType: ServiceLocationType.SALON,
    source: BookingSource.REQUESTED,
    consultId,
    initialStatus: getClientSubmittedBookingStatus(args.autoAccept),
    rebookOfBookingId: null,
    offering: proposalOffering(),
    discovery: null,
    cancellationPolicySnapshot: null,
    cancellationPolicyAcceptedAt: null,
    fallbackTimeZone: 'UTC',
    idempotencyKey: `b5-${Math.random().toString(36).slice(2)}`,
  })
  bookingIds.push(finalized.booking.id)
  return { bookingId: finalized.booking.id, consultId }
}

async function review(bookingId: string, professionalId = fx.professionalId) {
  const dto = await loadAuthorizedProProposalReview({
    professionalId,
    bookingId,
  })
  if (!dto) throw new Error('expected a proposal review')
  return dto
}

async function errorCodeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error: unknown) {
    if (error instanceof ProProposalReviewError) return error.code
    throw error
  }
  throw new Error('Expected a refusal, but the call succeeded')
}

beforeAll(async () => {
  await seedLookConsultFixture(db, {
    tagPrefix: 'bt1_review',
    workingHours: workingHours(),
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
    bookable: true,
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
  await db.bookingHold.deleteMany({
    where: { professionalId: fx.professionalId },
  })
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

describe('one review surface, two placements', () => {
  it('renders BEFORE the decision while the request is still hers to answer', async () => {
    const { bookingId } = await bookedProposal({
      label: 'review-pending',
      hour: 10,
      autoAccept: false,
    })
    const dto = await review(bookingId)
    expect(dto.placement).toBe('BEFORE_DECISION')
    expect(dto.editable).toBe(true)
  })

  it('renders AFTER acceptance when her toggle already booked it', async () => {
    const { bookingId } = await bookedProposal({
      label: 'review-accepted',
      hour: 12,
      autoAccept: true,
    })
    const dto = await review(bookingId)
    expect(dto.placement).toBe('AFTER_ACCEPTANCE')
    expect(dto.editable).toBe(true)
  })
})

describe('what she is shown', () => {
  it('is the CLIENT’s numbers, with the estimate’s reason beside each line', async () => {
    const { bookingId, consultId } = await bookedProposal({
      label: 'review-shape',
      hour: 14,
      autoAccept: false,
    })
    const dto = await review(bookingId)

    expect(dto.consultId).toBe(consultId)
    expect(dto.startingAtPrice).toBe(PROPOSAL_PRICE)
    expect(dto.startingAtLabel).toBe('Starting at $225')
    expect(dto.totalDurationMinutes).toBe(PROPOSAL_MINUTES)

    // The floor first, then the beyond-floor line: the proposal's own order.
    expect(dto.lines.map((line) => line.source)).toEqual([
      'LOOK_LINKED_SERVICE',
      'ANALYSIS_RECOMMENDATION',
    ])
    const [floor, gloss] = dto.lines
    if (!floor || !gloss) throw new Error('expected two lines')

    expect(floor.proposedPrice).toBe(BALAYAGE_PRICE)
    expect(floor.proposedDurationMinutes).toBe(BALAYAGE_ESTIMATED_MINUTES)
    expect(gloss.proposedPrice).toBe(GLOSS_PRICE)
    expect(gloss.proposedDurationMinutes).toBe(GLOSS_ESTIMATED_MINUTES)

    // Decision 6's "why" is real text off the estimate line, never invented.
    expect(floor.rationale.length).toBeGreaterThan(0)
    expect(gloss.rationale.length).toBeGreaterThan(0)

    // Nothing recorded yet.
    expect(dto.lines.every((line) => line.reviewStatus === 'NOT_REVIEWED')).toBe(
      true,
    )
    expect(dto.proFinalTotalPrice).toBeNull()
    expect(dto.reviewedAt).toBeNull()
  })

  it('answers null — not an error — for a booking with no proposal', async () => {
    // The ordinary named-service door: her own booking, no consult behind it.
    // Most of a pro's bookings are this, and the page must render nothing
    // rather than an empty section or a thrown error.
    const start = futureLocal(31, 10)
    const hold = await createHold({
      clientId: fx.clientId,
      bookingEntryPoint: 'DIRECT_PROFILE',
      addOnIds: [],
      consultId: null,
      offering: proposalOffering(),
      requestedStart: start,
      requestedLocationId: fx.locationId,
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
    })
    const finalized = await finalizeBookingFromHold({
      clientId: fx.clientId,
      bookingEntryPoint: 'DIRECT_PROFILE',
      holdId: hold.hold.id,
      openingId: null,
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.REQUESTED,
      consultId: null,
      initialStatus: getClientSubmittedBookingStatus(false),
      rebookOfBookingId: null,
      offering: proposalOffering(),
      discovery: null,
      cancellationPolicySnapshot: null,
      cancellationPolicyAcceptedAt: null,
      fallbackTimeZone: 'UTC',
      idempotencyKey: `b5-plain-${Math.random().toString(36).slice(2)}`,
    })
    bookingIds.push(finalized.booking.id)

    expect(
      await db.consultBookingProposal.findUnique({
        where: { bookingId: finalized.booking.id },
        select: { id: true },
      }),
    ).toBeNull()
    expect(
      await loadAuthorizedProProposalReview({
        professionalId: fx.professionalId,
        bookingId: finalized.booking.id,
      }),
    ).toBeNull()
  })
})

describe('recording her numbers', () => {
  it('writes the pro-final half of the estimate line and nothing else', async () => {
    const { bookingId } = await bookedProposal({
      label: 'review-write',
      hour: 9,
      autoAccept: false,
    })
    const before = await review(bookingId)
    const [floor, gloss] = before.lines
    if (!floor || !gloss) throw new Error('expected two lines')

    const bookingBefore = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        status: true,
        totalAmount: true,
        subtotalSnapshot: true,
        totalDurationMinutes: true,
        scheduledFor: true,
      },
    })
    const proposalBefore = await db.consultBookingProposal.findUniqueOrThrow({
      where: { bookingId },
      select: { startingAtPrice: true, totalDurationMinutes: true },
    })
    const estimateLineBefore = await db.consultServiceEstimateLine.findUniqueOrThrow(
      { where: { id: floor.estimateLineId } },
    )

    const after = await recordProProposalReview({
      professionalId: fx.professionalId,
      bookingId,
      lines: [
        {
          estimateLineId: floor.estimateLineId,
          // Double it: if anything downstream re-derived the client's price
          // from a correction, this is the number that would show up there.
          price: '360.00',
          durationMinutes: 120,
          note: null,
        },
        {
          estimateLineId: gloss.estimateLineId,
          price: gloss.proposedPrice,
          durationMinutes: gloss.proposedDurationMinutes,
          note: 'ask about the box dye before the gloss',
        },
      ],
    })

    // The statuses the server derived, against the CLIENT's numbers.
    expect(after.lines.map((line) => line.reviewStatus)).toEqual([
      'ADJUSTED',
      'FLAGGED',
    ])
    expect(after.proFinalTotalPrice).toBe('405.00') // 360 + 45
    expect(after.proFinalTotalDurationMinutes).toBe(150) // 120 + 30
    expect(after.reviewedAt).not.toBeNull()

    // The AI half of the estimate line is untouched — the trigger would have
    // refused otherwise, and this proves the write went through its own door.
    const estimateLineAfter = await db.consultServiceEstimateLine.findUniqueOrThrow(
      { where: { id: floor.estimateLineId } },
    )
    expect(estimateLineAfter.estimatedPrice.toFixed(2)).toBe(
      estimateLineBefore.estimatedPrice.toFixed(2),
    )
    expect(estimateLineAfter.estimatedDurationMinutes).toBe(
      estimateLineBefore.estimatedDurationMinutes,
    )
    expect(estimateLineAfter.rationale).toBe(estimateLineBefore.rationale)
    expect(estimateLineAfter.proFinalPrice?.toFixed(2)).toBe('360.00')
    expect(estimateLineAfter.proFinalDurationMinutes).toBe(120)
    expect(estimateLineAfter.proFinalAt).not.toBeNull()

    // 🔴 Nothing moved under the client. Her booking and the record of what she
    // agreed to are byte-identical after a correction that doubled the price.
    const bookingAfter = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        status: true,
        totalAmount: true,
        subtotalSnapshot: true,
        totalDurationMinutes: true,
        scheduledFor: true,
      },
    })
    expect(bookingAfter).toEqual(bookingBefore)
    const proposalAfter = await db.consultBookingProposal.findUniqueOrThrow({
      where: { bookingId },
      select: { startingAtPrice: true, totalDurationMinutes: true },
    })
    expect(proposalAfter.startingAtPrice.toFixed(2)).toBe(
      proposalBefore.startingAtPrice.toFixed(2),
    )
    expect(proposalAfter.totalDurationMinutes).toBe(
      proposalBefore.totalDurationMinutes,
    )
    const proposalLines = await db.consultBookingProposalLine.findMany({
      where: { proposal: { bookingId } },
      select: { price: true, durationMinutes: true },
      orderBy: { sortOrder: 'asc' },
    })
    expect(proposalLines.map((line) => line.price.toFixed(2))).toEqual([
      BALAYAGE_PRICE,
      GLOSS_PRICE,
    ])
  })

  it('is re-runnable — she may correct her own correction', async () => {
    const { bookingId } = await bookedProposal({
      label: 'review-rerun',
      hour: 11,
      autoAccept: true,
    })
    const first = await review(bookingId)
    const [floor, gloss] = first.lines
    if (!floor || !gloss) throw new Error('expected two lines')

    const lines = [floor, gloss].map((line) => ({
      estimateLineId: line.estimateLineId,
      price: '300.00',
      durationMinutes: 60,
      note: 'first pass',
    }))
    await recordProProposalReview({
      professionalId: fx.professionalId,
      bookingId,
      lines,
    })

    const second = await recordProProposalReview({
      professionalId: fx.professionalId,
      bookingId,
      lines: [
        {
          estimateLineId: floor.estimateLineId,
          price: floor.proposedPrice,
          durationMinutes: floor.proposedDurationMinutes,
          note: null,
        },
        {
          estimateLineId: gloss.estimateLineId,
          price: gloss.proposedPrice,
          durationMinutes: gloss.proposedDurationMinutes,
          note: null,
        },
      ],
    })
    // Back to agreeing with the client: CONFIRMED, and the totals match hers.
    expect(second.lines.map((line) => line.reviewStatus)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
    ])
    expect(second.proFinalTotalPrice).toBe(PROPOSAL_PRICE)
    expect(second.proFinalTotalDurationMinutes).toBe(PROPOSAL_MINUTES)
  })

  it('refuses a line that is not on this booking’s proposal', async () => {
    const { bookingId } = await bookedProposal({
      label: 'review-foreign-line',
      hour: 14,
      autoAccept: false,
    })
    expect(
      await errorCodeOf(() =>
        recordProProposalReview({
          professionalId: fx.professionalId,
          bookingId,
          lines: [
            {
              estimateLineId: 'not-a-line-of-this-proposal',
              price: '10.00',
              durationMinutes: 30,
              note: null,
            },
          ],
        }),
      ),
    ).toBe('INVALID_REQUEST')
  })

  it('stays open while the appointment is happening', async () => {
    // IN_PROGRESS is not a closed booking, and it is the moment a pro actually
    // learns what the service cost. Locking here would show "this booking is
    // closed" about an appointment in the chair.
    const { bookingId } = await bookedProposal({
      label: 'review-in-progress',
      hour: 13,
      autoAccept: true,
    })
    const dto = await review(bookingId)
    const [floor] = dto.lines
    if (!floor) throw new Error('expected a line')

    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.IN_PROGRESS },
    })
    expect(await review(bookingId).then((next) => next.editable)).toBe(true)

    const saved = await recordProProposalReview({
      professionalId: fx.professionalId,
      bookingId,
      lines: [
        {
          estimateLineId: floor.estimateLineId,
          price: '400.00',
          durationMinutes: 90,
          note: null,
        },
      ],
    })
    expect(saved.lines[0]?.reviewStatus).toBe('ADJUSTED')
  })

  it('refuses once the booking is closed', async () => {
    const { bookingId } = await bookedProposal({
      label: 'review-closed',
      hour: 15,
      autoAccept: true,
    })
    const dto = await review(bookingId)
    const [floor] = dto.lines
    if (!floor) throw new Error('expected a line')

    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
    })

    expect(await review(bookingId).then((next) => next.editable)).toBe(false)
    expect(
      await errorCodeOf(() =>
        recordProProposalReview({
          professionalId: fx.professionalId,
          bookingId,
          lines: [
            {
              estimateLineId: floor.estimateLineId,
              price: '10.00',
              durationMinutes: 30,
              note: null,
            },
          ],
        }),
      ),
    ).toBe('NOT_EDITABLE')
  })
})

describe('it is her booking or it is nothing', () => {
  it('refuses another professional’s booking, on read and on write', async () => {
    const { bookingId } = await bookedProposal({
      label: 'review-other-pro',
      hour: 16,
      autoAccept: false,
    })
    const dto = await review(bookingId)
    const [floor] = dto.lines
    if (!floor) throw new Error('expected a line')

    expect(
      await errorCodeOf(() =>
        loadAuthorizedProProposalReview({
          professionalId: 'some-other-professional-id',
          bookingId,
        }),
      ),
    ).toBe('NOT_FOUND')
    expect(
      await errorCodeOf(() =>
        recordProProposalReview({
          professionalId: 'some-other-professional-id',
          bookingId,
          lines: [
            {
              estimateLineId: floor.estimateLineId,
              price: '10.00',
              durationMinutes: 30,
              note: null,
            },
          ],
        }),
      ),
    ).toBe('NOT_FOUND')

    // And the write really did not land.
    const line = await db.consultServiceEstimateLine.findUniqueOrThrow({
      where: { id: floor.estimateLineId },
      select: { proFinalAt: true },
    })
    expect(line.proFinalAt).toBeNull()
  })
})
