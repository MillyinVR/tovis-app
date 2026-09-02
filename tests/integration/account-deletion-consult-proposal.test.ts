// tests/integration/account-deletion-consult-proposal.test.ts
//
// Real-Postgres proof that a client who committed to a look can still delete
// her account.
//
//   pnpm test:integration
//
// THE BUG THIS EXISTS FOR. `ConsultBookingProposal` references
// `ConsultSession` and `ConsultServiceEstimate` with `onDelete: Restrict`, and
// both of those are HARD-DELETED by the client deletion rules. Nothing in the
// registry deleted the proposal first, so the delete raised a foreign-key
// violation — and because the whole run is ONE transaction, that single P2003
// rolled back every rule, marked the request FAILED, and the failure path is
// deliberately never retried. Her erasure would have stalled forever.
//
// Invisible to every existing guard: the completeness boundary detects subject
// links by DIRECT foreign key only, and this model reaches the client through
// `consultSessionId`.
//
// A unit test cannot catch this class of bug at all — `deleteUserData`'s unit
// tests mock every delegate, and a mocked `deleteMany` succeeds exactly where
// real Postgres refuses. Same reasoning that put `account-deletion-boundary`
// next door, for the same shape of defect.
//
// The proposal is built by driving the REAL commit flow through the shared
// look-consult fixture, not by hand-writing rows. The database enforces the
// proposal's scope, its line count, its floor line and that its header totals
// equal its lines — a hand-built fixture has to satisfy all of that, and one
// that drifts would prove nothing.

import { PrismaClient, Prisma, BookingSource, ServiceLocationType } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { createHold, finalizeBookingFromHold } from '@/lib/booking/writeBoundary'
import {
  ACCOUNT_DELETION_GRACE_PERIOD_DAYS,
  executeDueAccountDeletions,
  requestAccountDeletion,
} from '@/lib/privacy/accountDeletion'
import { AccountDeletionRequestStatus } from '@prisma/client'

import { resetConsultLookFakes } from './_support/consultLookFakes'
import {
  BALAYAGE_PRICE,
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

const DAY_MS = 24 * 60 * 60 * 1000

function workingHours(): Prisma.InputJsonValue {
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

let consultSessionId = ''
let estimateId = ''
let proposalId = ''
let bookingId = ''

beforeEach(() => {
  vi.clearAllMocks()
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })
})

beforeAll(async () => {
  await seedLookConsultFixture(db, {
    tagPrefix: 'acctdel_prop',
    workingHours: workingHours(),
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
    bookable: true,
    withSafetyOfferings: true,
  })

  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })

  // Drive the real flow: look -> consult -> analysis -> estimate -> commit.
  const lookPostId = await createLook(db, fx.balayageServiceId)
  consultSessionId = await runConsultToCompletion(db, lookPostId, 'acctdel')

  // 10am local, well inside the fixture's working hours, comfortably ahead.
  const start = new Date(Date.now() + 30 * DAY_MS)
  start.setUTCHours(18, 0, 0, 0)

  const hold = await createHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds: [],
    consultId: consultSessionId,
    offering: proposalOffering(),
    requestedStart: start,
    requestedLocationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
  })

  const committed = await finalizeBookingFromHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    holdId: hold.hold.id,
    openingId: null,
    addOnIds: [],
    consultEnhancementLineIds: [],
    locationType: ServiceLocationType.SALON,
    source: BookingSource.REQUESTED,
    consultId: consultSessionId,
    initialStatus: getClientSubmittedBookingStatus(false),
    rebookOfBookingId: null,
    offering: proposalOffering(),
    discovery: null,
    cancellationPolicySnapshot: null,
    cancellationPolicyAcceptedAt: null,
    fallbackTimeZone: 'UTC',
    idempotencyKey: `acctdel-${Math.random().toString(36).slice(2)}`,
  })
  bookingId = committed.booking.id

  const proposal = await db.consultBookingProposal.findFirstOrThrow({
    where: { bookingId },
    select: { id: true, estimateId: true },
  })
  proposalId = proposal.id
  estimateId = proposal.estimateId
}, 120_000)

afterAll(async () => {
  await teardownLookConsultFixture(db, async () => {
    await db.accountDeletionRequest.deleteMany({
      where: { userId: fx.clientUserId },
    })
    await db.consultBookingProposal.deleteMany({ where: { consultSessionId } })
    await db.consultServiceEstimate.deleteMany({ where: { consultSessionId } })
    await db.booking.deleteMany({ where: { professionalId: fx.professionalId } })
    await db.bookingHold.deleteMany({
      where: { professionalId: fx.professionalId },
    })
  })
  await db.$disconnect()
})

describe('deleting a client who committed to a look', () => {
  // Without this the assertions below would pass just as happily against rows
  // that were never created — a green probe meaning NO DATA rather than DELETED.
  it('starts from a proposal that genuinely exists, behind two Restrict edges', async () => {
    expect(await db.consultBookingProposal.count({ where: { id: proposalId } })).toBe(1)
    expect(await db.consultServiceEstimate.count({ where: { id: estimateId } })).toBe(1)
    expect(await db.consultSession.count({ where: { id: consultSessionId } })).toBe(1)

    // And the edges really are Restrict — deleting the consult out from under
    // the proposal is refused by Postgres. This is the failure the deletion
    // used to hit, proved directly rather than assumed from the schema.
    await expect(
      db.consultSession.delete({ where: { id: consultSessionId } }),
    ).rejects.toThrow()
  })

  // 🔴 The whole point. Before the fix this raised the foreign-key violation,
  // `failed` came back 1, `completed` 0, and every other rule rolled back too.
  it('completes against a real database instead of failing on a foreign key', async () => {
    const requested = await requestAccountDeletion({ db, userId: fx.clientUserId })
    expect(requested.ok).toBe(true)

    const afterWindow = new Date(
      Date.now() + (ACCOUNT_DELETION_GRACE_PERIOD_DAYS + 1) * DAY_MS,
    )
    const swept = await executeDueAccountDeletions({ db, now: afterWindow })

    expect(swept.failed).toBe(0)
    expect(swept.completed).toBe(1)

    const request = await db.accountDeletionRequest.findFirstOrThrow({
      where: { userId: fx.clientUserId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })
    expect(request.status).toBe(AccountDeletionRequestStatus.COMPLETED)
  }, 60_000)

  it('takes the proposal with the consult it was derived from', async () => {
    expect(await db.consultBookingProposal.count({ where: { id: proposalId } })).toBe(0)
    expect(await db.consultServiceEstimate.count({ where: { id: estimateId } })).toBe(0)
    expect(await db.consultSession.count({ where: { id: consultSessionId } })).toBe(0)
  })

  it('leaves the professional’s booking record intact', async () => {
    // Booking is RETAIN: the pro's own record of the appointment survives the
    // client's erasure.
    expect(await db.booking.count({ where: { id: bookingId } })).toBe(1)
  })
})
