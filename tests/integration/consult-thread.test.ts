// tests/integration/consult-thread.test.ts
//
// P5a — the consult THREAD projection, driven against real PostgreSQL.
//
// The projection is the ordering rule and the resume pointer for BOTH clients.
// Everything it claims is a claim about real flow state, so a mocked unit test
// would only prove that the mock agrees with itself. What this suite exists to
// prove:
//
//   * the thread ADVANCES with the flow — consent, then intake one question at
//     a time, then inspiration and photos, then the plan;
//   * `nextOpenMessageId` names exactly ONE message, and it is the one the
//     client has to act on. That single field is what makes "reopening resumes
//     at the next open step" true, and nothing else in the repo asserts it;
//   * the sticky Book CTA unlocks on the SELFIE and not on the analysis — the
//     spark, per the handoff. A regression that quietly re-gated it on the
//     estimate would look identical in every other test;
//   * a consult with no answers yet does not leak the whole question pack into
//     the thread. A thread that renders every unanswered question is a form.

import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  Prisma,
  PrismaClient,
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

import { POST as startLookConsult } from '@/app/api/v1/client/consult/look/route'
import { defaultClientConsultCaptureCopy } from '@/lib/brand/defaultClientConsultCaptureCopy'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { answerConsultInspirationQuestion } from '@/lib/consult/inspirationContract'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'
import { purgeConsultSessionRawObjects } from '@/lib/consult/capturePurge'
import { loadConsultThread } from '@/lib/consult/thread'
import {
  acceptConsultAgreement,
  appendConsultIntakeRevision,
} from '@/lib/consult/writeBoundary'
import type { ConsultThreadMessageDTO } from '@/lib/dto/consult'

