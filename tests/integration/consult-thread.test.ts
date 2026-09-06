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
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import { answerConsultInspirationQuestion } from '@/lib/consult/inspirationContract'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'
import { CONSULT_EARLY_PHOTO_SHOT_KEY } from '@/lib/consult/capture/earlyPhoto'
import {
  findConsultCaptureShot,
  resolveConsultCapturePack,
} from '@/lib/consult/capture/registry'
import { purgeConsultSessionRawObjects } from '@/lib/consult/capturePurge'
import { loadConsultThread } from '@/lib/consult/thread'
import {
  acceptConsultAgreement,
  appendConsultIntakeRevision,
  transitionConsultSession,
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
import { CONSULT_INSPIRATION_V2_SCHEMA_VERSION } from '@/lib/consult/inspiration/types'

/**
 * P5c — the guided inspiration a NEW consult is served is contract v2, whatever
 * its family. Clients echo the version the server just gave them
 * (`ConsultInspirationStateDTO.schemaVersion`); these fixtures name the constant
 * rather than a literal so the next contract bump moves them all at once.
 */
const INSPIRATION_SCHEMA_VERSION = CONSULT_INSPIRATION_V2_SCHEMA_VERSION

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
    inspirationCopy: defaultClientConsultInspirationCopy,
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

/**
 * P7a-1. The step between consent and the intake: one photo of the client, any
 * light, camera or roll. The database enforces it — a consult cannot leave
 * EARLY_PHOTO_READY without one accepted, unexpired `early_photo` capture — so
 * every test that reaches the intake takes one, exactly as a client does.
 */
let earlyPhotoLabel = 0
async function takeEarlyPhoto(sessionId: string) {
  // Idempotent, because several tests below write the intake twice (answering,
  // then changing an answer) and a client does not retake her photo to do that.
  // The stage is already satisfied the second time round.
  const existing = await db.consultCapture.findFirst({
    where: {
      consultSessionId: sessionId,
      shotKey: CONSULT_EARLY_PHOTO_SHOT_KEY,
      status: 'ACCEPTED',
    },
    select: { id: true },
  })
  if (existing) return
  earlyPhotoLabel += 1
  await attachAcceptedCapture(
    db,
    sessionId,
    CONSULT_EARLY_PHOTO_SHOT_KEY,
    `thread-early-${earlyPhotoLabel}`,
  )
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
    // P7a-1: the intake is PREP — it does not begin until the early photo is
    // in, so the thread has no questions on it at all before this line.
    await takeEarlyPhoto(sessionId)

    const t = await thread(sessionId)
    const questions = ofKind(t.messages, 'QUESTION')

    // Nothing answered yet: exactly one question is on screen, and it is open.
    expect(questions).toHaveLength(1)
    expect(questions[0]?.state).toBe('OPEN')
    expect(questions[0]?.answer).toBeNull()
    // 🔴 The intake question is NOT the resume point any more, and that is the
    // P7a order rather than a regression: the coarse inspiration cards come
    // first (consent → cards → early photo → Book → intake as prep), so with
    // the cards unanswered the thread resumes on a card. The intake still
    // renders exactly one question, which is what this test is about.
    expect(t.nextOpenMessageId).toMatch(/^inspiration:/)

    // Answering the pack turns every question into settled history carrying the
    // client's own answer, and moves the open step on.
    await takeEarlyPhoto(sessionId)
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
    await takeEarlyPhoto(sessionId)
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
    const allPhotos = ofKind(t.messages, 'PHOTO_REQUEST')
    // Eight photo requests: the early photo, then the pack's seven. The early
    // one is a separate stage that happens BEFORE the intake — it is not a
    // guided slot and does not count towards the pack (P7a-1).
    expect(allPhotos).toHaveLength(8)
    expect(allPhotos[0]?.shot.key).toBe(CONSULT_EARLY_PHOTO_SHOT_KEY)
    const photos = allPhotos.filter(
      (photo) => photo.shot.key !== CONSULT_EARLY_PHOTO_SHOT_KEY,
    )
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

  it('unlocks Book on the EARLY PHOTO, not on the analysis or the intake', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)

    // Consent is in, nothing else is. The CTA is locked and says why.
    const before = await thread(sessionId)
    expect(before.book.enabled).toBe(false)
    expect(before.book.reason).toBe('SELFIE_REQUIRED')
    // The CTA carries what the ORDINARY look-booking path needs, so the button
    // does not have to go and find it.
    expect(before.book.lookPostId).toBeTruthy()
    expect(before.book.serviceId).toBeTruthy()
    expect(before.book.lookMediaId).toBeTruthy()

    // The early photo, and only that, opens it — with no intake, no analysis,
    // no estimate and nothing else finished. This is the whole point of P7a:
    // the spark converts into a booking before any of that exists.
    await takeEarlyPhoto(sessionId)
    const unlocked = await thread(sessionId)
    expect(unlocked.book.enabled).toBe(true)
    expect(unlocked.book.reason).toBeNull()
    expect(unlocked.status).toBe('EARLY_PHOTO_READY')
    // The intake renders BELOW the CTA as prep, and nothing in it is answered:
    // the booking did not wait for a single question.
    const questions = ofKind(unlocked.messages, 'QUESTION')
    expect(questions.every((q) => q.answer === null)).toBe(true)
    // And the photo that unlocked it is above the intake in the thread.
    const ids = unlocked.messages.map((m) => m.id)
    expect(ids.indexOf(`photo:${CONSULT_EARLY_PHOTO_SHOT_KEY}`)).toBeLessThan(
      ids.findIndex((id) => id.startsWith('intake:')),
    )
  })

  // 🔴 THE MERGE-WINDOW TEST. P4c narrowed the gap between "schema migrated"
  // and "code deployed" to the ~2m30s of the deploy build, but it did not close
  // it — and consults created by the STILL-DEPLOYED code walk the old path:
  // CONSENT_REQUIRED -> INTAKE_READY, with no early photo and no early stage.
  //
  // Every arm of P7a-1's guards is additive precisely so those sessions keep
  // working, and "additive" is a claim worth executing rather than asserting.
  // This walks a consult the OLD way and then reads it with the NEW code.
  it('a session stored BEFORE this change still loads and still finishes', async () => {
    const sessionId = await startConsult()

    // Reproduce what the OLD code left behind, rather than rewinding a new
    // session — the lifecycle guard correctly refuses to walk backwards, and a
    // test that had to disable a guard to set itself up would be proving
    // nothing. So: accept one agreement through the boundary (which leaves the
    // session in CONSENT_REQUIRED), record the second directly, and then take
    // the OLD edge straight to the intake.
    await acceptConsultAgreement({
      consultSessionId: sessionId,
      agreementVersionId: fx.consentVersionId,
      expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
    })
    await db.consultAgreementAcceptance.create({
      data: {
        consultSessionId: sessionId,
        agreementVersionId: fx.adultVersionId,
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        acceptedByType: ConsultActorType.CLIENT,
        acceptedById: fx.clientUserId,
      },
    })
    await transitionConsultSession({
      consultSessionId: sessionId,
      fromStatus: 'CONSENT_REQUIRED',
      toStatus: 'INTAKE_READY',
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
    })

    // It LOADS — no crash on a session with no `earlyPhoto` anywhere.
    const before = await thread(sessionId)
    expect(before.status).toBe('INTAKE_READY')
    // And it is honest about the CTA: this consult has no early photo, so the
    // gate is closed and says why, rather than silently enabling.
    expect(before.book.enabled).toBe(false)
    expect(before.book.reason).toBe('SELFIE_REQUIRED')

    // And it still FINISHES: the intake is answerable from the old state and
    // carries the session on to MEDIA_READY exactly as it always did.
    await appendConsultIntakeRevision({
      consultSessionId: sessionId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
      loadInput: async () => ({
        idempotencyKey: 'legacy-session-intake',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })
    const after = await thread(sessionId)
    expect(after.status).toBe('MEDIA_READY')
    expect(
      after.messages.some((m) => m.id.startsWith('intake:')),
      'the intake it already answered is still on the thread',
    ).toBe(true)
  })

  // The unlocking shot must resolve for EVERY family, including one nobody has
  // modelled yet: `consultFamily` defaults to OTHER, so a category an admin
  // adds without thinking about it still has to be bookable.
  it('resolves the unlocking shot for every service family', () => {
    for (const family of [
      'HAIR',
      'SKIN',
      'NAILS',
      'BROWS_LASHES',
      'MAKEUP',
      'BODY',
      'OTHER',
    ] as const) {
      const pack = resolveConsultCapturePack({ categorySlug: 'anything', family })
      // It is deliberately NOT a guided slot — it must not appear in the prep
      // checklist or move any pack's N/M counter...
      expect(
        pack.shots.some((shot) => shot.key === CONSULT_EARLY_PHOTO_SHOT_KEY),
      ).toBe(false)
    }
    // ...and it resolves from the registry regardless, which is what the gate
    // and the vision gate both use.
    expect(findConsultCaptureShot(CONSULT_EARLY_PHOTO_SHOT_KEY)).not.toBeNull()
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

  // ── P7a-2: the link, not the inference ──────────────────────────────────

  /**
   * A booking as the ordinary look path leaves it, optionally linked.
   *
   * Every one gets its OWN slot: `Booking_no_active_professional_overlap` is a
   * real exclusion constraint on (professional, time range), so two fixtures at
   * the same instant collide before any assertion runs.
   */
  let bookLookSlot = 0
  async function bookLook(args: {
    lookPostId: string
    sourceConsultSessionId?: string | null
    status?: BookingStatus
    createdAt?: Date
  }) {
    bookLookSlot += 1
    return db.booking.create({
      data: {
        clientId: fx.clientId,
        professionalId: fx.professionalId,
        serviceId: fx.balayageServiceId,
        offeringId: fx.balayageOfferingId,
        status: args.status ?? BookingStatus.ACCEPTED,
        sourceLookPostId: args.lookPostId,
        sourceConsultSessionId: args.sourceConsultSessionId ?? null,
        scheduledFor: new Date(Date.now() + (7 + bookLookSlot) * 86_400_000),
        locationType: ServiceLocationType.SALON,
        locationId: fx.locationId,
        locationTimeZone: ZONE,
        subtotalSnapshot: new Prisma.Decimal(BALAYAGE_PRICE),
        totalAmount: new Prisma.Decimal(BALAYAGE_PRICE),
        totalDurationMinutes: 60,
        proTenantId: fx.tenantId,
        clientHomeTenantId: fx.tenantId,
        ...(args.createdAt ? { createdAt: args.createdAt } : {}),
      },
      select: { id: true },
    })
  }

  // 🔴 The point of the slice. The link is read off the booking row, so the
  // thread does not have to guess from (client, pro, look, time) — and it finds
  // the booking even when the inference could NOT have: this one is created
  // BEFORE the consult, which the legacy window excludes.
  it('resolves the booking from the explicit link, not from inference', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)
    const before = await thread(sessionId)

    const booking = await bookLook({
      lookPostId: before.book.lookPostId!,
      sourceConsultSessionId: sessionId,
      // Older than the consult: the P5a inference window (createdAt >= consult)
      // would refuse this, so a pass here can only come from the link.
      createdAt: new Date(Date.now() - 30 * 86_400_000),
    })

    const after = await thread(sessionId)
    const confirmation = ofKind(after.messages, 'BOOKING')
    expect(confirmation).toHaveLength(1)
    expect(confirmation[0]?.bookingId).toBe(booking.id)
    expect(after.book.reason).toBe('ALREADY_BOOKED')

    await db.booking.deleteMany({ where: { id: booking.id } })
  })

  // Tori's scenario, in the only shape that is reachable: ConsultSession is
  // unique per (clientId, professionalId, anchorLookPostId), so ONE client
  // cannot have two consults on the SAME look. Two looks with the same pro is
  // the real case — and the one where an inference on (client, pro) would
  // cross the wires.
  it('keeps two consults on two looks with one pro correctly separated', async () => {
    const sessionA = await startConsult()
    const sessionB = await startConsult()
    expect(sessionA).not.toBe(sessionB)

    await acceptBothAgreements(sessionA)
    await acceptBothAgreements(sessionB)

    const beforeA = await thread(sessionA)
    const beforeB = await thread(sessionB)
    expect(beforeA.book.lookPostId).not.toBe(beforeB.book.lookPostId)

    const bookingA = await bookLook({
      lookPostId: beforeA.book.lookPostId!,
      sourceConsultSessionId: sessionA,
    })
    const bookingB = await bookLook({
      lookPostId: beforeB.book.lookPostId!,
      sourceConsultSessionId: sessionB,
    })

    const afterA = await thread(sessionA)
    const afterB = await thread(sessionB)

    expect(ofKind(afterA.messages, 'BOOKING')[0]?.bookingId).toBe(bookingA.id)
    expect(ofKind(afterB.messages, 'BOOKING')[0]?.bookingId).toBe(bookingB.id)
    // Neither thread claims the other's appointment.
    expect(ofKind(afterA.messages, 'BOOKING')[0]?.bookingId).not.toBe(bookingB.id)
    expect(ofKind(afterB.messages, 'BOOKING')[0]?.bookingId).not.toBe(bookingA.id)

    await db.booking.deleteMany({
      where: { id: { in: [bookingA.id, bookingB.id] } },
    })
  })

  // A booking linked to ANOTHER consult is that consult's, never this one's —
  // and the legacy fallback must not pick it up either (it excludes linked
  // rows). Without that exclusion the fallback would quietly re-create the
  // cross-wiring the link exists to end.
  it('never claims a booking that is linked to a different consult', async () => {
    const sessionA = await startConsult()
    const sessionB = await startConsult()
    await acceptBothAgreements(sessionA)
    await acceptBothAgreements(sessionB)

    const a = await thread(sessionA)

    // Sourced from A's look but linked to B. A must not show it.
    const booking = await bookLook({
      lookPostId: a.book.lookPostId!,
      sourceConsultSessionId: sessionB,
    })

    const afterA = await thread(sessionA)
    expect(ofKind(afterA.messages, 'BOOKING')).toHaveLength(0)
    expect(afterA.book.reason).toBe('SELFIE_REQUIRED')

    await db.booking.deleteMany({ where: { id: booking.id } })
  })

  // The link is RELEASED by a cancelled or completed booking (Tori,
  // 2026-09-06) — she can book that look again from the same consult. A
  // cancelled-only rule would strand her after an appointment simply happened,
  // because she cannot open a second consult for the same look either.
  it.each([
    ['CANCELLED', BookingStatus.CANCELLED],
    ['COMPLETED', BookingStatus.COMPLETED],
  ])('releases the link when the booking is %s', async (_label, status) => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)
    const before = await thread(sessionId)

    const booking = await bookLook({
      lookPostId: before.book.lookPostId!,
      sourceConsultSessionId: sessionId,
      status,
    })

    const after = await thread(sessionId)
    expect(ofKind(after.messages, 'BOOKING')).toHaveLength(0)
    // The Book button comes BACK rather than being held by a dead appointment.
    expect(after.book.reason).toBe('SELFIE_REQUIRED')

    await db.booking.deleteMany({ where: { id: booking.id } })
  })

  // 🔴 The DATABASE enforces one live link, not just the application read.
  // Written by inserting straight through Prisma — deliberately BYPASSING
  // `resolveConsultSparkLink`, because a guard that is only enforced by the
  // code path that checks it is not enforced under a race. Both directions are
  // asserted: it refuses a second LIVE row, and it PERMITS one once the first
  // is cancelled — an index that refused both would pass a one-sided test.
  it('the partial unique index holds the link, and releases it on cancel', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)
    const before = await thread(sessionId)
    const lookPostId = before.book.lookPostId!

    const first = await bookLook({
      lookPostId,
      sourceConsultSessionId: sessionId,
    })

    await expect(
      bookLook({ lookPostId, sourceConsultSessionId: sessionId }),
    ).rejects.toMatchObject({ code: 'P2002' })

    // Cancel the holder — the link is released and a new one is allowed.
    await db.booking.update({
      where: { id: first.id },
      data: { status: BookingStatus.CANCELLED },
    })

    const second = await bookLook({
      lookPostId,
      sourceConsultSessionId: sessionId,
    })
    expect(second.id).not.toBe(first.id)

    await db.booking.deleteMany({
      where: { id: { in: [first.id, second.id] } },
    })
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
    await takeEarlyPhoto(sessionId)
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
    // P5d — the step's own message, then ONE MESSAGE PER COARSE CARD. There is
    // no reading on this fixture (nothing has called `/inspiration/read`), so
    // the prep tier is empty and the coarse cards crop to the whole reference.
    expect(inspiration.map((message) => message.id)).toEqual([
      'inspiration',
      'inspiration:spark_focus',
      'inspiration:keep_as_is',
      'inspiration:understanding_check',
    ])
    // 🔴 DONE, not OPEN: for a card consult this message is a bubble and the
    // reference. The open step is the CARD, so resume lands on the thing she
    // still has to answer rather than on a header above it.
    expect(inspiration[0]?.state).toBe('DONE')
    // 🔴 A LOOK-anchored consult has ALREADY been shown the picture, so its
    // inspiration source is seeded from the look and the source decision never
    // fires (lib/consult/inspirationSeed.ts). The card opens straight on the
    // first question with the reference on screen — asking her to re-pick the
    // image she just tapped is exactly the step Book the Look deleted.
    expect(inspiration[0]?.sourceDecisionRequired).toBe(false)
    expect(inspiration[0]?.source).not.toBeNull()
    // 🔴 The step message carries NO wizard question for a card consult: the
    // questions are on the cards, and serving one twice would render it twice.
    expect(inspiration[0]?.question).toBeNull()
    expect(inspiration[0]?.card).toBeNull()
    // 🔴 P5c: contract v2 has NO detail gate, so the card asks for the pack's
    // questions and nothing more. Under v1 this was 3, and a client who
    // genuinely did not mind could not finish the step at all.
    expect(inspiration[0]?.requiredSpecificDetailCount).toBe(0)

    // The first card is the one the thread is waiting on; the rest render but
    // are not the resume point.
    const spark = inspiration[1]!
    expect(spark.state).toBe('OPEN')
    expect(t.nextOpenMessageId).toBe('inspiration:spark_focus')
    expect(spark.card?.tier).toBe('COARSE')
    expect(spark.card?.question.label).toBe('What made you stop scrolling?')
    expect(spark.card?.optionRegions.map((option) => option.label)).toEqual([
      'The color',
      'The shape of it',
      'The whole thing',
      'Not sure',
    ])
    // No reading yet, so every crop is the whole picture — the stated fallback,
    // not a blank card.
    for (const option of spark.card?.optionRegions ?? []) {
      expect(option.region).toBeNull()
    }
    expect(inspiration[2]?.state).toBe('BLOCKED')
    // The understanding check's text is COMPOSED by the server. With nothing
    // answered yet it is the honest fallback, naming the pro.
    expect(inspiration[3]?.card?.question.label).toContain('work out the details')

    for (const [questionKey, selectedValues] of INSPIRATION_ANSWERS) {
      await answerConsultInspirationQuestion({
        consultSessionId: sessionId,
        clientId: fx.clientId,
        actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
        input: {
          idempotencyKey: `thread-inspo-${questionKey}`,
          schemaVersion: INSPIRATION_SCHEMA_VERSION,
          questionKey,
          selectedValues,
        },
      })
    }

    const after = await thread(sessionId)
    const afterCards = ofKind(after.messages, 'INSPIRATION')
    expect(afterCards[0]?.state).toBe('DONE')
    expect(afterCards[0]?.question).toBeNull()
    // Every answered card keeps its place, dimmed, with what she chose on it —
    // a thread you can scroll back through, not a form that clears itself.
    for (const card of afterCards.slice(1)) {
      expect(card.state).toBe('DONE')
      expect(card.card?.selectedValues.length).toBeGreaterThan(0)
    }
    // 🔴 The check now reads back her actual answers, composed server-side.
    //
    // No "aren't sure how bright yet" clause here, and its absence is the
    // point: this consult has no READING, so there is no particular attribute
    // the photograph failed to settle. Claiming one would be a sentence about
    // a reading that was never made.
    expect(afterCards[3]?.card?.question.label).toBe(
      'You like the color and want to keep your length. We’ll help ' +
        after.professionalDisplayName +
        ' work out the details.',
    )
    expect(after.nextOpenMessageId).not.toBe('inspiration:spark_focus')
  })

  it('🔴 "Change something" reopens the coarse cards instead of standing as an agreement', async () => {
    const sessionId = await startConsult()
    await acceptBothAgreements(sessionId)
    await takeEarlyPhoto(sessionId)
    await appendConsultIntakeRevision({
      consultSessionId: sessionId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
      loadInput: async () => ({
        idempotencyKey: 'thread-inspo-reopen-intake',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })
    for (const [questionKey, selectedValues] of INSPIRATION_ANSWERS.slice(0, 2)) {
      await answerConsultInspirationQuestion({
        consultSessionId: sessionId,
        clientId: fx.clientId,
        actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
        input: {
          idempotencyKey: `thread-reopen-${questionKey}`,
          schemaVersion: INSPIRATION_SCHEMA_VERSION,
          questionKey,
          selectedValues,
        },
      })
    }
    await answerConsultInspirationQuestion({
      consultSessionId: sessionId,
      clientId: fx.clientId,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
      input: {
        idempotencyKey: 'thread-reopen-change',
        schemaVersion: INSPIRATION_SCHEMA_VERSION,
        questionKey: 'understanding_check',
        selectedValues: ['change-something'],
      },
    })

    const reopened = await thread(sessionId)
    const cards = ofKind(reopened.messages, 'INSPIRATION')
    // Back to the first card, with nothing stored — including the check itself,
    // which must not stand as an agreement she withdrew.
    expect(reopened.nextOpenMessageId).toBe('inspiration:spark_focus')
    for (const card of cards.slice(1)) {
      expect(card.card?.selectedValues).toEqual([])
    }
    expect(cards[0]?.state).toBe('DONE')
  })
})
