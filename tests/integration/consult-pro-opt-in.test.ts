// tests/integration/consult-pro-opt-in.test.ts
//
// P7a-5 — the pro's per-category setting, driven against real PostgreSQL.
//
// The unit suites prove the RULES (categoryDeposit.test.ts, sparkGate.test.ts,
// threadCopy.test.ts). This one exists because the rules are half the feature.
// The other half is four claims about a database:
//
//   1. a pro set to "After they finish prep" produces a CTA that is visible,
//      disabled, and says why — in her own name;
//   2. answering the safety questions RELEASES it, in the same consult;
//   3. the refusal is real on the SERVER, so a request that never met the
//      button creates no booking either — a disabled button is not a control;
//   4. a $25 category deposit reaches the booking as a stamped $25, and a pro
//      with NO settings at all is byte-for-byte unchanged.
//
// Every one of those is a claim a mocked test could only make about its own
// mock, and (4) is the one Tori's brief calls out as the regression that would
// matter most.

import {
  BookingSource,
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  Prisma,
  PrismaClient,
  ProCategoryBookingGate,
  ServiceLocationType,
} from '@prisma/client'
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
  return { ...original, checkConsultCapture: fakes.fakeCheckConsultCapture }
})

const { acceptConsultAgreement, appendConsultIntakeRevision } = await import(
  '@/lib/consult/writeBoundary'
)
const { createHold, finalizeBookingFromHold } = await import(
  '@/lib/booking/writeBoundary'
)
const { resolveDiscoveryFinalize } = await import(
  '@/lib/booking/resolveDiscoveryFinalize'
)
const { CONSULT_EARLY_PHOTO_SHOT_KEY } = await import(
  '@/lib/consult/capture/earlyPhoto'
)
const { loadConsultThread } = await import('@/lib/consult/thread')
const { loadConsultPrepState } = await import('@/lib/consult/prepDeadline')
const { DEPOSIT_CREDIT_SELECT, deriveDepositCredit } = await import(
  '@/lib/booking/depositCredit'
)
const { purgeConsultSessionRawObjects } = await import(
  '@/lib/consult/capturePurge'
)
const { defaultClientConsultThreadCopy } = await import(
  '@/lib/brand/defaultClientConsultThreadCopy'
)
const { defaultClientConsultCaptureCopy } = await import(
  '@/lib/brand/defaultClientConsultCaptureCopy'
)
const { defaultClientConsultInspirationCopy } = await import(
  '@/lib/brand/defaultClientConsultInspirationCopy'
)
const { defaultClientConsultPlanDiffCopy } = await import(
  '@/lib/brand/defaultClientConsultPlanDiffCopy'
)
const { resetConsultLookFakes } = await import('./_support/consultLookFakes')
const {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} = await import('@/lib/consult/intake/packs/hairColor')
const {
  fx,
  seedLookConsultFixture,
  teardownLookConsultFixture,
  createLook,
  attachAcceptedCapture,
  BALAYAGE_PRICE,
  ZONE,
} = await import('./_support/lookConsultFixture')

const { minutesSinceMidnightInTimeZone } = await import('@/lib/time')

const db = new PrismaClient()
const DAY = 24 * 60 * 60 * 1000

/** Every safety answer the current colour pack asks. */
const ALL_SAFETY_ANSWERS = {
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: '6-12-months',
  henna_plant_dye_history: 'never',
  other_chemical_history: 'never',
  prior_reaction: 'no',
}

function client() {
  return { type: ConsultActorType.CLIENT, id: fx.clientUserId }
}

const sessionIds: string[] = []
const bookingIds: string[] = []
const holdIds: string[] = []

beforeAll(async () => {
  // BOOKABLE, because half this suite books. Without the working hours, geo and
  // address a real `createHold` refuses with PRO_NOT_READY long before it ever
  // reaches the gate — which would make every deposit assertion below vacuous.
  await seedLookConsultFixture(db, {
    tagPrefix: 'p7a5_opt_in',
    workingHours: {
      mon: { enabled: true, start: '09:00', end: '18:00' },
      tue: { enabled: true, start: '09:00', end: '18:00' },
      wed: { enabled: true, start: '09:00', end: '18:00' },
      thu: { enabled: true, start: '09:00', end: '18:00' },
      fri: { enabled: true, start: '09:00', end: '18:00' },
      sat: { enabled: true, start: '09:00', end: '18:00' },
      sun: { enabled: true, start: '09:00', end: '18:00' },
    },
    advanceNoticeMinutes: 0,
    maxDaysAhead: 365,
    bookable: true,
    withSafetyOfferings: true,
  })
})

