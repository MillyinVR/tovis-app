// tests/integration/consult-prep-deadline.test.ts
//
// P7a-4 — the prep deadline and its escalation, driven against real PostgreSQL.
//
// The unit tests prove the RULES. This suite exists because the rules are only
// half the feature: the other half is whether the rows actually get written on
// the write paths, whether the drain-time validator reaches the same verdict as
// the planner, and whether the two "stop" conditions really stop it. Every one
// of those is a claim about a database, and a mocked test of them would only
// prove the mock agrees with itself.
//
// What it walks, in the order the P7a-4 brief names:
//
//   1. book a spark consult with prep unanswered → the PRO's booking shows
//      prep incomplete, with the missing questions;
//   2. move the clock past each escalation → each reminder fires ONCE, and a
//      second drain of the same row does nothing;
//   3. answer the last safety question → prep completes, the thread says so,
//      and the pending reminders are cancelled;
//   4. cancel the booking → the reminders stop, including the ones nothing
//      eagerly cancelled.

import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultRevisionKind,
  NotificationEventKey,
  Prisma,
  PrismaClient,
  ServiceLocationType,
} from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConsultThreadMessageDTO } from '@/lib/dto/consult'

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

// The capture ingest path is real all the way to storage and the vision call.
// Faked exactly as every other consult suite fakes them, so the early photo
// this fixture takes is a real ACCEPTED capture without a network round-trip.
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
const { CONSULT_EARLY_PHOTO_SHOT_KEY } = await import(
  '@/lib/consult/capture/earlyPhoto'
)
const {
  cancelConsultPrepReminders,
  syncConsultPrepReminders,
  validateDueConsultPrepReminder,
} = await import('@/lib/notifications/consultPrepReminders')
const { loadProBookingPrepStatus, loadProBookingsPrepBadges } = await import(
  '@/lib/consult/proPrepStatus'
)
const { loadConsultPrepState } = await import('@/lib/consult/prepDeadline')
const { purgeConsultSessionRawObjects } = await import('@/lib/consult/capturePurge')
const { loadConsultThread } = await import('@/lib/consult/thread')
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

const db = new PrismaClient()

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

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

/**
 * A consult that has consented and taken its early photo, with NO intake at
 * all — the exact state the spark books in.
 *
 * The consent pair and the early photo are both real prerequisites the
 * database enforces (P7a-1: a consult cannot leave EARLY_PHOTO_READY without
 * one accepted `early_photo` capture), so this walks them rather than writing
 * rows that could not exist in production.
 */
let sparkCounter = 0
async function sparkConsult(): Promise<string> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  const label = `prep-${(sparkCounter += 1)}`
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
  return session.id
}

/**
 * Appointment instants that cannot collide.
 *
 * 🔴 Every booking in this suite belongs to the SAME pro, and
 * `Booking_no_active_professional_overlap` is a real exclusion constraint — two
 * tests that both want "ten days out" fight a rule that is protecting
 * something true. So the suite has two kinds of slot and they occupy disjoint
 * ranges:
 *
 *   * `farSlot()` — a month or more out, two days apart per call. Far enough
 *     that all three escalation stages are still in the future, which is what
 *     most of these tests need and the only thing they need.
 *   * `nearSlot()` — the two tests where "how soon" is the POINT: an
 *     appointment four days out (deadline in two, so the −72h stage is
 *     already gone) and one tomorrow (deadline already past). Both sit inside
 *     the first week, which `farSlot` never enters.
 */
let farCounter = 0
function farSlot(): Date {
  farCounter += 1
  return new Date(Date.now() + 30 * DAY + farCounter * 2 * DAY)
}

let nearCounter = 0
function nearSlot(offsetMs: number): Date {
  nearCounter += 1
  return new Date(Date.now() + offsetMs + nearCounter * HOUR)
}

