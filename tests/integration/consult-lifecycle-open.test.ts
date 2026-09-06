// tests/integration/consult-lifecycle-open.test.ts
//
// P7a-3 — run-complete ≠ consult-closed, against real PostgreSQL.
//
// Everything this slice claims is a claim about DATABASE state under guards
// that were written to make completion terminal, so a mocked test would only
// prove that the mock agrees with itself. What this suite exists to prove:
//
//   * a COMPLETED consult still takes input — intake, inspiration and capture —
//     and the guards, not just the application, permit it;
//   * a rerun produces a NEW plan version with a DIFF, debounced into one paid
//     call per burst of edits and capped per consult;
//   * an older run cannot publish over a newer revision, proven the only way
//     the one-live-run index allows: a STOLEN LEASE, which is the real race;
//   * retention works BOTH ways — with chart-copy consent the photos survive
//     completion, without it they are purged and the rerun is refused in the
//     app's own voice rather than answered from stale observations;
//   * the APPOINTMENT closes the document, for a spark consult as well as a
//     booking-anchored one. That arm did not exist at all before this slice.

import {
  BookingStatus,
  ConsultActorType,
  ConsultAnalysisRunStatus,
  ConsultCaptureStatus,
  ConsultSessionStatus,
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

import { defaultClientConsultCaptureCopy } from '@/lib/brand/defaultClientConsultCaptureCopy'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { defaultClientConsultPlanDiffCopy } from '@/lib/brand/defaultClientConsultPlanDiffCopy'
import { defaultClientConsultThreadCopy } from '@/lib/brand/defaultClientConsultThreadCopy'
import {
  CONSULT_MAX_PLAN_VERSIONS,
  CONSULT_RERUN_DEBOUNCE_MS,
  dueConsultRerunSessionIds,
  resolveConsultRerunState,
} from '@/lib/consult/analysisRerun'
import {
  executeConsultAnalysisRun,
  startConsultAnalysisRerun,
} from '@/lib/consult/analysisContract'
import { CONSULT_EARLY_PHOTO_SHOT_KEY } from '@/lib/consult/capture/earlyPhoto'
import type { HairColorCaptureShotKey } from '@/lib/consult/capture/packs/hairColorDaylight'
import { deleteConsultCapture } from '@/lib/consult/captureContract'
import { answerConsultInspirationQuestion } from '@/lib/consult/inspirationContract'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'
import { loadAuthorizedProConsultBriefs } from '@/lib/consult/proBrief'
import { loadConsultThread } from '@/lib/consult/thread'
import { appendConsultIntakeRevision } from '@/lib/consult/writeBoundary'
import type { ConsultThreadMessageDTO } from '@/lib/dto/consult'

import {
  resetConsultLookFakes,
  setFakeAnalysisAchievability,
} from './_support/consultLookFakes'
import {
  BALAYAGE_PRICE,
  INSPIRATION_ANSWERS,
  ZONE,
  attachAcceptedCapture,
  completeAnswers,
  createLook,
  fx,
  runConsultToCompletion,
  seedLookConsultFixture,
  teardownLookConsultFixture,
} from './_support/lookConsultFixture'
import { CONSULT_INSPIRATION_V2_SCHEMA_VERSION } from '@/lib/consult/inspiration/types'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

/**
 * The acting client.
 *
 * 🔴 A FUNCTION, not a const. `fx` is populated in `beforeAll`, so a
 * module-scope `{ id: fx.clientUserId }` captures the empty string the fixture
 * starts with — and every write then refuses with "Consult session not found",
 * which reads exactly like a broken guard rather than a broken test.
 */
const client = () =>
  ({ type: ConsultActorType.CLIENT, id: fx.clientUserId }) as const

beforeAll(async () => {
  await seedLookConsultFixture(db, { tagPrefix: 'p7a3_open' })
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
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await teardownLookConsultFixture(db)
  await db.$disconnect()
})

function thread(consultSessionId: string) {
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

function ofKind<K extends ConsultThreadMessageDTO['kind']>(
  messages: ConsultThreadMessageDTO[],
  kind: K,
): Extract<ConsultThreadMessageDTO, { kind: K }>[] {
  return messages.filter(
    (m): m is Extract<ConsultThreadMessageDTO, { kind: K }> => m.kind === kind,
  )
}

/** A finished consult, ready to be changed. */
async function completedConsult(label: string): Promise<string> {
  const lookPostId = await createLook(db, fx.balayageServiceId)
  return runConsultToCompletion(db, lookPostId, label)
}

/**
 * Change one intake answer — the cheapest real edit a client can make, and the
 * one that proves the guards permit an INTAKE revision after completion.
 */
async function changeAnIntakeAnswer(sessionId: string, label: string) {
  return appendConsultIntakeRevision({
    consultSessionId: sessionId,
    actor: client(),
    loadInput: async () => ({
      idempotencyKey: `reintake-${label}`,
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: true,
      // 🔴 A change that moves the PLAN without moving the SAFETY ROUTING.
      // `change_scale: 'total'` reads like the obvious edit and routes to a
      // safety prerequisite this fixture's pro does not offer, so the rerun is
      // refused before it starts — a red test about the wrong thing. Saying
      // "my last lightening was longer ago than I thought" is a real client
      // correction that stays inside the menu.
      answers: { ...completeAnswers, prior_lightening: 'over-12-months' },
    }),
  })
}

/**
 * A moment after the debounce would have elapsed.
 *
 * 🔴 The obvious move — backdating the ANALYSIS_RERUN_REQUESTED audit row — is
 * impossible, and rightly so: `ConsultAuditEvent_immutable` refuses every
 * UPDATE, because a trail whose timestamps can be edited is not evidence. So
 * the clock moves instead, which is also the honest thing to simulate.
 */
function afterTheDebounce(): Date {
  return new Date(Date.now() + CONSULT_RERUN_DEBOUNCE_MS + 5_000)
}

/**
 * Promote and drain THIS consult's rerun.
 *
 * 🔴 Deliberately not `processConsultAnalysisRuns`. The cron takes the oldest
 * due work in the whole table and `take` is 1 by design (one run is minutes of
 * provider time), so in a suite where several tests each leave a consult
 * pending, a cron tick fired from one test drains another test's consult and
 * every assertion after it is about the wrong session. Whether the CRON
 * promotes at all is asserted once, on its own, in the debounce test.
 */
async function rerunNow(sessionId: string) {
  // 🔴 ONE clock for both halves. The promotion stamps `runAt` from the `now`
  // it is given, and the worker refuses to claim a run whose `runAt` has not
  // arrived — so promoting at now+90s and then claiming at now returns
  // NOT_CLAIMABLE, which looks exactly like a broken queue.
  const now = afterTheDebounce()
  const started = await startConsultAnalysisRerun({
    consultSessionId: sessionId,
    now,
  })
  if (!started.started) {
    throw new Error(`rerun refused: ${started.reason}`)
  }
  return executeConsultAnalysisRun({ runId: started.run.runId, now })
}

/**
 * The booking a spark consult produced, linked the way P7a-2 links it.
 *
 * 🔴 `sourceConsultSessionId` and NOT `ConsultSession.bookingId`: a
 * look-anchored consult never sets the latter, which is exactly why every
 * booking-time clause in the schema skipped it before this slice.
 */
async function bookTheLook(
  sessionId: string,
  status: BookingStatus,
  scheduledFor = new Date(Date.now() + 86_400_000),
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

/** Bookings this suite created, so teardown can drop them. */
const bookingIds: string[] = []

/**
 * Replace a photo she already sent — delete, then send the new one.
 *
 * 🔴 Two steps, because `ConsultCapture_one_active_slot` permits ONE live
 * capture per shot and that is the shipped retake contract. It matters more
 * after P7a-3 than before it: retention keeps the first photo ACCEPTED and
 * unpurged, so the slot is genuinely occupied where completion used to have
 * cleared it. A client retaking a shot on a finished consult walks exactly this
 * path, and both halves of it have to work in COMPLETED.
 */
async function retakePhoto(
  sessionId: string,
  shotKey: HairColorCaptureShotKey,
  label: string,
) {
  const existing = await db.consultCapture.findFirst({
    where: {
      consultSessionId: sessionId,
      shotKey,
      status: { in: [ConsultCaptureStatus.ATTACHED, ConsultCaptureStatus.ACCEPTED] },
      purgedAt: null,
    },
    select: { id: true },
  })
  if (existing) {
    await deleteConsultCapture({
      consultSessionId: sessionId,
      captureId: existing.id,
      clientId: fx.clientId,
      actor: client(),
    })
  }
  await attachAcceptedCapture(db, sessionId, shotKey, label)
}

describe('a completed consult still takes input', () => {
  it('accepts a changed intake answer, a changed card, and a new photo', async () => {
    const sessionId = await completedConsult('open-input')

    // 🔴 All three of these were refused by the DATABASE before this slice —
    // `consult_revision_requires_agreements` pinned INTAKE to the pre-analysis
    // states, INSPIRATION to two of them, and `consult_capture_guard` refused an
    // insert outside MEDIA_READY. Driving them through the real write boundary
    // is what proves the guard was re-issued and not merely the TypeScript.
    await changeAnIntakeAnswer(sessionId, 'open-input')
    const [firstQuestion, firstValues] = INSPIRATION_ANSWERS[0] ?? []
    if (!firstQuestion || !firstValues) throw new Error('fixture has no cards')
    await answerConsultInspirationQuestion({
      consultSessionId: sessionId,
      clientId: fx.clientId,
      actor: client(),
      input: {
        idempotencyKey: 'open-input-recard',
        schemaVersion: CONSULT_INSPIRATION_V2_SCHEMA_VERSION,
        questionKey: firstQuestion,
        selectedValues: firstValues,
      },
    })
    await retakePhoto(sessionId, 'hair_back', 'open-input-again')

    // The session never left COMPLETED, which is what keeps the two
    // once-per-consult transition audit indexes meaning what they meant.
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.COMPLETED })
  })

  it('keeps the whole history on screen instead of erasing it', async () => {
    const sessionId = await completedConsult('open-history')
    const t = await thread(sessionId)

    // 🔴 The defect this replaces: the intake loader refused from
    // ANALYSIS_PENDING and the capture loader from ANALYZING, `optionalStage`
    // swallowed both, and a finished consult rendered as a thread that had
    // never asked her anything.
    expect(ofKind(t.messages, 'QUESTION').length).toBeGreaterThan(0)
    expect(ofKind(t.messages, 'PHOTO_REQUEST').length).toBeGreaterThan(0)
    expect(ofKind(t.messages, 'PLAN')).toHaveLength(1)

    // And nothing in that history is presented as work she still owes.
    expect(t.nextOpenMessageId).toBeNull()
  })
})

describe('a rerun produces a new plan version', () => {
  it('debounces a burst of edits into ONE run, then publishes v2 with a diff', async () => {
    const sessionId = await completedConsult('rerun-v2')

    // A burst: three edits in a row, as a client working through prep does.
    await changeAnIntakeAnswer(sessionId, 'rerun-v2-a')
    await retakePhoto(sessionId, 'hair_left', 'rerun-v2-b')
    await retakePhoto(sessionId, 'hair_right', 'rerun-v2-c')

    const pending = await resolveConsultRerunState(db, sessionId)
    expect(pending.pending).toBe(true)
    expect(pending.planVersion).toBe(1)
    // 🔴 Still nothing queued. Creating a run per edit is what the debounce
    // exists to prevent, and three runs here would be three paid calls.
    expect(
      await db.consultAnalysisRun.count({
        where: { consultSessionId: sessionId, planVersion: { gt: 1 } },
      }),
    ).toBe(0)

    // Inside the window the cron does not consider it; after the window it does.
    // Asserted on the DUE LIST rather than on a tick's counter, because the
    // queue is shared and another consult being due says nothing about this one.
    expect(
      await dueConsultRerunSessionIds({ now: new Date(), take: 50 }),
    ).not.toContain(sessionId)
    expect(
      await dueConsultRerunSessionIds({ now: afterTheDebounce(), take: 50 }),
    ).toContain(sessionId)

    // The rerun reaches a DIFFERENT conclusion, so the diff has something in it.
    setFakeAnalysisAchievability('LIKELY_MULTI_APPOINTMENT')
    expect((await rerunNow(sessionId)).result).toBe('COMPLETED')

    // ONE rerun for three edits, and it published v2.
    expect(
      await db.consultAnalysisRun.count({
        where: { consultSessionId: sessionId, planVersion: 2 },
      }),
    ).toBe(1)
    expect(
      await db.consultRevision.count({
        where: { consultSessionId: sessionId, kind: 'ANALYSIS' },
      }),
    ).toBe(2)

    const t = await thread(sessionId)
    const plan = ofKind(t.messages, 'PLAN')[0]
    expect(plan?.planVersion).toBe(2)
    expect(plan?.updatePending).toBe(false)

    const updates = ofKind(t.messages, 'PLAN_UPDATE')
    expect(updates).toHaveLength(1)
    expect(updates[0]?.planVersion).toBe(2)
    expect(updates[0]?.previousPlanVersion).toBe(1)
    // The row a person would actually notice: how big a job it is.
    const achievability = updates[0]?.changes.find((c) => c.key === 'achievability')
    expect(achievability).toMatchObject({
      label: defaultClientConsultPlanDiffCopy.achievabilityLabel,
      from: defaultClientConsultPlanDiffCopy.achievabilityAssessment,
      to: defaultClientConsultPlanDiffCopy.achievabilityMulti,
    })

    // 🔴 The PRO sees the same change, in the same words. Two surfaces
    // describing one change differently is the failure a versioned Brief
    // exists to prevent, so this is asserted against the same copy table.
    const briefs = await loadAuthorizedProConsultBriefs({
      professionalId: fx.professionalId,
      clientId: fx.clientId,
    })
    const brief = briefs.find((b) => b.consultId === sessionId)
    expect(brief?.planVersion).toBe(2)
    expect(brief?.planChanges?.find((c) => c.key === 'achievability')).toMatchObject({
      from: defaultClientConsultPlanDiffCopy.achievabilityAssessment,
      to: defaultClientConsultPlanDiffCopy.achievabilityMulti,
    })
  })

  it('says so in the thread while the update is still coming', async () => {
    const sessionId = await completedConsult('rerun-pending')
    await changeAnIntakeAnswer(sessionId, 'rerun-pending')

    const t = await thread(sessionId)
    const plan = ofKind(t.messages, 'PLAN')[0]
    expect(plan?.updatePending).toBe(true)
    // Not "here's your plan" over a plan she has already told us is stale.
    expect(plan?.text).toBe(defaultClientConsultThreadCopy.planUpdating)
  })

  it('stops at the per-consult cap instead of rerunning forever', async () => {
    const sessionId = await completedConsult('rerun-cap')

    // Spend the allowance. Each pass is one edit, one debounce, one run.
    for (let version = 2; version <= CONSULT_MAX_PLAN_VERSIONS; version += 1) {
      await changeAnIntakeAnswer(sessionId, `rerun-cap-${version}`)
      expect((await rerunNow(sessionId)).result).toBe('COMPLETED')
    }

    // One more edit. It is recorded as an edit — her answer is HERS and is
    // stored — but it buys no further run.
    await changeAnIntakeAnswer(sessionId, 'rerun-cap-over')
    const after = await startConsultAnalysisRerun({
      consultSessionId: sessionId,
      now: afterTheDebounce(),
    })
    expect(after).toMatchObject({
      started: false,
      reason: 'ANALYSIS_RERUN_LIMIT_REACHED',
    })
    expect(
      await db.consultRevision.count({
        where: { consultSessionId: sessionId, kind: 'ANALYSIS' },
      }),
    ).toBe(CONSULT_MAX_PLAN_VERSIONS)

    const state = await resolveConsultRerunState(db, sessionId)
    expect(state.moreVersionsAvailable).toBe(false)
    const t = await thread(sessionId)
    expect(
      t.messages.some(
        (m) =>
          m.kind === 'TEXT' &&
          m.text.includes('That’s as far as I can take this one'),
      ),
    ).toBe(true)
  })
})

describe('an older run cannot publish over a newer revision', () => {
  it('refuses the finalize of a stolen lease whose plan version is stale', async () => {
    const sessionId = await completedConsult('supersede')
    await changeAnIntakeAnswer(sessionId, 'supersede')

    // Queue the rerun WITHOUT draining it, so its run row exists and is v2.
    // Called directly rather than through the cron, which drains what it
    // promotes in the same tick.
    const now = afterTheDebounce()
    const started = await startConsultAnalysisRerun({
      consultSessionId: sessionId,
      now,
    })
    expect(started.started).toBe(true)
    const queued = await db.consultAnalysisRun.findFirstOrThrow({
      where: { consultSessionId: sessionId, planVersion: 2 },
      select: { id: true },
    })

    // 🔴 The real race, reproduced the only way the one-live-run index allows:
    // a STOLEN LEASE. Worker A claims the run and stalls; the lease expires;
    // worker B steals it, finishes, and publishes v2. Worker A then wakes with
    // a v2 pin against a consult that already HAS a v2.
    //
    // Two live runs cannot be created to test this, and relaxing
    // `ConsultAnalysisRun_one_live_run_per_session` to stage it would be
    // sabotaging the constraint that makes the answer singular in the first
    // place — proving the fix by removing the thing being tested.
    const workerB = await executeConsultAnalysisRun({ runId: queued.id, now })
    expect(workerB.result).toBe('COMPLETED')

    // Worker A, waking up on the same row it thought it owned.
    const workerA = await executeConsultAnalysisRun({ runId: queued.id, now })
    expect(workerA.result).toBe('NOT_CLAIMABLE')

    // Exactly one v2 exists, and it is worker B's.
    expect(
      await db.consultRevision.count({
        where: { consultSessionId: sessionId, kind: 'ANALYSIS' },
      }),
    ).toBe(2)
    expect(
      await db.consultAnalysisRun.count({
        where: {
          consultSessionId: sessionId,
          planVersion: 2,
          status: ConsultAnalysisRunStatus.COMPLETED,
        },
      }),
    ).toBe(1)
  })
})

// 🔴 "a photograph to read" rather than the obvious phrasing, which would put
// the words "h[as] [any]thing" next to each other. `check:no-type-escape` is a
// substring scan over the whole file, comments included, so that innocent
// collision fails the build as a type escape. Reword; never baseline it.
describe('retention decides whether a rerun has a photograph to read', () => {
  it('keeps the photos when the client asked to, and extends their expiry', async () => {
    const sessionId = await completedConsult('retention-yes')

    // chartCopyOptIn defaults TRUE, which is the shipped default and the case
    // that matters: her photos survive the analysis that read them.
    const captures = await db.consultCapture.findMany({
      where: {
        consultSessionId: sessionId,
        status: ConsultCaptureStatus.ACCEPTED,
      },
      select: { purgeRequestedAt: true, purgedAt: true, rawExpiresAt: true },
    })
    expect(captures.length).toBeGreaterThan(0)
    expect(captures.every((c) => c.purgeRequestedAt === null)).toBe(true)
    expect(captures.every((c) => c.purgedAt === null)).toBe(true)

    // A rerun therefore has something to read.
    const state = await resolveConsultRerunState(db, sessionId)
    expect(state.photosExpired).toBe(false)
  })

  it('asks for a new photo when she did not, instead of reusing stale reads', async () => {
    const lookPostId = await createLook(db, fx.balayageServiceId)
    const sessionId = await runConsultToCompletion(db, lookPostId, 'retention-no-pre')

    // Opting out AFTER the fact is not the real flow; this suite proves the
    // REFUSAL, and the purge that produces it is asserted in
    // consult-capture-api.test.ts against a consult that opted out first.
    await db.consultCapture.updateMany({
      where: { consultSessionId: sessionId, purgedAt: null },
      data: { purgeEligibleAt: new Date(), purgeRequestedAt: new Date() },
    })

    await changeAnIntakeAnswer(sessionId, 'retention-no')
    const state = await resolveConsultRerunState(db, sessionId)
    expect(state.pending).toBe(true)
    expect(state.photosExpired).toBe(true)

    // 🔴 The thread ASKS, in the app's own voice. It does not spin for ninety
    // seconds and then fail, and it never answers from the old observations
    // (Part 0 rule 4).
    const t = await thread(sessionId)
    expect(
      t.messages.some(
        (m) =>
          m.kind === 'TEXT' &&
          m.text === defaultClientConsultThreadCopy.planNeedsPhoto,
      ),
    ).toBe(true)

    // And the promotion refuses rather than paying for a run it cannot feed.
    const refused = await startConsultAnalysisRerun({
      consultSessionId: sessionId,
      now: afterTheDebounce(),
    })
    expect(refused).toMatchObject({
      started: false,
      reason: 'ANALYSIS_PHOTOS_EXPIRED',
    })
  })
})

describe('the appointment closes the document', () => {
  it('refuses new input on a SPARK consult once its booking has started', async () => {
    const sessionId = await completedConsult('spark-appointment')

    // 🔴 The arm that did not exist. A look-anchored consult sets no
    // `ConsultSession.bookingId`, so every booking-time clause in the schema
    // skipped it — the whole Sept 5 flow could take input forever.
    await bookTheLook(sessionId, BookingStatus.IN_PROGRESS)

    await expect(
      changeAnIntakeAnswer(sessionId, 'spark-appointment'),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_STARTED' })

    await expect(
      retakePhoto(sessionId, 'hair_crown', 'spark-appointment'),
    ).rejects.toBeTruthy()

    // 🔴 But it is still READABLE. She is in the chair looking at the plan she
    // built — taking it off her screen at that exact moment would be the worst
    // possible time to do it.
    const t = await thread(sessionId)
    expect(ofKind(t.messages, 'PLAN')).toHaveLength(1)
    expect(ofKind(t.messages, 'QUESTION').length).toBeGreaterThan(0)

    // 🔴 And it SAYS so. A screen whose controls have all gone quietly inert is
    // a broken screen; the refusal code alone reaches nobody who did not tap.
    expect(
      t.messages.some(
        (m) => m.kind === 'TEXT' && m.text.includes('You’re in'),
      ),
    ).toBe(true)
  })

  it('leaves the consult open when the booking was cancelled instead', async () => {
    const sessionId = await completedConsult('spark-cancelled')
    await bookTheLook(sessionId, BookingStatus.CANCELLED)

    // A cancelled appointment is not an appointment that happened. She may
    // still change things and re-book the same look from the same consult —
    // and she cannot open a second one, because ConsultSession is unique per
    // (client, professional, look).
    await expect(
      changeAnIntakeAnswer(sessionId, 'spark-cancelled'),
    ).resolves.toBeTruthy()
  })

  it('keeps the early photo settled rather than asking for it again', async () => {
    const sessionId = await completedConsult('early-settled')
    await db.consultCapture.updateMany({
      where: {
        consultSessionId: sessionId,
        shotKey: CONSULT_EARLY_PHOTO_SHOT_KEY,
      },
      data: { purgeEligibleAt: new Date(), purgeRequestedAt: new Date() },
    })

    // 🔴 A PURGED capture is one that WAS accepted. Rendering it as outstanding
    // would ask her again for the photo that unlocked her own booking.
    const t = await thread(sessionId)
    const early = ofKind(t.messages, 'PHOTO_REQUEST').find(
      (m) => m.shot.key === CONSULT_EARLY_PHOTO_SHOT_KEY,
    )
    expect(early?.state).toBe('DONE')
    expect(t.nextOpenMessageId).toBeNull()
  })
})