beforeEach(async () => {
  // 🔴 Per TEST, not per file: the integration config sets `mockReset: true`,
  // so an implementation set once in `beforeAll` is gone by the second test and
  // `requireClient()` starts returning undefined — which surfaces as an opaque
  // 500 from the capture route rather than as an auth failure. (It cost this
  // suite a full debugging round; the note is in consult-prep-deadline too.)
  vi.clearAllMocks()
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })
  // Each test states the world it needs. Deleting BOTH rows between tests is
  // what keeps "a pro with no settings" a real state rather than a leftover.
  await db.proCategoryBookingPolicy.deleteMany({
    where: { professionalId: fx.professionalId },
  })
  await db.professionalPaymentSettings.deleteMany({
    where: { professionalId: fx.professionalId },
  })
})

afterAll(async () => {
  await teardownLookConsultFixture(db, async () => {
    await db.proCategoryBookingPolicy.deleteMany({
      where: { professionalId: fx.professionalId },
    })
    await db.professionalPaymentSettings.deleteMany({
      where: { professionalId: fx.professionalId },
    })
    // Bookings before sessions: a booking points at its consult
    // (`sourceConsultSessionId`), and holds outlive a failed finalize.
    await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
    await db.bookingHold.deleteMany({ where: { id: { in: holdIds } } })

    // 🔴 DELETED, not just purged. The fixture's own cleanup loop only knows
    // about sessions `runConsultToCompletion` created; these were made directly
    // with `consultSession.create`, so it never sees them.
    //
    // Leaving them behind is not a tidiness problem, and the failure does not
    // land here. `ServiceCategory` cannot be deleted while a session references
    // it, so the fixture's own category delete throws — and the next suite that
    // wipes categories wholesale (`bookingConcurrency`) dies on
    // `ConsultSession_serviceCategoryId_fkey` in a file that has nothing to do
    // with this one. `consult-prep-deadline.test.ts` records the same trap.
    for (const sessionId of new Set(sessionIds)) {
      await purgeConsultSessionRawObjects(sessionId)
      await db.consultSession.deleteMany({ where: { id: sessionId } })
    }
  })
  await db.$disconnect()
})

/** A consult that has consented and taken its early photo — the spark state. */
let sparkCounter = 0
async function sparkConsult(): Promise<{ sessionId: string; lookPostId: string }> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  // The look carries the price the CTA quotes. `LookPost.priceStartingAt` is
  // mode-free, which is why it is the honest number at a spark where no
  // salon/mobile choice has been made.
  await db.lookPost.update({
    where: { id: lookPostId },
    data: { priceStartingAt: new Prisma.Decimal(BALAYAGE_PRICE) },
  })

  const label = `optin-${(sparkCounter += 1)}`
  const session = await db.consultSession.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceCategoryId: fx.categoryId,
      anchorLookPostId: lookPostId,
    },
    select: { id: true },
  })
  sessionIds.push(session.id)

  for (const [expectedKind, agreementVersionId] of [
    [ConsultAgreementKind.SENSITIVE_DATA_CONSENT, fx.consentVersionId],
    [ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION, fx.adultVersionId],
  ] as const) {
    await acceptConsultAgreement({
      consultSessionId: session.id,
      actor: client(),
      expectedKind,
      agreementVersionId,
    })
  }
  await attachAcceptedCapture(
    db,
    session.id,
    CONSULT_EARLY_PHOTO_SHOT_KEY,
    `early-${label}`,
  )
  return { sessionId: session.id, lookPostId }
}