/** The appointment the spark produced, linked the way P7a-2 links it. */
async function bookTheLook(
  sessionId: string,
  scheduledFor: Date,
  status: BookingStatus = BookingStatus.ACCEPTED,
): Promise<string> {
  const booking = await db.booking.create({
    data: {
      clientId: fx.clientId,
      professionalId: fx.professionalId,
      serviceId: fx.balayageServiceId,
      offeringId: fx.balayageOfferingId,
      status,
      scheduledFor,
      sourceConsultSessionId: sessionId,
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
  bookingIds.push(booking.id)
  return booking.id
}

/** Write an intake revision carrying exactly these answers. */
async function answer(
  sessionId: string,
  answers: Record<string, string>,
  label: string,
) {
  return appendConsultIntakeRevision({
    consultSessionId: sessionId,
    actor: client(),
    loadInput: async () => ({
      idempotencyKey: `prep-${label}-${Math.random().toString(36).slice(2)}`,
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: false,
      answers,
    }),
  })
}

async function pendingReminders(sessionId: string) {
  return db.scheduledClientNotification.findMany({
    where: {
      eventKey: NotificationEventKey.CONSULT_PREP_REMINDER,
      dedupeKey: { startsWith: `consult-prep:${sessionId}:` },
    },
    orderBy: { runAt: 'asc' },
    select: {
      id: true,
      dedupeKey: true,
      runAt: true,
      cancelledAt: true,
      processedAt: true,
    },
  })
}

/** Drain ONE due row exactly as the cron does, at `now`. */
async function drain(rowId: string, now: Date) {
  return db.$transaction(async (tx) => {
    const verdict = await validateDueConsultPrepReminder({
      tx,
      scheduledClientNotificationId: rowId,
      now,
    })
    if (verdict.action === 'PROCESS') {
      // The cron's own two steps: write the inbox row, stamp processed.
      await tx.clientNotification.create({
        data: {
          clientId: verdict.clientId,
          eventKey: NotificationEventKey.CONSULT_PREP_REMINDER,
          title: verdict.notification.title,
          body: verdict.notification.body,
          href: verdict.href,
          dedupeKey: verdict.dedupeKey,
        },
      })
      await tx.scheduledClientNotification.updateMany({
        where: { id: rowId, cancelledAt: null, processedAt: null },
        data: { processedAt: now },
      })
    }
    if (verdict.action === 'CANCEL') {
      await tx.scheduledClientNotification.updateMany({
        where: { id: rowId, cancelledAt: null, processedAt: null },
        data: { cancelledAt: now, lastError: verdict.reason },
      })
    }
    return verdict
  })
}

/** The client's thread, exactly as either client would read it. */
async function thread(consultSessionId: string) {
  return loadConsultThread({
    consultSessionId,
    clientId: fx.clientId,
    actorUserId: fx.clientUserId,
    copy: defaultClientConsultThreadCopy,
    captureCopy: defaultClientConsultCaptureCopy,
    inspirationCopy: defaultClientConsultInspirationCopy,
    planDiffCopy: defaultClientConsultPlanDiffCopy,
  })
}

function threadText(messages: readonly ConsultThreadMessageDTO[]): string[] {
  return messages.flatMap((message) =>
    message.kind === 'TEXT' ? [message.text] : [],
  )
}

async function inboxRows(sessionId: string) {
  return db.clientNotification.findMany({
    where: {
      clientId: fx.clientId,
      eventKey: NotificationEventKey.CONSULT_PREP_REMINDER,
      dedupeKey: { startsWith: `consult-prep:${sessionId}:` },
    },
    select: { dedupeKey: true, title: true, body: true },
  })
}

beforeAll(async () => {
  // 🔴 The CURRENT required agreement version is the highest one in the table,
  // and the fixture seeds its own at a random base. A sibling suite's leftover
  // rows can therefore outrank this fixture's, and every consent write then
  // fails AGREEMENT_VERSION_MISMATCH — a red suite about nothing. Clearing
  // first is safe here because the integration DB is single-tenant and
  // `fileParallelism: false` means no other suite is mid-run.
  await db.consultAgreementAcceptance.deleteMany({})
  await db.consultAgreementVersion.deleteMany({})
  await seedLookConsultFixture(db, { tagPrefix: 'p7a4_prep', bookable: true })
})

afterAll(async () => {
  await teardownLookConsultFixture(db, async () => {
    await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
    await db.scheduledClientNotification.deleteMany({
      where: { clientId: fx.clientId },
    })
    await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
    // Every session here stops at the intake, so nothing ever purged its raw
    // capture objects — and a database CHECK refuses to delete a session while
    // any remain unverified. The fixture's own loop only knows about sessions
    // `runConsultToCompletion` created, so these are purged by hand.
    for (const sessionId of new Set(sessionIds)) {
      await purgeConsultSessionRawObjects(sessionId)
      await db.consultSession.deleteMany({ where: { id: sessionId } })
    }
  })
  await db.$disconnect()
})

beforeEach(async () => {
  // 🔴 Per TEST, not per file: the integration config sets `mockReset: true`,
  // which wipes the implementation before each one. Setting this in
  // `beforeAll` leaves `requireClient()` returning undefined from the second
  // test onward, which surfaces as an opaque 500 from the capture route.
  vi.clearAllMocks()
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })

  await db.clientNotification.deleteMany({ where: { clientId: fx.clientId } })
  await db.scheduledClientNotification.deleteMany({
    where: { clientId: fx.clientId },
  })
})

describe('1 — the pro sees prep incomplete, with the list', () => {
  it('names every unanswered safety question on the pro’s booking', async () => {
    const sessionId = await sparkConsult()
    const bookingId = await bookTheLook(sessionId, farSlot())

    const status = await db.$transaction((tx) =>
      loadProBookingPrepStatus(tx, {
        bookingId,
        professionalId: fx.professionalId,
      }),
    )

    expect(status?.badge.kind).toBe('INCOMPLETE')
    expect(status?.badge.label).toBe('Prep incomplete')
    expect(status?.badge.significant).toBe(true)
    expect(status?.requiredCount).toBe(5)
    expect(status?.missing.map((item) => item.questionKey)).toEqual([
      'box_dye_history',
      'prior_lightening',
      'henna_plant_dye_history',
      'other_chemical_history',
      'prior_reaction',
    ])
    // 🔴 In the client's words. A pro shown a field name has been shown
    // nothing they can act on.
    for (const item of status?.missing ?? []) {
      expect(item.question).not.toContain('_')
      expect(item.question.endsWith('?')).toBe(true)
    }
    // And a deadline they can plan around.
    expect(status?.deadlineLabel).toBeTruthy()
  })

  it('🔴 is visible even though the consult is NOT completed', async () => {
    // The Brief loader filters to COMPLETED, which is exactly the state an
    // unfinished prep is not in. If prep were folded into the Brief the pro
    // would see nothing at all — the whole reason this is its own read.
    const sessionId = await sparkConsult()
    const bookingId = await bookTheLook(sessionId, farSlot())

    const session = await db.consultSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    })
    expect(session.status).not.toBe('COMPLETED')

    const status = await db.$transaction((tx) =>
      loadProBookingPrepStatus(tx, {
        bookingId,
        professionalId: fx.professionalId,
      }),
    )
    expect(status?.badge.kind).toBe('INCOMPLETE')
  })

  it('flags OVERDUE on the day, and does not block the booking', async () => {
    const sessionId = await sparkConsult()
    // The appointment is tomorrow, so the 48h deadline has already gone.
    const bookingId = await bookTheLook(
      sessionId,
      // Tomorrow: the 48h deadline has already gone.
      nearSlot(12 * HOUR),
    )

    const status = await db.$transaction((tx) =>
      loadProBookingPrepStatus(tx, {
        bookingId,
        professionalId: fx.professionalId,
      }),
    )
    expect(status?.badge.kind).toBe('OVERDUE')

    // Nothing about the appointment changed. It is a flag, not a gate.
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { status: true },
    })
    expect(booking.status).toBe(BookingStatus.ACCEPTED)
  })

  it('shows another pro’s booking as nothing at all', async () => {
    const sessionId = await sparkConsult()
    const bookingId = await bookTheLook(sessionId, farSlot())

    const status = await db.$transaction((tx) =>
      loadProBookingPrepStatus(tx, {
        bookingId,
        professionalId: 'some-other-pro',
      }),
    )
    expect(status).toBeNull()
  })

  it('batches the day’s flags without a query per booking', async () => {
    const a = await sparkConsult()
    const b = await sparkConsult()
    const bookingA = await bookTheLook(a, farSlot())
    const bookingB = await bookTheLook(b, farSlot())
    await answer(b, ALL_SAFETY_ANSWERS, 'batch-complete')

    const badges = await db.$transaction((tx) =>
      loadProBookingsPrepBadges(tx, {
        bookingIds: [bookingA, bookingB, 'a-booking-with-no-consult'],
        professionalId: fx.professionalId,
      }),
    )
    expect(badges.get(bookingA)?.kind).toBe('INCOMPLETE')
    expect(badges.get(bookingB)?.kind).toBe('COMPLETE')
    expect(badges.get('a-booking-with-no-consult')).toBeUndefined()
  })
})