import { resetConsultLookFakes } from './_support/consultLookFakes'
import {
  BALAYAGE_PRICE,
  INSPIRATION_ANSWERS,
  ZONE,
  attachAcceptedCapture,
  body,
  completeAnswers,
  createLook,
  fx,
  jsonRequest,
  runConsultToCompletion,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

const copy = defaultClientConsultThreadCopy

beforeAll(async () => {
  await seedLookConsultFixture(db, { tagPrefix: 'p5a_thread' })
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

afterAll(async () => {
  // Sessions this suite drives PARTIALLY never reach the analysis, so nothing
  // ever purged their raw capture objects — and a database CHECK refuses to
  // delete a session while any remain unverified. The fixture's own loop only
  // knows about sessions `runConsultToCompletion` created, so these are purged
  // here, through the `extra` hook that runs before it.
  await teardownLookConsultFixture(db, async () => {
    for (const sessionId of new Set(startedSessionIds)) {
      await purgeConsultSessionRawObjects(sessionId)
      await db.consultSession.deleteMany({ where: { id: sessionId } })
    }
  })
  await db.$disconnect()
})

function thread(consultSessionId: string) {
  return loadConsultThread({
    consultSessionId,
    clientId: fx.clientId,
    actorUserId: fx.clientUserId,
    copy,
    captureCopy: defaultClientConsultCaptureCopy,
  })
}

/** The messages of one kind, in thread order. */
function ofKind<K extends ConsultThreadMessageDTO['kind']>(
  messages: ConsultThreadMessageDTO[],
  kind: K,
): Extract<ConsultThreadMessageDTO, { kind: K }>[] {
  return messages.filter(
    (m): m is Extract<ConsultThreadMessageDTO, { kind: K }> => m.kind === kind,
  )
}

/** Sessions this suite created directly, for teardown to purge. */
const startedSessionIds: string[] = []

async function startConsult(): Promise<string> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  const created = await startLookConsult(
    jsonRequest('/api/v1/client/consult/look', { lookPostId }),
  )
  expect(created.status).toBe(200)
  const sessionId = ((await body(created)).consult as { id: string }).id
  startedSessionIds.push(sessionId)
  return sessionId
}

async function acceptBothAgreements(sessionId: string) {
  await acceptConsultAgreement({
    consultSessionId: sessionId,
    agreementVersionId: fx.consentVersionId,
    expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
    actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
  })
  await acceptConsultAgreement({
    consultSessionId: sessionId,
    agreementVersionId: fx.adultVersionId,
    expectedKind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
    actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
  })
}

describe('consult thread projection', () => {
  it('opens on consent, and consent is the one open step', async () => {
    const sessionId = await startConsult()
    const t = await thread(sessionId)

    expect(t.messages[0]?.kind).toBe('TEXT')
    const consent = ofKind(t.messages, 'CONSENT')
    expect(consent).toHaveLength(1)
    expect(consent[0]?.state).toBe('OPEN')
    expect(consent[0]?.requirements).toHaveLength(2)

    // The resume pointer names it, and nothing past consent has been emitted:
    // the intake loader itself refuses to read before the agreements are
    // current, so a thread that showed questions here would be showing state
    // the server will not serve.
    expect(t.nextOpenMessageId).toBe('consent')
    expect(ofKind(t.messages, 'QUESTION')).toHaveLength(0)
    expect(ofKind(t.messages, 'PHOTO_REQUEST')).toHaveLength(0)
  })

  // 🔴 Handoff B6: the flow is look-based and never named the service, so the
  // client could not answer questions about it. The naming used to live in the
  // iOS intake header; in a thread the app's sentences are composed SERVER-side,
  // so this is where that regression has to be guarded now.
  it('names the service in the opening bubble, in the app’s own voice', async () => {
    const sessionId = await startConsult()
    const t = await thread(sessionId)

    const opening = t.messages[0]
    expect(opening?.kind).toBe('TEXT')
    expect(opening && 'author' in opening && opening.author).toBe('APP')
    // The service-aware variant was chosen, not the generic one.
    const openingText = opening && 'text' in opening ? opening.text : ''
    expect(openingText).toContain('what it would take on your')
    expect(openingText).not.toBe(copy.opening)
  })

  it('names the professional, and greets in the app’s own voice', async () => {
    const sessionId = await startConsult()
    const t = await thread(sessionId)

    expect(t.professionalDisplayName).toBeTruthy()
    expect(t.professionalDisplayName).not.toBe(copy.proFallback)
    // The consent bubble is addressed ABOUT the pro, never AS her.
    const consent = ofKind(t.messages, 'CONSENT')[0]
    expect(consent?.text).toContain(t.professionalDisplayName)
  })

  it('asks intake ONE question at a time, and never renders the whole pack', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)

    const t = await thread(sessionId)
    const questions = ofKind(t.messages, 'QUESTION')

    // Nothing answered yet: exactly one question is on screen, and it is open.
    expect(questions).toHaveLength(1)
    expect(questions[0]?.state).toBe('OPEN')
    expect(questions[0]?.answer).toBeNull()
    expect(t.nextOpenMessageId).toBe(questions[0]?.id)

    // Answering the pack turns every question into settled history carrying the
    // client's own answer, and moves the open step on.
    await appendConsultIntakeRevision({
      consultSessionId: sessionId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
      loadInput: async () => ({
        idempotencyKey: 'thread-intake-answers',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })

    const after = await thread(sessionId)
    const rendered = ofKind(after.messages, 'QUESTION')
    expect(rendered.length).toBeGreaterThan(1)

    // Every question she ANSWERED is settled history carrying her own answer —
    // the difference between a thread and a form.
    const settled = rendered.filter((q) => q.answer !== null)
    expect(settled.length).toBe(Object.keys(completeAnswers).length)
    expect(settled.every((q) => q.state === 'DONE')).toBe(true)

    // 🔴 At most ONE question is still being asked. A pack's optional questions
    // are not named by `progress.nextQuestionKey` (it goes null once the
    // REQUIRED ones are answered), so the projection falls back to the first
    // unanswered one — otherwise an optional question is simply never shown.
    // What must never happen is the rest of the pack arriving at once.
    const open = rendered.filter((q) => q.answer === null)
    expect(open.length).toBeLessThanOrEqual(1)
    expect(open.every((q) => q.state === 'OPEN')).toBe(true)
    expect(after.nextOpenMessageId).not.toBe(questions[0]?.id)
  })

  it('emits one photo request per shot in the served pack, carrying the served slot', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)
    await appendConsultIntakeRevision({
      consultSessionId: sessionId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
      loadInput: async () => ({
        idempotencyKey: 'thread-photos-intake',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })

    const t = await thread(sessionId)
    const photos = ofKind(t.messages, 'PHOTO_REQUEST')
    expect(photos).toHaveLength(7)

    // 🔴 The intro names the PACK's own counts. A fixed sentence here is what
    // let a nails consult (three shots) read hair copy and wait for four slots
    // that would never appear, so the pack-aware line is part of the contract.
    const intro = ofKind(t.messages, 'TEXT').find((m) => m.id === 'capture-intro')
    expect(intro?.text).toContain('seven')
    expect(intro?.text).toContain('four of your hair')
    // Every shot is a message; only the first outstanding one is the open step.
    expect(photos.filter((p) => p.state === 'OPEN')).toHaveLength(1)
    expect(photos[0]?.state).toBe('OPEN')
    // The server serves a slot for every shot from the start — EMPTY, not
    // absent — so the message always carries one and the client never has to
    // invent a placeholder for "not taken yet".
    expect(photos[0]?.slot?.state).toBe('EMPTY')
    expect(photos[0]?.shotPackVersion).toBeGreaterThan(0)

    await attachAcceptedCapture(db, sessionId, 'hair_back', 'thread-photos')
    const after = await thread(sessionId)
    const settled = ofKind(after.messages, 'PHOTO_REQUEST').find(
      (p) => p.shot.key === 'hair_back',
    )
    expect(settled?.state).toBe('DONE')
    expect(settled?.slot?.state).toBe('ACCEPTED')
  })

  it('unlocks Book on the SELFIE, not on the analysis', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)
    await appendConsultIntakeRevision({
      consultSessionId: sessionId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
      loadInput: async () => ({
        idempotencyKey: 'thread-gate-intake',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })

    const before = await thread(sessionId)
    expect(before.book.enabled).toBe(false)
    expect(before.book.reason).toBe('SELFIE_REQUIRED')
    // The CTA carries what the ORDINARY look-booking path needs, so the button
    // does not have to go and find it.
    expect(before.book.lookPostId).toBeTruthy()
    expect(before.book.serviceId).toBeTruthy()
    expect(before.book.lookMediaId).toBeTruthy()

    // A hair shot is not a selfie. The gate must not move.
    await attachAcceptedCapture(db, sessionId, 'hair_back', 'thread-gate')
    const stillLocked = await thread(sessionId)
    expect(stillLocked.book.enabled).toBe(false)
    expect(stillLocked.book.reason).toBe('SELFIE_REQUIRED')

    // The selfie, and only the selfie, opens it — with no analysis, no
    // estimate and nothing else finished.
    await attachAcceptedCapture(db, sessionId, 'face_front', 'thread-gate')
    const unlocked = await thread(sessionId)
    expect(unlocked.book.enabled).toBe(true)
    expect(unlocked.book.reason).toBeNull()
    expect(unlocked.status).not.toBe('COMPLETED')
  })

  // 🔴 The booking join is on the LOOK, because booking at the spark runs the
  // ordinary path and stamps `sourceLookPostId` — it knows nothing about this
  // consult. An unscoped join is therefore satisfied by an appointment she
  // booked from the same look months ago, which would open a brand-new consult
  // by telling her she is already on the calendar AND hide the Book button over
  // an appointment that has nothing to do with it.
  it('ignores a booking that predates the consult, and keeps Book open', async () => {
    const lookPostId = await createLook(db, fx.balayageServiceId)

    // An appointment from BEFORE this consult existed, sourced from the same
    // look, in a status that is otherwise "live".
    const earlier = await db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.balayageServiceId,
        offeringId: fx.balayageOfferingId,
        status: BookingStatus.ACCEPTED,
        sourceLookPostId: lookPostId,
        scheduledFor: new Date(Date.now() + 86_400_000),
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal(BALAYAGE_PRICE),
        totalAmount: new Prisma.Decimal(BALAYAGE_PRICE),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        createdAt: new Date(Date.now() - 86_400_000),
      },
      select: { id: true },
    })

    const created = await startLookConsult(
      jsonRequest('/api/v1/client/consult/look', { lookPostId }),
    )
    expect(created.status).toBe(200)
    const sessionId = ((await body(created)).consult as { id: string }).id
    startedSessionIds.push(sessionId)

    const t = await thread(sessionId)
    expect(ofKind(t.messages, 'BOOKING')).toHaveLength(0)
    // The gate is the selfie, not someone else's appointment.
    expect(t.book.reason).toBe('SELFIE_REQUIRED')

    await db.booking.deleteMany({ where: { id: earlier.id } })
  })

  // The other half of "book at the spark": once she HAS booked, the thread does
  // not end — it turns into prep. This is the state every message after the
  // booking confirmation is written for, and nothing else in the suite reaches
  // it, because booking runs the ordinary path and never touches this code.
  it('turns into prep once she has booked, and stays open', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)

    const before = await thread(sessionId)
    expect(ofKind(before.messages, 'BOOKING')).toHaveLength(0)

    // What the ORDINARY look-booking path leaves behind: a booking stamped with
    // the look, made after the consult started. It knows nothing about the
    // consult, which is exactly why the projection joins on the look.
    const booking = await db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.balayageServiceId,
        offeringId: fx.balayageOfferingId,
        status: BookingStatus.ACCEPTED,
        sourceLookPostId: before.book.lookPostId!,
        scheduledFor: new Date(Date.now() + 7 * 86_400_000),
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

    const after = await thread(sessionId)

    const confirmation = ofKind(after.messages, 'BOOKING')
    expect(confirmation).toHaveLength(1)
    expect(confirmation[0]?.bookingId).toBe(booking.id)
    expect(confirmation[0]?.text).toContain(after.professionalDisplayName)

    // 🔴 The thread STAYS OPEN. Everything after the confirmation is prep, and
    // the bubble that says so names the pro — "help <pro> get ready".
    const prep = ofKind(after.messages, 'TEXT').find((m) => m.id === 'prep-intro')
    expect(prep?.text).toContain(after.professionalDisplayName)
    expect(after.messages.length).toBeGreaterThan(before.messages.length)
    // Still work to do: the consult did not end when the appointment was made.
    expect(after.nextOpenMessageId).not.toBeNull()

    // And the CTA steps aside rather than offering a second appointment.
    expect(after.book.enabled).toBe(false)
    expect(after.book.reason).toBe('ALREADY_BOOKED')

    await db.booking.deleteMany({ where: { id: booking.id } })
  })

  it('renders the plan card once the analysis has committed a result', async () => {
    const lookPostId = await createLook(db, fx.balayageServiceId)
    const sessionId = await runConsultToCompletion(db, lookPostId, 'thread-plan')

    const t = await thread(sessionId)
    const plan = ofKind(t.messages, 'PLAN')
    expect(plan).toHaveLength(1)
    expect(plan[0]?.results).not.toBeNull()
    expect(plan[0]?.awaitingStart).toBe(false)
    expect(plan[0]?.state).toBe('DONE')

    // A finished consult has nothing outstanding.
    expect(t.nextOpenMessageId).toBeNull()

    // The plan is the LAST thing in the thread on an unbooked consult — the
    // reveal, after the work.
    expect(t.messages[t.messages.length - 1]?.kind).toBe('PLAN')
  })

  it('answers the inspiration step as a card, not as a wizard step', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)
    await appendConsultIntakeRevision({
      consultSessionId: sessionId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
      loadInput: async () => ({
        idempotencyKey: 'thread-inspo-intake',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })

    const t = await thread(sessionId)
    const inspiration = ofKind(t.messages, 'INSPIRATION')
    expect(inspiration).toHaveLength(1)
    expect(inspiration[0]?.state).toBe('OPEN')
    // 🔴 A LOOK-anchored consult has ALREADY been shown the picture, so its
    // inspiration source is seeded from the look and the source decision never
    // fires (lib/consult/inspirationSeed.ts). The card opens straight on the
    // first question with the reference on screen — asking her to re-pick the
    // image she just tapped is exactly the step Book the Look deleted.
    expect(inspiration[0]?.sourceDecisionRequired).toBe(false)
    expect(inspiration[0]?.source).not.toBeNull()
    expect(inspiration[0]?.question).not.toBeNull()
    expect(inspiration[0]?.requiredSpecificDetailCount).toBe(3)

    for (const [questionKey, selectedValues, text, sentiment] of INSPIRATION_ANSWERS) {
      await answerConsultInspirationQuestion({
        consultSessionId: sessionId,
        clientId: fx.clientId,
        actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
        input: {
          idempotencyKey: `thread-inspo-${questionKey}`,
          schemaVersion: 1,
          questionKey,
          selectedValues,
          ...(text ? { text } : {}),
          ...(sentiment ? { sentiment } : {}),
        },
      })
    }

    const after = await thread(sessionId)
    const done = ofKind(after.messages, 'INSPIRATION')[0]
    expect(done?.state).toBe('DONE')
    expect(done?.question).toBeNull()
  })
})