async function thread(sessionId: string) {
  return loadConsultThread({
    consultSessionId: sessionId,
    clientId: fx.clientId,
    actorUserId: fx.clientUserId,
    copy: defaultClientConsultThreadCopy,
    captureCopy: defaultClientConsultCaptureCopy,
    inspirationCopy: defaultClientConsultInspirationCopy,
    planDiffCopy: defaultClientConsultPlanDiffCopy,
  })
}

async function answerSafety(sessionId: string, label: string) {
  return appendConsultIntakeRevision({
    consultSessionId: sessionId,
    actor: client(),
    loadInput: async () => ({
      idempotencyKey: `optin-${label}-${Math.random().toString(36).slice(2)}`,
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: false,
      answers: ALL_SAFETY_ANSWERS,
    }),
  })
}

async function setGate(gate: ProCategoryBookingGate) {
  await db.proCategoryBookingPolicy.upsert({
    where: {
      professionalId_serviceCategoryId: {
        professionalId: fx.professionalId,
        serviceCategoryId: fx.categoryId,
      },
    },
    create: {
      professionalId: fx.professionalId,
      serviceCategoryId: fx.categoryId,
      bookingGate: gate,
    },
    update: { bookingGate: gate },
  })
}

/** A pro who can actually take a charge, with an account-wide deposit. */
async function enableAccountDeposit(args: {
  type: 'FLAT' | 'PERCENT'
  flat?: string
  percent?: number
  scope?: 'NEW_DISCOVERY_ONLY' | 'ALL_CLIENTS'
}) {
  await db.professionalPaymentSettings.upsert({
    where: { professionalId: fx.professionalId },
    create: {
      professionalId: fx.professionalId,
      depositEnabled: true,
      depositType: args.type,
      depositFlatAmount: args.flat ? new Prisma.Decimal(args.flat) : null,
      depositPercent: args.percent ?? null,
      depositScope: args.scope ?? 'ALL_CLIENTS',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
    update: {
      depositEnabled: true,
      depositType: args.type,
      depositFlatAmount: args.flat ? new Prisma.Decimal(args.flat) : null,
      depositPercent: args.percent ?? null,
      depositScope: args.scope ?? 'ALL_CLIENTS',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  })
}

async function setCategoryDeposit(args: {
  type: 'FLAT' | 'PERCENT'
  flat?: string
  percent?: number
}) {
  await db.proCategoryBookingPolicy.upsert({
    where: {
      professionalId_serviceCategoryId: {
        professionalId: fx.professionalId,
        serviceCategoryId: fx.categoryId,
      },
    },
    create: {
      professionalId: fx.professionalId,
      serviceCategoryId: fx.categoryId,
      depositType: args.type,
      depositFlatAmount: args.flat ? new Prisma.Decimal(args.flat) : null,
      depositPercent: args.percent ?? null,
    },
    update: {
      depositType: args.type,
      depositFlatAmount: args.flat ? new Prisma.Decimal(args.flat) : null,
      depositPercent: args.percent ?? null,
    },
  })
}

function offering() {
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

/** A future UTC instant at exactly `hh:mm` LOCAL in the fixture's zone. */
function futureLocal(daysAhead: number, hh: number, mm = 0): Date {
  const anchor = new Date()
  anchor.setUTCDate(anchor.getUTCDate() + daysAhead)
  anchor.setUTCHours(20, 0, 0, 0)
  const anchorLocalMinutes = minutesSinceMidnightInTimeZone(anchor, ZONE)
  return new Date(anchor.getTime() + (hh * 60 + mm - anchorLocalMinutes) * 60_000)
}

/**
 * A bookable slot, one per call.
 *
 * 🔴 A DIFFERENT DAY each time, at a 30-minute boundary inside working hours.
 * Every booking in this suite belongs to the same pro, so
 * `Booking_no_active_professional_overlap` is a real exclusion constraint —
 * and an arbitrary `Date.now() + n` fails the scheduling grid with
 * STEP_MISMATCH long before it reaches anything this suite is about.
 */
let slotCounter = 0
function slot(): Date {
  slotCounter += 1
  return futureLocal(40 + slotCounter * 2, 10, 0)
}

/** Book the look the way the spark books it: ordinary path + the consult id. */
async function bookTheSpark(args: { sessionId: string; lookPostId: string }) {
  const start = slot()
  const hold = await createHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    addOnIds: [],
    consultId: null,
    offering: offering(),
    requestedStart: start,
    requestedLocationId: fx.locationId,
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
  })
  holdIds.push(hold.hold.id)

  // 🔴 The REAL directive, from the function the CTA's preview also calls.
  // Building a fake one here would prove nothing about the thing this slice
  // changed — and the spark link needs it for a second reason: it compares the
  // consult's anchor against the SERVER-RESOLVED source look, which only the
  // directive carries. Passing `discovery: null` refuses every spark with
  // CONSULT_LINK_MISMATCH, which is correct and is not what these tests are for.
  const discovery = await resolveDiscoveryFinalize({
    clientId: fx.clientId,
    clientUserId: fx.clientUserId,
    professionalId: fx.professionalId,
    offeringId: fx.balayageOfferingId,
    lookPostId: args.lookPostId,
    mediaId: null,
    source: BookingSource.DISCOVERY,
    aftercare: false,
  })

  const finalized = await finalizeBookingFromHold({
    clientId: fx.clientId,
    bookingEntryPoint: 'DIRECT_PROFILE',
    holdId: hold.hold.id,
    openingId: null,
    addOnIds: [],
    consultEnhancementLineIds: [],
    locationType: ServiceLocationType.SALON,
    source: BookingSource.DISCOVERY,
    consultId: null,
    sparkConsultId: args.sessionId,
    initialStatus: BookingStatus.PENDING,
    rebookOfBookingId: null,
    offering: offering(),
    discovery,
    cancellationPolicySnapshot: null,
    cancellationPolicyAcceptedAt: null,
    fallbackTimeZone: 'UTC',
    idempotencyKey: `p7a5-${Math.random().toString(36).slice(2)}`,
  })
  bookingIds.push(finalized.booking.id)
  return finalized.booking.id
}

async function refusalCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (typeof code === 'string') return code
    throw error
  }
  return 'NO_REFUSAL'
}