describe('2 — the escalation fires once each', () => {
  it('schedules the three stages against the DEADLINE and fires each once', async () => {
    const sessionId = await sparkConsult()
    const scheduledFor = farSlot()
    await bookTheLook(sessionId, scheduledFor)
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )

    const rows = await pendingReminders(sessionId)
    expect(rows.map((row) => row.dedupeKey)).toEqual([
      `consult-prep:${sessionId}:AHEAD`,
      `consult-prep:${sessionId}:SOON`,
      `consult-prep:${sessionId}:DUE`,
    ])

    // Deadline = appointment − 48h; stages at −72h, −24h, 0 FROM THE DEADLINE.
    const deadline = scheduledFor.getTime() - 48 * HOUR
    expect(rows.map((row) => row.runAt.getTime())).toEqual([
      deadline - 72 * HOUR,
      deadline - 24 * HOUR,
      deadline,
    ])

    // Move the clock past each one in turn and drain it.
    for (const row of rows) {
      const verdict = await drain(row.id, new Date(row.runAt.getTime() + 60_000))
      expect(verdict.action).toBe('PROCESS')
    }

    const inbox = await inboxRows(sessionId)
    expect(inbox.map((row) => row.dedupeKey).sort()).toEqual(
      [
        `consult-prep:${sessionId}:AHEAD`,
        `consult-prep:${sessionId}:DUE`,
        `consult-prep:${sessionId}:SOON`,
      ].sort(),
    )
    // Each one says something different — an escalation, not three copies.
    expect(new Set(inbox.map((row) => row.title)).size).toBe(3)

    // 🔴 Draining the same rows AGAIN sends nothing. This is "fires once".
    for (const row of rows) {
      const verdict = await drain(row.id, new Date(row.runAt.getTime() + 2 * HOUR))
      expect(verdict.action).toBe('SKIP')
    }
    expect((await inboxRows(sessionId)).length).toBe(3)
  })

  it('never plans a stage that is already past', async () => {
    const sessionId = await sparkConsult()
    // Booked four days out: deadline is in two days, so the −72h stage is gone.
    await bookTheLook(sessionId, nearSlot(4 * DAY))
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )

    const rows = await pendingReminders(sessionId)
    expect(rows.map((row) => row.dedupeKey)).toEqual([
      `consult-prep:${sessionId}:SOON`,
      `consult-prep:${sessionId}:DUE`,
    ])
  })

  it('RE-ARMS rather than cancels when the appointment moves later', async () => {
    const sessionId = await sparkConsult()
    const bookingId = await bookTheLook(sessionId, farSlot())
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )
    const rows = await pendingReminders(sessionId)
    const firstRow = rows[0]
    if (!firstRow) throw new Error('expected a planned reminder to re-arm')

    // The client reschedules a fortnight out. Nothing re-planned the row.
    const movedTo = farSlot()
    await db.booking.update({
      where: { id: bookingId },
      data: { scheduledFor: movedTo },
    })

    const verdict = await drain(
      firstRow.id,
      new Date(firstRow.runAt.getTime() + 60_000),
    )
    // 🔴 Cancelling would be silent and terminal — she would simply lose the
    // reminder. Re-arming at the canonical instant is the recoverable answer.
    expect(verdict.action).toBe('RESCHEDULE')
    if (verdict.action === 'RESCHEDULE') {
      expect(verdict.runAt.getTime()).toBe(
        movedTo.getTime() - 48 * HOUR - 72 * HOUR,
      )
    }
    expect((await inboxRows(sessionId)).length).toBe(0)
  })
})