describe('P7a-5 — the pro books this category after prep', () => {
  it('a pro with NO settings is exactly as she was: the CTA is live', async () => {
    // The control, and the scenario Tori named as the one that must not
    // regress. No policy row exists for this pro at all.
    const { sessionId } = await sparkConsult()

    const t = await thread(sessionId)
    expect(t.book.enabled).toBe(true)
    expect(t.book.reason).toBeNull()
    expect(t.book.gateNote).toBeNull()
  })

  it('AFTER_PREP disables the CTA and says why, in the pro’s own name', async () => {
    await setGate(ProCategoryBookingGate.AFTER_PREP)
    const { sessionId } = await sparkConsult()

    const t = await thread(sessionId)
    expect(t.book.enabled).toBe(false)
    expect(t.book.reason).toBe('PREP_REQUIRED')
    // Server-composed: it carries the pro's display name, so neither client
    // has to fill a slot and the two cannot word it differently.
    // Asserted against the thread's OWN display name rather than a literal:
    // that proves the note is filled with the same name the thread reports,
    // which is the property that matters. A hardcoded name would only prove
    // what this fixture happens to be called.
    expect(t.book.gateNote).toBe(
      `${t.professionalDisplayName} asks clients to finish a few questions first.`,
    )
    expect(t.book.gateNote).toContain('finish a few questions first')
  })

  it('answering the safety questions RELEASES the CTA', async () => {
    await setGate(ProCategoryBookingGate.AFTER_PREP)
    const { sessionId } = await sparkConsult()

    expect((await thread(sessionId)).book.enabled).toBe(false)

    await answerSafety(sessionId, 'release')

    // The rule the gate reads, asserted directly: if this were still
    // incomplete the CTA test below would pass for the wrong reason.
    const { prep } = (await loadConsultPrepState(db, sessionId))!
    expect(prep.missing).toEqual([])
    expect(prep.complete).toBe(true)

    const after = await thread(sessionId)
    expect(after.book.enabled).toBe(true)
    expect(after.book.reason).toBeNull()
    expect(after.book.gateNote).toBeNull()
  })

  it('refuses the BOOKING, not just the button, while prep is outstanding', async () => {
    // The point of the setting is that the slot is not taken. A disabled
    // button that a hand-made request walks straight past would leave the pro
    // with exactly the appointment she asked not to have.
    await setGate(ProCategoryBookingGate.AFTER_PREP)
    const { sessionId, lookPostId } = await sparkConsult()

    const code = await refusalCode(() =>
      bookTheSpark({ sessionId, lookPostId }),
    )
    expect(code).toBe('CONSULT_PREP_REQUIRED')

    // And nothing was created — the refusal aborts the finalize transaction
    // rather than unlinking a booking that already holds the slot.
    const bookings = await db.booking.count({
      where: { sourceConsultSessionId: sessionId },
    })
    expect(bookings).toBe(0)
  })

  it('lets the same request through once prep is in', async () => {
    await setGate(ProCategoryBookingGate.AFTER_PREP)
    const { sessionId, lookPostId } = await sparkConsult()
    await answerSafety(sessionId, 'through')

    const bookingId = await bookTheSpark({ sessionId, lookPostId })
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { sourceConsultSessionId: true },
    })
    expect(booking.sourceConsultSessionId).toBe(sessionId)
  })

  it('an INSTANT pro is never gated, prep or no prep', async () => {
    await setGate(ProCategoryBookingGate.INSTANT)
    const { sessionId, lookPostId } = await sparkConsult()

    expect((await thread(sessionId)).book.enabled).toBe(true)
    const bookingId = await bookTheSpark({ sessionId, lookPostId })
    expect(bookingId).toBeTruthy()
  })
})

describe('P7a-5 — the per-category deposit', () => {
  it('a $25 colour deposit is what the CTA says AND what the booking stamps', async () => {
    // Tori's third scenario, end to end: her account rule is $40, the colour
    // category says $25, and $25 is what both the disclosure and the charge
    // must agree on.
    await enableAccountDeposit({ type: 'FLAT', flat: '40.00' })
    await setCategoryDeposit({ type: 'FLAT', flat: '25.00' })

    const { sessionId, lookPostId } = await sparkConsult()

    const t = await thread(sessionId)
    expect(t.book.priceNote).toContain('$25.00 deposit')
    expect(t.book.priceNote).not.toContain('$40')

    const bookingId = await bookTheSpark({ sessionId, lookPostId })
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { depositAmount: true, depositStatus: true },
    })
    expect(booking.depositAmount?.toString()).toBe('25')
    expect(booking.depositStatus).toBe('PENDING')

    // ── "applied to the first session's total at checkout" ────────────────
    //
    // The other half of Tori's deposit ask, proven on the REAL row rather than
    // on a fixture. `deriveDepositCredit` is the canonical answer to "how much
    // of the bill has the up-front deposit already covered", and it is what
    // the client's final-bill checkout and the zero-due closeout both read.
    //
    // 🔴 PENDING credits NOTHING — a deposit checkout that has not been paid
    // holds no money — so this marks it PAID first, which is exactly what the
    // Stripe webhook does. That transition is pre-existing, unchanged plumbing;
    // what is being proven here is that the £25 THIS SLICE sized comes off the
    // total, and that a client who paid it is not billed for it twice.
    await db.booking.update({
      where: { id: bookingId },
      data: { depositStatus: 'PAID' },
    })
    const paid = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: DEPOSIT_CREDIT_SELECT,
    })
    const credit = deriveDepositCredit(paid)
    expect(credit.creditCents).toBe(2500)
    expect(credit.amountDueCents).toBe(credit.totalCents - 2500)
    expect(credit.coversTotal).toBe(false)
  })

  it('the confirmation bubble names the deposit once it is stamped', async () => {
    await enableAccountDeposit({ type: 'FLAT', flat: '40.00' })
    await setCategoryDeposit({ type: 'FLAT', flat: '25.00' })

    const { sessionId, lookPostId } = await sparkConsult()
    await bookTheSpark({ sessionId, lookPostId })

    const t = await thread(sessionId)
    const booked = t.messages.find((message) => message.kind === 'BOOKING')
    expect(booked?.text).toContain('$25.00 deposit')
    // And the standing refund rule, said plainly rather than left to be found
    // out at cancellation.
    expect(booked?.text).toContain('24 hours')
  })

  it('a PERCENT category deposit is disclosed as a PERCENTAGE, never as dollars', async () => {
    // There is no subtotal at the spark — no location mode, no add-ons — so a
    // dollar figure here would be a guess presented as a promise.
    await enableAccountDeposit({ type: 'FLAT', flat: '40.00' })
    await setCategoryDeposit({ type: 'PERCENT', percent: 20 })

    const { sessionId } = await sparkConsult()

    const t = await thread(sessionId)
    expect(t.book.priceNote).toContain('20% deposit')
    expect(t.book.priceNote).not.toMatch(/\$\d+\.\d\d deposit/)
  })

  it('and a PERCENT category deposit is CHARGED at that percentage', async () => {
    // The other half of the percentage case: the CTA can only honestly show
    // "20%", but the booking has a subtotal by then, so this asserts the money
    // — 20% of the $180 balayage — actually lands on the row. Without it the
    // suite would prove the sentence and leave the charge unproven.
    await enableAccountDeposit({ type: 'FLAT', flat: '40.00' })
    await setCategoryDeposit({ type: 'PERCENT', percent: 20 })

    const { sessionId, lookPostId } = await sparkConsult()
    const bookingId = await bookTheSpark({ sessionId, lookPostId })

    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { depositAmount: true, subtotalSnapshot: true },
    })
    const subtotal = Number(booking.subtotalSnapshot)
    expect(subtotal).toBe(Number(BALAYAGE_PRICE))
    // 20% of the subtotal, not 20% of the account's $40 and not the $40 itself.
    expect(Number(booking.depositAmount)).toBeCloseTo(subtotal * 0.2, 2)
  })

  it('falls back to the ACCOUNT amount for a category with no row', async () => {
    await enableAccountDeposit({ type: 'FLAT', flat: '40.00' })

    const { sessionId, lookPostId } = await sparkConsult()
    expect((await thread(sessionId)).book.priceNote).toContain('$40.00 deposit')

    const bookingId = await bookTheSpark({ sessionId, lookPostId })
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { depositAmount: true },
    })
    expect(booking.depositAmount?.toString()).toBe('40')
  })

  it('a category amount NEVER turns deposits on for a pro who has them off', async () => {
    // The safety property. She has typed $25 against colour but never switched
    // deposits on (the write route refuses to reach this state, so this is the
    // hand-written row that route exists to prevent) — and no money moves.
    await setCategoryDeposit({ type: 'FLAT', flat: '25.00' })

    const { sessionId, lookPostId } = await sparkConsult()
    expect((await thread(sessionId)).book.priceNote).not.toContain('deposit')

    const bookingId = await bookTheSpark({ sessionId, lookPostId })
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { depositAmount: true, depositStatus: true },
    })
    expect(booking.depositStatus).toBe('NONE')
    expect(booking.depositAmount).toBeNull()
  })

  it('says nothing about a deposit this client does not owe', async () => {
    // Default NEW_DISCOVERY_ONLY scope with an established pair: the pro has a
    // deposit configured, this booking owes none, and the CTA must agree with
    // the charge rather than with the configuration.
    await enableAccountDeposit({
      type: 'FLAT',
      flat: '40.00',
      scope: 'NEW_DISCOVERY_ONLY',
    })
    const { sessionId, lookPostId } = await sparkConsult()
    // One completed booking makes the pair established.
    const past = await db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.balayageServiceId,
        offeringId: fx.balayageOfferingId,
        status: BookingStatus.COMPLETED,
        scheduledFor: new Date(Date.now() - 30 * DAY),
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal(BALAYAGE_PRICE),
        totalAmount: new Prisma.Decimal(BALAYAGE_PRICE),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
      },
      select: { id: true },
    })
    bookingIds.push(past.id)

    const t = await thread(sessionId)
    expect(t.book.priceNote).not.toContain('deposit')
    // The price half still shows — only the money half went quiet.
    expect(t.book.priceNote).toContain('From')
    void lookPostId
  })
})