describe('3 — answering the last question stops it', () => {
  it('completes prep, says so in the thread, and cancels the pending rows', async () => {
    const sessionId = await sparkConsult()
    await bookTheLook(sessionId, farSlot())
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )
    expect((await pendingReminders(sessionId)).length).toBe(3)

    // Everything except the last one. Still incomplete, still scheduled.
    const { prior_reaction: _last, ...allButOne } = ALL_SAFETY_ANSWERS
    await answer(sessionId, allButOne, 'all-but-one')
    const midway = await db.$transaction((tx) =>
      loadConsultPrepState(tx, sessionId),
    )
    expect(midway?.prep.complete).toBe(false)
    expect(midway?.prep.missing.map((item) => item.questionKey)).toEqual([
      'prior_reaction',
    ])

    // The thread carries the DEADLINE while anything is outstanding, and not
    // the completion bubble.
    const midwayText = threadText((await thread(sessionId)).messages)
    expect(
      midwayText.some((text) =>
        text.startsWith('A few of these are the ones'),
      ),
    ).toBe(true)
    expect(midwayText.some((text) =>
      text.startsWith(defaultClientConsultThreadCopy.prepComplete.slice(0, defaultClientConsultThreadCopy.prepComplete.indexOf('{pro}'))),
    )).toBe(false)
    expect(
      (await pendingReminders(sessionId)).filter((row) => !row.cancelledAt).length,
    ).toBe(3)

    // The last answer lands.
    await answer(sessionId, ALL_SAFETY_ANSWERS, 'last')

    const after = await db.$transaction((tx) => loadConsultPrepState(tx, sessionId))
    expect(after?.prep.complete).toBe(true)
    expect(after?.prep.missing).toEqual([])

    // 🔴 And the thread SAYS so — a TEXT bubble, so both clients render it with
    // no change of their own. The deadline line is gone with it.
    const doneText = threadText((await thread(sessionId)).messages)
    expect(doneText.some((text) =>
      text.startsWith(defaultClientConsultThreadCopy.prepComplete.slice(0, defaultClientConsultThreadCopy.prepComplete.indexOf('{pro}'))),
    )).toBe(true)
    expect(
      doneText.some((text) => text.startsWith('A few of these are the ones')),
    ).toBe(false)

    // 🔴 The reminders are gone. The intake write is what cancels them, so
    // this proves the wiring and not just the rule.
    const rows = await pendingReminders(sessionId)
    expect(rows.every((row) => row.cancelledAt !== null)).toBe(true)

    // And a row that somehow survived would still refuse at drain.
    for (const row of rows) {
      await db.scheduledClientNotification.update({
        where: { id: row.id },
        data: { cancelledAt: null },
      })
      const verdict = await drain(row.id, new Date(row.runAt.getTime() + 60_000))
      expect(verdict).toMatchObject({ action: 'CANCEL', reason: 'PREP_COMPLETE' })
    }
    expect((await inboxRows(sessionId)).length).toBe(0)
  })

  it('shows the pro prep COMPLETE once the answers are in', async () => {
    const sessionId = await sparkConsult()
    const bookingId = await bookTheLook(sessionId, farSlot())
    await answer(sessionId, ALL_SAFETY_ANSWERS, 'pro-complete')

    const status = await db.$transaction((tx) =>
      loadProBookingPrepStatus(tx, {
        bookingId,
        professionalId: fx.professionalId,
      }),
    )
    expect(status?.badge.kind).toBe('COMPLETE')
    expect(status?.missing).toEqual([])
  })

  it('🔴 counts "not-sure" as an answer, and stops nagging', async () => {
    const sessionId = await sparkConsult()
    await bookTheLook(sessionId, farSlot())
    await answer(
      sessionId,
      { ...ALL_SAFETY_ANSWERS, box_dye_history: 'not-sure' },
      'not-sure',
    )

    const state = await db.$transaction((tx) => loadConsultPrepState(tx, sessionId))
    expect(state?.prep.complete).toBe(true)
    expect(
      (await pendingReminders(sessionId)).filter((row) => !row.cancelledAt),
    ).toEqual([])
  })
})

describe('4 — cancelling the booking stops it', () => {
  it('refuses at drain once the booking is cancelled', async () => {
    const sessionId = await sparkConsult()
    const bookingId = await bookTheLook(sessionId, farSlot())
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )
    const rows = await pendingReminders(sessionId)
    expect(rows.length).toBe(3)

    // A cancel that did NOT eagerly clear the rows — the case the drain-time
    // validator exists for (cancelImportedBookingIfPristine takes this shape).
    await db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    })

    for (const row of rows) {
      const verdict = await drain(row.id, new Date(row.runAt.getTime() + 60_000))
      expect(verdict).toMatchObject({
        action: 'CANCEL',
        reason: 'BOOKING_NOT_REMINDABLE',
      })
    }
    expect((await inboxRows(sessionId)).length).toBe(0)
  })

  it('refuses at drain once the appointment has started', async () => {
    const sessionId = await sparkConsult()
    const bookingId = await bookTheLook(sessionId, farSlot())
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )
    const dueRows = await pendingReminders(sessionId)
    const row = dueRows[0]
    if (!row) throw new Error('expected a planned reminder to validate')

    await db.booking.update({
      where: { id: bookingId },
      data: { scheduledFor: new Date(Date.now() - HOUR) },
    })

    const verdict = await drain(row.id, new Date())
    expect(verdict).toMatchObject({ action: 'CANCEL' })
    expect((await inboxRows(sessionId)).length).toBe(0)
  })

  it('cancels eagerly when asked, and is idempotent', async () => {
    const sessionId = await sparkConsult()
    await bookTheLook(sessionId, farSlot())
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )

    for (let i = 0; i < 2; i += 1) {
      await db.$transaction((tx) =>
        cancelConsultPrepReminders({
          tx,
          consultSessionId: sessionId,
          clientId: fx.clientId,
        }),
      )
    }
    const rows = await pendingReminders(sessionId)
    expect(rows.length).toBe(3)
    expect(rows.every((row) => row.cancelledAt !== null)).toBe(true)
  })

  it('plans nothing at all for a consult with no appointment yet', async () => {
    const sessionId = await sparkConsult()
    await db.$transaction((tx) =>
      syncConsultPrepReminders({ tx, consultSessionId: sessionId }),
    )
    expect(await pendingReminders(sessionId)).toEqual([])

    const state = await db.$transaction((tx) => loadConsultPrepState(tx, sessionId))
    expect(state?.prep.deadlineAt).toBeNull()
    expect(state?.prep.complete).toBe(false)
  })
})

describe('the revisions the rule reads', () => {
  it('reads the NEWEST intake revision, not the first', async () => {
    const sessionId = await sparkConsult()
    await bookTheLook(sessionId, farSlot())

    await answer(sessionId, { change_scale: 'noticeable' }, 'first')
    await answer(sessionId, ALL_SAFETY_ANSWERS, 'second')

    const revisions = await db.consultRevision.count({
      where: { consultSessionId: sessionId, kind: ConsultRevisionKind.INTAKE },
    })
    expect(revisions).toBeGreaterThanOrEqual(2)

    const state = await db.$transaction((tx) => loadConsultPrepState(tx, sessionId))
    expect(state?.prep.complete).toBe(true)
  })
})
