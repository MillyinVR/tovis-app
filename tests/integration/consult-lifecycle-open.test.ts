import { loadAuthorizedClientConsultResults } from '@/lib/consult/clientResults'
import { isRecord } from '@/lib/guards'
import { toPrismaJson } from '@/lib/typed/prismaJson'
import { loadLookBookingMaterialization } from '@/lib/consult/lookBookingMaterialization'
import { consultLookServiceReadiness } from '@/lib/consult/lookConfirmation'
import { authorProfessionalLookPlan } from '@/lib/consult/professionalLookPlan'
import { loadProLookBriefPhotos } from '@/lib/consult/lookBriefPhotos'
import { drainLookBriefReminders } from '@/lib/notifications/lookBriefReminders'
import { createHold, finalizeBookingFromHold, approveConsultationAndMaterializeBooking } from '@/lib/booking/writeBoundary'
import { resolveDiscoveryFinalize } from '@/lib/booking/resolveDiscoveryFinalize'
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { minutesSinceMidnightInTimeZone } from '@/lib/time'
import { answerConsultFollowUpQuestion } from '@/lib/consult/followUpContract'
import { chooseClientConsultLookPath, acknowledgeConsultLookBrief, adjustProfessionalConsultLook } from '@/lib/consult/lookBrief'
import { loadAuthorizedConsultBookingProposal } from '@/lib/consult/proposalEntry'
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
  BookingSource,
  BookingStatus,
  ConsultActorType,
  ConsultAnalysisRunStatus,
  ConsultCaptureStatus,
  ConsultRevisionKind,
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
const mockSuitability = vi.hoisted(() => vi.fn())
vi.mock('@/lib/consult/suitabilityRuntime', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/consult/suitabilityRuntime')>()
  return { ...original, optionalConsultSuitability: (args: Parameters<typeof original.optionalConsultSuitability>[0]) =>
    original.optionalConsultSuitability({ ...args, provider: mockSuitability }) }
})

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
import { unknownFaceColorProfile, validateConsultAnalysisProviderResult } from '@/lib/consult/analysisEngine'
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
  setFakeLookServices,
  setFakeAnalysisAchievability,
  fakeRunConsultAnalysis,
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
  const day = { enabled: true, start: '09:00', end: '18:00' }
  await seedLookConsultFixture(db, { tagPrefix: 'p7a3_open', bookable: true, advanceNoticeMinutes: 0, maxDaysAhead: 365,
    workingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } })
})

beforeEach(() => {
  delete process.env.AI_CONSULT_FACE_COLOR_ENABLED
  delete process.env.AI_CONSULT_SUITABILITY_ENABLED
  vi.clearAllMocks()
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: fx.clientId,
    user: { id: fx.clientUserId },
  })
})

const extraServiceIds: string[] = []
const extraCategoryIds: string[] = []

afterAll(async () => {
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await teardownLookConsultFixture(db)
  await db.service.deleteMany({ where: { id: { in: extraServiceIds } } })
  await db.serviceCategory.deleteMany({ where: { id: { in: extraCategoryIds } } })
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
  const suitabilityReply = (context: import('@/lib/consult/suitabilityTranslation').ConsultSuitabilityContext) => {
    const choice = context.sources.find(s => s.provenance === 'CLIENT_REPORTED' && (s.sentiment === 'LIKE' || s.sentiment === 'GOAL'))
    if (!choice) throw new Error('Fixture needs a desired choice')
    return { model: 'test-suitability-model', raw: {
      tailoring: [{ clientExplanation: 'Discuss soft placement with your pro.', professionalDirection: 'Consider soft placement.', clientChoiceIds: [choice.id], observationIds: [] }],
      proConfirmations: [{ clientExplanation: 'Your pro can check your starting color.', professionalCheck: 'Assess current tone in person.', sourceIds: [choice.id] }],
    } }
  }

  it('C2-2 persists exact source revisions atomically and keeps historical wire payloads unchanged', async () => {
    mockSuitability.mockImplementation(async ({ context }) => suitabilityReply(context))
    process.env.AI_CONSULT_SUITABILITY_ENABLED = 'true'
    const sessionId = await completedConsult('c2-suitability-persist')
    const row = await db.consultSuitabilityTranslation.findFirstOrThrow({ where: { consultSessionId: sessionId } })
    const analysis = await db.consultRevision.findUniqueOrThrow({ where: { id: row.analysisRevisionId } })
    const clientRevision = await db.consultRevision.findUniqueOrThrow({ where: { id: row.clientRevisionId } })
    expect(clientRevision.kind).toBe('INSPIRATION')
    expect(clientRevision.consultSessionId).toBe(sessionId)
    expect(clientRevision.revision).toBeLessThan(analysis.revision)
    expect(row.payload).toMatchObject({ analysisRevisionId: analysis.id, clientRevisionId: clientRevision.id, requiresProfessionalReview: true })
    expect(analysis.payload).not.toHaveProperty('suitability')
    expect(row.model).toBe('test-suitability-model')
    expect(mockSuitability).toHaveBeenCalledOnce()
    const clientResult = await loadAuthorizedClientConsultResults({ consultSessionId: sessionId, clientId: fx.clientId, actorUserId: fx.clientUserId })
    const proResult = (await loadAuthorizedProConsultBriefs({ professionalId: fx.professionalId, clientId: fx.clientId })).find(item => item.consultId === sessionId)
    expect(clientResult.suitability).toMatchObject({ analysisRevisionId: row.analysisRevisionId, clientRevisionId: row.clientRevisionId })
    expect(clientResult.suitability?.tailoring[0]?.explanation).toBe('Discuss soft placement with your pro.')
    expect(proResult?.suitability?.tailoring[0]?.direction).toBe('Consider soft placement.')
    expect(proResult?.suitability?.tailoring[0]?.sources[0]?.provenance).toBe('CLIENT_REPORTED')
    expect(JSON.stringify(clientResult.suitability)).not.toContain('sources')
    await expect(loadAuthorizedClientConsultResults({ consultSessionId: sessionId, clientId: 'other-client', actorUserId: 'other-user' })).rejects.toThrow()

    await expect(db.consultSuitabilityTranslation.update({ where: { id: row.id }, data: { model: 'changed' } })).rejects.toThrow()
    const duplicate = { consultSessionId: row.consultSessionId, analysisRevisionId: row.analysisRevisionId, clientRevisionId: row.clientRevisionId, schemaVersion: row.schemaVersion, promptVersion: row.promptVersion, model: row.model }
    if (!isRecord(row.payload)) throw new Error('Expected object payload')
    await expect(db.consultSuitabilityTranslation.create({ data: { ...duplicate, payload: toPrismaJson(row.payload) } })).rejects.toThrow()
    const security = await db.$queryRaw<Array<{ enabled: boolean; policies: bigint }>>`
      SELECT relrowsecurity AS enabled,
        (SELECT count(*) FROM pg_policies WHERE tablename = 'ConsultSuitabilityTranslation') AS policies
      FROM pg_class WHERE oid = 'public."ConsultSuitabilityTranslation"'::regclass`
    expect(security).toEqual([{ enabled: true, policies: BigInt(0) }])
    delete process.env.AI_CONSULT_SUITABILITY_ENABLED
    await changeAnIntakeAnswer(sessionId, 'c2-suitability-off')
    expect((await rerunNow(sessionId)).result).toBe('COMPLETED')
    expect(await db.consultSuitabilityTranslation.count({ where: { consultSessionId: sessionId } })).toBe(1)
    const current = await db.consultRevision.findFirstOrThrow({ where: { consultSessionId: sessionId, kind: 'ANALYSIS' }, orderBy: { revision: 'desc' } })
    expect(current.id).not.toBe(row.analysisRevisionId)
    expect(await db.consultSuitabilityTranslation.findUnique({ where: { analysisRevisionId: current.id } })).toBeNull()
    for (const sources of [undefined, [], {}, [{ provenance: 'OBSERVED', revisionId: 'wrong-revision' }], [{ provenance: 'OBSERVED' }]]) {
      const payload = { ...row.payload, analysisRevisionId: current.id,
        tailoring: [{ clientExplanation: 'Discuss placement.', professionalDirection: 'Consider soft placement.',
          ...(sources === undefined ? {} : { sources }) }] }
      await expect(db.consultSuitabilityTranslation.create({ data: { ...duplicate,
        analysisRevisionId: current.id, payload: toPrismaJson(payload) } })).rejects.toThrow(/suitability (guidance requires source citations|citation must pin its source revision)/)
    }
    const currentClientResult = await loadAuthorizedClientConsultResults({ consultSessionId: sessionId, clientId: fx.clientId, actorUserId: fx.clientUserId })
    expect(currentClientResult.suitability).toBeUndefined()
    const otherId = await completedConsult('c2-suitability-other')
    const other = await db.consultRevision.findFirstOrThrow({ where: { consultSessionId: otherId, kind: 'ANALYSIS' } })
    await expect(db.consultSuitabilityTranslation.create({ data: { ...duplicate, analysisRevisionId: other.id,
      payload: toPrismaJson({ ...row.payload, analysisRevisionId: other.id }) } })).rejects.toThrow()
  })

  it('C2-2 failure preserves the consultation and writes no false successful translation', async () => {
    process.env.AI_CONSULT_SUITABILITY_ENABLED = 'true'
    mockSuitability.mockRejectedValue(new Error('provider unavailable'))
    const sessionId = await completedConsult('c2-suitability-unavailable')
    expect(mockSuitability).toHaveBeenCalledOnce()
    expect(await db.consultSuitabilityTranslation.count({ where: { consultSessionId: sessionId } })).toBe(0)
    expect(await db.consultRevision.count({ where: { consultSessionId: sessionId, kind: 'ANALYSIS' } })).toBe(1)
  })

  it('C2-2 publishes only the winning translation when a slow worker loses its lease', async () => {
    const sessionId = await completedConsult('c2-suitability-lease')
    await changeAnIntakeAnswer(sessionId, 'c2-suitability-lease')
    const now = afterTheDebounce()
    const started = await startConsultAnalysisRerun({ consultSessionId: sessionId, now })
    if (!started.started) throw new Error('Expected queued rerun')
    process.env.AI_CONSULT_SUITABILITY_ENABLED = 'true'
    let calls = 0
    mockSuitability.mockImplementation(async ({ context }) => {
      calls++
      if (calls === 1) {
        // Advance the clock beyond the real lease while A is inside its call.
        const winner = await executeConsultAnalysisRun({ runId: started.run.runId, now: new Date(now.getTime() + 421_000) })
        expect(winner.result).toBe('COMPLETED')
      }
      return suitabilityReply(context)
    })
    const loser = await executeConsultAnalysisRun({ runId: started.run.runId, now })
    expect(loser.result).not.toBe('COMPLETED')
    expect(calls).toBe(2)
    expect(await db.consultSuitabilityTranslation.count({ where: { consultSessionId: sessionId } })).toBe(1)
    expect(await db.consultRevision.count({ where: { consultSessionId: sessionId, kind: 'ANALYSIS' } })).toBe(2)
    expect((await db.consultAnalysisRun.findUniqueOrThrow({ where: { id: started.run.runId } })).status).toBe('COMPLETED')
  })

  it('C2-2 discards paid suitability output when client inputs change during that call', async () => {
    const sessionId = await completedConsult('c2-suitability-race')
    await changeAnIntakeAnswer(sessionId, 'c2-suitability-race-before')
    process.env.AI_CONSULT_SUITABILITY_ENABLED = 'true'
    mockSuitability.mockImplementation(async ({ context }) => {
      await retakePhoto(sessionId, 'hair_back', 'c2-suitability-race-during')
      return suitabilityReply(context)
    })
    const result = await rerunNow(sessionId)
    expect(mockSuitability).toHaveBeenCalledOnce()
    expect(result.result).not.toBe('COMPLETED')
    expect(await db.consultSuitabilityTranslation.count({ where: { consultSessionId: sessionId } })).toBe(0)
    expect(await db.consultRevision.count({ where: { consultSessionId: sessionId, kind: 'ANALYSIS' } })).toBe(1)
  })

  it('C2-1 pins the Face & Color sibling to the exact completed analysis revision', async () => {
    process.env.AI_CONSULT_FACE_COLOR_ENABLED = 'true'
    const sessionId = await completedConsult('c2-face-color-persist')
    const analysis = await db.consultRevision.findFirstOrThrow({
      where: { consultSessionId: sessionId, kind: ConsultRevisionKind.ANALYSIS },
      orderBy: [{ revision: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })
    const faceColor = await db.consultFaceColorProfile.findUniqueOrThrow({
      where: { analysisRevisionId: analysis.id },
      select: { consultSessionId: true, schemaVersion: true, promptVersion: true, model: true, payload: true },
    })
    expect(faceColor.consultSessionId).toBe(sessionId)
    expect(faceColor.schemaVersion).toBe(1)
    expect(faceColor.promptVersion).toBe('face-color-companion-v1')
    expect(faceColor.model).toBe('fake-analysis-model')
    expect(faceColor.payload).toMatchObject({
      skinDepth: { value: 'MEDIUM' },
      surfaceOvertone: { value: 'BALANCED' },
      faceWidthBalance: { value: 'CHEEKBONE_DOMINANT' },
      browTailDirection: { value: 'LIFTED' },
    })
    expect(await db.consultFaceColorProfile.count({ where: { consultSessionId: sessionId } })).toBe(1)

    const brief = (await loadAuthorizedProConsultBriefs({
      professionalId: fx.professionalId,
      clientId: fx.clientId,
    })).find((item) => item.consultId === sessionId)
    expect(brief?.sourceAnalysisRevisionId).toBe(analysis.id)
    expect(brief?.profile).toMatchObject({
      skinDepth: { value: 'MEDIUM' },
      faceWidthBalance: { value: 'CHEEKBONE_DOMINANT' },
      browTailDirection: { value: 'LIFTED' },
    })
  })

  it('C2-1 database guards enforce immutable same-analysis evidence and deny direct access', async () => {
    const sessionId = await completedConsult('c2-guards')
    const analysis = await db.consultRevision.findFirstOrThrow({ where: { consultSessionId: sessionId, kind: 'ANALYSIS' } })
    const intake = await db.consultRevision.findFirstOrThrow({ where: { consultSessionId: sessionId, kind: 'INTAKE' } })
    const base = { consultSessionId: sessionId, analysisRevisionId: analysis.id,
      schemaVersion: 1, promptVersion: 'face-color-companion-v1', model: 'fake-analysis-model',
      payload: JSON.parse(JSON.stringify(unknownFaceColorProfile())) as Prisma.InputJsonObject }
    await expect(db.consultFaceColorProfile.create({ data: { ...base, analysisRevisionId: intake.id } })).rejects.toThrow()
    for (const skinDepth of [null, { value: null, confidence: { min: 0, max: 0.3 }, evidence: [] },
      { value: 'MEDIUM', confidence: { min: 0.4, max: 0.7 }, evidence: ['early_photo'] },
      { value: 'MEDIUM', confidence: { min: 0.4, max: 0.7 }, evidence: ['hair_back'] },
      { value: 'MEDIUM', confidence: { min: 0.4, max: 0.7 }, evidence: ['eyes_closeup'] }]) {
      await expect(db.consultFaceColorProfile.create({ data: { ...base, payload: { ...base.payload, skinDepth } } })).rejects.toThrow()
    }
    const otherSessionId = await completedConsult('c2-other-session')
    await expect(db.consultFaceColorProfile.create({ data: { ...base, consultSessionId: otherSessionId } })).rejects.toThrow()
    const row = await db.consultFaceColorProfile.create({ data: base })
    await expect(db.consultFaceColorProfile.update({ where: { id: row.id }, data: { model: 'edited' } })).rejects.toThrow()
    await expect(db.consultFaceColorProfile.create({ data: base })).rejects.toThrow()
    const security = await db.$queryRaw<Array<{ enabled: boolean; policies: bigint }>>`
      SELECT relrowsecurity AS enabled,
        (SELECT count(*) FROM pg_policies WHERE tablename = 'ConsultFaceColorProfile') AS policies
      FROM pg_class WHERE oid = 'public."ConsultFaceColorProfile"'::regclass`
    expect(security).toEqual([{ enabled: true, policies: BigInt(0) }])
  })

  it('C2-1 historical and flag-disabled reruns keep the old profile and do not borrow older companion evidence', async () => {
    const sessionId = await completedConsult('c2-historical')
    const readBrief = async () => (await loadAuthorizedProConsultBriefs({ professionalId: fx.professionalId, clientId: fx.clientId }))
      .find(item => item.consultId === sessionId)
    const historical = await readBrief()
    expect(historical?.profile.skinDepth?.value).toBe('UNKNOWN')
    expect(await db.consultFaceColorProfile.count({ where: { consultSessionId: sessionId } })).toBe(0)
    process.env.AI_CONSULT_FACE_COLOR_ENABLED = 'true'
    await changeAnIntakeAnswer(sessionId, 'c2-on')
    expect((await rerunNow(sessionId)).result).toBe('COMPLETED')
    expect((await readBrief())?.profile.skinDepth?.value).toBe('MEDIUM')
    delete process.env.AI_CONSULT_FACE_COLOR_ENABLED
    await changeAnIntakeAnswer(sessionId, 'c2-off')
    expect((await rerunNow(sessionId)).result).toBe('COMPLETED')
    expect((await readBrief())?.profile.skinDepth?.value).toBe('UNKNOWN')
    expect((await readBrief())?.profile.skinUndertone).toEqual(historical?.profile.skinUndertone)
    expect(await db.consultFaceColorProfile.count({ where: { consultSessionId: sessionId } })).toBe(1)
  })

  it('C2-1 discards companion evidence when client input changes during provider work', async () => {
    process.env.AI_CONSULT_FACE_COLOR_ENABLED = 'true'
    const sessionId = await completedConsult('c2-stale')
    await changeAnIntakeAnswer(sessionId, 'c2-stale-queue')
    const now = afterTheDebounce()
    const started = await startConsultAnalysisRerun({ consultSessionId: sessionId, now })
    if (!started.started) throw new Error(started.reason)
    const result = await executeConsultAnalysisRun({ runId: started.run.runId, now,
      provider: async input => {
        const result = await fakeRunConsultAnalysis(input)
        await changeAnIntakeAnswer(sessionId, 'c2-stale-inflight')
        return validateConsultAnalysisProviderResult(result, { menuServiceNames: input.service.menuServiceNames,
          suppliedShotKeys: input.captures.map(capture => capture.shotKey) })
      },
    })
    expect(result.result).not.toBe('COMPLETED')
    expect(await db.consultRevision.count({ where: { consultSessionId: sessionId, kind: 'ANALYSIS' } })).toBe(1)
    expect(await db.consultFaceColorProfile.count({ where: { consultSessionId: sessionId } })).toBe(1)
  })

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


describe('the first look plan is an honest draft', () => {
  it('runs from one selfie, inspiration cards and upkeep without claiming completed history', async () => {
    vi.stubEnv('AI_CONSULT_LOOK_PLANS_ENABLED', 'true')
    try {
      const lookId = await createLook(db, fx.balayageServiceId)
      const sessionId = await runConsultToCompletion(db, lookId, 'p8-minimum',
        { maintenance_tolerance: 'medium' }, { provisional: true })
      const current = await thread(sessionId)
      const plan = ofKind(current.messages, 'PLAN')[0]?.results?.lookPlan
      expect(plan?.status).toBe('NEEDS_INPUT')
      expect(plan?.provisional).toBe(true)
      expect(plan?.summary).toContain('Keep your length')
      expect(plan?.paths[0]?.visits[0]?.steps[0]?.serviceId).toBe(fx.balayageServiceId)
      const intake = await db.consultRevision.findFirstOrThrow({
        where: { consultSessionId: sessionId, kind: 'INTAKE' }, orderBy: { revision: 'desc' },
      })
      expect(intake.payload).toMatchObject({ complete: false, answers: { maintenance_tolerance: 'medium' } })
      expect(await db.consultCapture.count({ where: { consultSessionId: sessionId, status: 'ACCEPTED' } })).toBe(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('choosing a versioned look', () => {
  it('requires an explicit choice, saves a separate required-step estimate and rejects a stale choice', async () => {
    vi.stubEnv('AI_CONSULT_LOOK_PLANS_ENABLED', 'true')
    try {
      const lookId = await createLook(db, fx.balayageServiceId)
      const sessionId = await runConsultToCompletion(db, lookId, 'p8-choice')
      const current = await thread(sessionId)
      const results = ofKind(current.messages, 'PLAN')[0]?.results
      expect(results?.lookPlan?.status).toBe('READY_TO_CHOOSE')
      expect(results?.lookBrief?.version).toBe(1)
      expect(current.book.enabled).toBe(false)
      expect(current.book.reason).toBe('LOOK_CHOICE_REQUIRED')
      const scope = { consultSessionId: sessionId, clientId: fx.clientId, actorUserId: fx.clientUserId }
      const args = { ...scope, expectedVersion: 1, pathIndex: 0, locationType: 'SALON' as const, idempotencyKey: 'p8-choice-once' }
      const chosen = await chooseClientConsultLookPath(args)
      expect(chosen).toMatchObject({ version: 2, selectedPathIndex: 0, selectedLocationType: 'SALON', clientConfirmed: false, professionalConfirmed: false })
      expect(await chooseClientConsultLookPath(args)).toEqual(chosen)
      await expect(chooseClientConsultLookPath({ ...args, idempotencyKey: 'stale' })).rejects.toMatchObject({ code: 'ANALYSIS_SUPERSEDED' })
      const estimates = await db.consultServiceEstimate.findMany({ where: { consultSessionId: sessionId }, orderBy: { createdAt: 'asc' }, include: { lines: true } })
      expect(estimates).toHaveLength(2)
      expect(estimates[0]?.refusalCode).toBe('LOOK_PLAN_SELECTION_REQUIRED')
      expect(estimates[1]?.lines.map(line => line.source)).toEqual(['LOOK_PLAN_REQUIRED'])
      const proposal = await loadAuthorizedConsultBookingProposal({ ...scope, locationType: 'SALON', enhancementSelection: [] })
      expect(proposal.available).toBe(true)
      expect(proposal.proposal?.lines).toHaveLength(1)
      expect((await thread(sessionId)).book.proposalConsultId).toBe(sessionId)
      const clientConfirmed = await acknowledgeConsultLookBrief({ ...scope, expectedVersion: 2 })
      expect(clientConfirmed?.clientConfirmed).toBe(true)
      const proScope = { consultSessionId: sessionId, professionalId: fx.professionalId, actorUserId: fx.proUserId }
      expect((await acknowledgeConsultLookBrief({ ...proScope, expectedVersion: 2 }))?.professionalConfirmed).toBe(true)
      const offeringId = chosen?.pathEstimates[0]?.visits[0]?.steps[0]?.offeringId
      if (!offeringId) throw new Error('Missing selected offering')
      const adjustment = { field: 'PRICE' as const, pathIndex: 0, visitIndex: 0, offeringId,
        locationType: 'SALON' as const, value: '125.50', reason: 'The client wants a softer first step.', professionalId: fx.professionalId }
      const adjusted = await adjustProfessionalConsultLook({ ...proScope, expectedVersion: 2, adjustments: [adjustment], idempotencyKey: 'pro-adjust-once' })
      expect(adjusted).toMatchObject({ version: 3, clientConfirmed: false, professionalConfirmed: false })
      expect(adjusted?.pathEstimates[0]?.firstAppointment.price).toBe('125.50')
      expect((await loadAuthorizedConsultBookingProposal({ ...scope, locationType: 'SALON', enhancementSelection: [] })).proposal?.startingAtPrice).toBe('125.50')
      await expect(acknowledgeConsultLookBrief({ ...scope, expectedVersion: 2 })).rejects.toMatchObject({ code: 'ANALYSIS_SUPERSEDED' })
      const old = await db.consultLookBriefVersion.findFirstOrThrow({ where: { consultSessionId: sessionId, version: 2 } })
      expect(old.clientAcknowledgedAt).not.toBeNull()
      expect(old.professionalAcknowledgedAt).not.toBeNull()
      await changeAnIntakeAnswer(sessionId, 'p10-confirmation-reset')
      const updated = ofKind((await thread(sessionId)).messages, 'PLAN')[0]?.results?.lookBrief
      expect(updated).toMatchObject({ version: 4, awaitingAnalysis: true, clientConfirmed: false, professionalConfirmed: false })
      expect(updated?.adjustments).toEqual([adjustment])
      await expect(acknowledgeConsultLookBrief({ ...scope, expectedVersion: 4 })).rejects.toMatchObject({ code: 'ANALYSIS_SUPERSEDED' })
      expect((await thread(sessionId)).book.enabled).toBe(false)
      const manualInput = { expectedVersion: 4, idempotencyKey: 'pro-authored-plan', tier: 'CLOSE' as const,
        title: 'Soft dimension', summary: 'Keep your length with softer brightness around your face.',
        whyThisWorksForYou: 'This matches your preferred softness and upkeep.', reviewNote: 'Reviewed the new history and current starting point.',
        reviewedClientDetails: true as const, visits: [[fx.balayageOfferingId], [fx.balayageOfferingId]] }
      const authored = await authorProfessionalLookPlan({ ...proScope, input: manualInput })
      expect(authored).toMatchObject({ version: 5, awaitingAnalysis: false, selectedPathIndex: null, invalidatedProfessionalPlan: false })
      expect(authored?.professionalPlan?.paths[0]?.sessionCount).toBe(2)
      expect(await authorProfessionalLookPlan({ ...proScope, input: manualInput })).toEqual(authored)
      const proResults = ofKind((await thread(sessionId)).messages, 'PLAN')[0]?.results
      expect(proResults?.lookPlan?.tier).toBe('CLOSE')
      expect(proResults?.lookPlan?.status).toBe('READY_TO_CHOOSE')
      await chooseClientConsultLookPath({ ...scope, expectedVersion: 5, pathIndex: 0, locationType: 'SALON', idempotencyKey: 'choose-pro-plan' })
      const proProposal = await loadAuthorizedConsultBookingProposal({ ...scope, locationType: 'SALON', enhancementSelection: [] })
      expect(proProposal.proposal?.totalDurationMinutes).toBe(60)
      expect(proProposal.proposal?.startingAtPrice).toBe('180.00')
      expect((await rerunNow(sessionId)).result).toBe('COMPLETED')
      const refreshed = ofKind((await thread(sessionId)).messages, 'PLAN')[0]?.results
      expect(refreshed?.lookBrief?.invalidatedProfessionalPlan).toBe(true)
      expect(refreshed?.lookPlan?.status).toBe('PRO_REVIEW')
      expect((await thread(sessionId)).book.enabled).toBe(false)

    } finally { vi.unstubAllEnvs() }
  }, 30_000)
})

describe('color and layers from an extensions reference', () => {
  it('asks the relevant color history before choosing required color and cut, never extensions', async () => {
    vi.stubEnv('AI_CONSULT_LOOK_PLANS_ENABLED', 'true')
    vi.stubEnv('AI_CONSULT_FACE_COLOR_ENABLED', 'true')
    try {
      const category = await db.serviceCategory.create({ data: { name: `${fx.tag} hair shape`, slug: `${fx.tag}-hair-shape`, consultFamily: 'HAIR' } })
      extraCategoryIds.push(category.id)
      const extensions = await db.service.create({ data: { name: `${fx.tag} Extensions`, categoryId: category.id, defaultDurationMinutes: 180, minPrice: 300 } })
      const cut = await db.service.create({ data: { name: `${fx.tag} Layered cut`, categoryId: category.id, defaultDurationMinutes: 30, minPrice: 0 } })
      extraServiceIds.push(extensions.id, cut.id)
      await db.professionalServiceOffering.createMany({ data: [
        { professionalId: fx.professionalId, serviceId: extensions.id, offersInSalon: true, salonPriceStartingAt: 300, salonDurationMinutes: 180 },
        { professionalId: fx.professionalId, serviceId: cut.id, offersInSalon: true, salonPriceStartingAt: 0, salonDurationMinutes: 30 },
      ] })
      const color = await db.service.findUniqueOrThrow({ where: { id: fx.balayageServiceId } })
      setFakeLookServices([color.name, cut.name])
      const lookId = await createLook(db, extensions.id)
      const sessionId = await runConsultToCompletion(db, lookId, 'p8-color-not-extensions', {
        maintenance_tolerance: 'medium', change_scale: 'noticeable', chemical_history: 'over-12-months', prior_lightening: 'never', prior_reaction: 'no',
      }, { packVersion: 3 })
      const first = await thread(sessionId)
      const result = ofKind(first.messages, 'PLAN')[0]?.results
      expect(result?.lookPlan?.status).toBe('NEEDS_INPUT')
      expect(result?.lookPlan?.paths[0]?.visits[0]?.steps.map(step => step.serviceId)).toEqual([color.id, cut.id])
      expect(first.book.enabled).toBe(false)
      const fallback = { provider: async () => { throw new Error('Test uses canonical safety questions') } }
      for (const key of ['box_dye_history', 'henna_plant_dye_history', 'other_chemical_history']) {
        const current = await thread(sessionId)
        expect(current.messages.some(message => message.kind === 'FOLLOW_UP' && message.questionKey === key)).toBe(true)
        await answerConsultFollowUpQuestion({ consultSessionId: sessionId, clientId: fx.clientId, actor: client(),
          questionKey: key, selectedValues: ['never'], idempotencyKey: `cross-history-${key}` }, fallback)
      }
      // The caller kept chart copies, so the rerun can reuse the accepted images.
      expect((await rerunNow(sessionId)).result).toBe('COMPLETED')
      const proBrief = (await loadAuthorizedProConsultBriefs({ professionalId: fx.professionalId, clientId: fx.clientId }))
        .find(item => item.consultId === sessionId)
      expect(proBrief?.profile.skinDepth?.value).toBe('MEDIUM')
      expect(await db.consultFaceColorProfile.count({ where: { consultSessionId: sessionId } })).toBe(2)
      const ready = ofKind((await thread(sessionId)).messages, 'PLAN')[0]?.results
      expect(ready?.lookPlan?.status).toBe('READY_TO_CHOOSE')
      const version = ready?.lookBrief?.version
      if (!version) throw new Error('Missing current look version')
      const chosen = await chooseClientConsultLookPath({ consultSessionId: sessionId, clientId: fx.clientId, actorUserId: fx.clientUserId,
        expectedVersion: version, pathIndex: 0, locationType: 'SALON', idempotencyKey: 'choose-color-cut' })
      expect(chosen?.additionalClientAnswers.map(item => item.questionKey)).toEqual(['box_dye_history', 'henna_plant_dye_history', 'other_chemical_history'])
      const proposal = await loadAuthorizedConsultBookingProposal({ consultSessionId: sessionId, clientId: fx.clientId, actorUserId: fx.clientUserId,
        locationType: 'SALON', enhancementSelection: [] })
      expect(proposal.available).toBe(true)
      expect(proposal.proposal?.serviceId).toBe(color.id)
      expect(proposal.proposal?.lines.map(line => line.serviceName)).toEqual([color.name, cut.name])
      expect(proposal.proposal?.totalDurationMinutes).toBe(90)
      expect(proposal.proposal?.startingAtPrice).toBe('180.00')
      const offering = {
        id: fx.balayageOfferingId, professionalId: fx.professionalId, serviceId: color.id,
        serviceCategoryId: fx.categoryId, offersInSalon: true, offersMobile: false,
        salonDurationMinutes: 50, mobileDurationMinutes: null,
        salonPriceStartingAt: new Prisma.Decimal('180'), mobilePriceStartingAt: null, professionalTimeZone: ZONE,
      }
      const anchor = new Date(Date.now() + 4 * 24 * 60 * 60_000)
      anchor.setUTCHours(20, 0, 0, 0)
      const start = new Date(anchor.getTime() + (600 - minutesSinceMidnightInTimeZone(anchor, ZONE)) * 60_000)
      const held = await createHold({ clientId: fx.clientId, bookingEntryPoint: 'DIRECT_PROFILE', addOnIds: [],
        consultId: sessionId, offering, requestedStart: start, requestedLocationId: fx.locationId,
        locationType: 'SALON', clientAddressId: null })
      expect(held.hold.durationMinutes).toBe(90)
      const discovery = await resolveDiscoveryFinalize({ clientId: fx.clientId, clientUserId: fx.clientUserId,
        professionalId: fx.professionalId, offeringId: offering.id, lookPostId: lookId, mediaId: null,
        source: BookingSource.REQUESTED, aftercare: false })
      expect(discovery.sourceLookPostId).toBe(lookId)
      const finalized = await finalizeBookingFromHold({ clientId: fx.clientId, bookingEntryPoint: 'DIRECT_PROFILE',
        holdId: held.hold.id, openingId: null, addOnIds: [], consultEnhancementLineIds: [], locationType: 'SALON',
        source: BookingSource.REQUESTED, consultId: sessionId, initialStatus: getClientSubmittedBookingStatus(true),
        rebookOfBookingId: null, offering, discovery, cancellationPolicySnapshot: null,
        cancellationPolicyAcceptedAt: null, fallbackTimeZone: 'UTC', idempotencyKey: 'cross-color-cut-booking' })
      bookingIds.push(finalized.booking.id)
      const booked = await db.booking.findUniqueOrThrow({ where: { id: finalized.booking.id }, select: {
        totalDurationMinutes: true, sourceConsultSessionId: true, sourceLookPostId: true,
        serviceItems: { select: { serviceId: true } },
      } })
      expect(booked.totalDurationMinutes).toBe(90)
      expect(booked.sourceConsultSessionId).toBe(sessionId)
      expect(booked.sourceLookPostId).toBe(lookId)
      expect(booked.serviceItems.map(item => item.serviceId).sort()).toEqual([color.id, cut.id].sort())
      const reviewScope = { consultSessionId: sessionId, professionalId: fx.professionalId, actorUserId: fx.proUserId }
      const photos = await loadProLookBriefPhotos(reviewScope)
      expect(photos.captures.length).toBeGreaterThan(0)
      expect(photos.inspirationUrl).not.toBeNull()
      await expect(loadProLookBriefPhotos({ ...reviewScope, actorUserId: fx.clientUserId })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect(await db.$transaction(tx => consultLookServiceReadiness(tx, sessionId, booked.sourceConsultSessionId ? finalized.booking.id : 'missing'))).toContain('must confirm')
      const remindAt = new Date(start.getTime() - 60 * 60_000)
      await drainLookBriefReminders(remindAt)
      const reminderWhere = { professionalId: fx.professionalId, dedupeKey: { startsWith: `look-review:${chosen?.id}:` } }
      expect(await db.notification.count({ where: reminderWhere })).toBe(1)
      await drainLookBriefReminders(remindAt)
      expect(await db.notification.count({ where: reminderWhere })).toBe(1)
      if (!chosen) throw new Error('Missing chosen version')
      await acknowledgeConsultLookBrief({ ...reviewScope, expectedVersion: chosen.version })
      await acknowledgeConsultLookBrief({ consultSessionId: sessionId, clientId: fx.clientId,
        actorUserId: fx.clientUserId, expectedVersion: chosen.version })
      await drainLookBriefReminders(new Date(start.getTime() - 30 * 60_000))
      expect(await db.notification.count({ where: reminderWhere })).toBe(1)
      expect(await db.$transaction(tx => consultLookServiceReadiness(tx, sessionId, finalized.booking.id))).toBeNull()
      // Arrival closes client refinements, but the pro can still correct the
      // shared plan during the in-person consultation before service begins.
      await db.booking.update({ where: { id: finalized.booking.id }, data: { status: 'IN_PROGRESS', sessionStep: 'CONSULTATION' } })
      await expect(changeAnIntakeAnswer(sessionId, 'client-after-arrival')).rejects.toThrow()
      // A later pro correction does not silently resize or reprice the booking.
      let revised = await adjustProfessionalConsultLook({ ...reviewScope, expectedVersion: chosen.version,
        idempotencyKey: 'booked-look-revised-time', adjustments: [
          { field: 'PRICE', pathIndex: 0, visitIndex: 0, offeringId: fx.balayageOfferingId, locationType: 'SALON',
            value: '200.00', reason: 'More work for this starting point', professionalId: fx.professionalId },
          { field: 'DURATION', pathIndex: 0, visitIndex: 0, offeringId: fx.balayageOfferingId, locationType: 'SALON',
            value: '120', reason: 'Allow enough time', professionalId: fx.professionalId },
        ] })
      if (!revised) throw new Error('Missing revised brief')
      revised = await chooseClientConsultLookPath({ consultSessionId: sessionId, clientId: fx.clientId,
        actorUserId: fx.clientUserId, expectedVersion: revised.version, pathIndex: 0,
        locationType: 'SALON', idempotencyKey: 'arrival-reviewed-choice' })
      if (!revised) throw new Error('Missing arrival choice')
      expect(revised.reservedDurationMinutes).toBe(90)
      expect(revised.pathEstimates[0]?.firstAppointment.durationMinutes).toBe(150)
      const timing = await db.$transaction(tx => loadLookBookingMaterialization(tx, { consultSessionId: sessionId, locationType: 'SALON' }))
      expect(timing?.durations.get(fx.balayageOfferingId)).toBe(120)
      const cutOffering = await db.professionalServiceOffering.findFirstOrThrow({ where: { professionalId: fx.professionalId, serviceId: cut.id } })
      const quotedItems = [
        { offeringId: fx.balayageOfferingId, serviceId: color.id, itemType: 'BASE', sortOrder: 0, price: '200.00', durationMinutes: 1 },
        { offeringId: cutOffering.id, serviceId: cut.id, itemType: 'BASE', sortOrder: 1, price: '0.00', durationMinutes: 1 },
      ]
      const approval = await db.consultationApproval.create({ data: { bookingId: finalized.booking.id, clientId: fx.clientId,
        proId: fx.professionalId, status: 'PENDING', proposedTotal: 200,
        proposedServicesJson: { items: quotedItems, lookBriefVersionId: chosen.id } } })
      const approveArgs = { bookingId: finalized.booking.id, clientId: fx.clientId, professionalId: fx.professionalId }
      await expect(approveConsultationAndMaterializeBooking(approveArgs)).rejects.toMatchObject({ code: 'INVALID_SERVICE_ITEMS' })
      await db.consultationApproval.update({ where: { id: approval.id }, data: {
        proposedServicesJson: { items: quotedItems, lookBriefVersionId: revised.id } } })
      const block = await db.calendarBlock.create({ data: { professionalId: fx.professionalId, locationId: fx.locationId,
        startsAt: new Date(start.getTime() + 120 * 60_000), endsAt: new Date(start.getTime() + 140 * 60_000), note: 'Look extension test' } })
      try { await expect(approveConsultationAndMaterializeBooking(approveArgs)).rejects.toMatchObject({ code: 'TIME_BLOCKED' }) }
      finally { await db.calendarBlock.delete({ where: { id: block.id } }) }
      expect((await db.booking.findUniqueOrThrow({ where: { id: finalized.booking.id } })).totalDurationMinutes).toBe(90)
      await approveConsultationAndMaterializeBooking(approveArgs)
      const agreedBooking = await db.booking.findUniqueOrThrow({ where: { id: finalized.booking.id } })
      expect(agreedBooking.totalDurationMinutes).toBe(150)
      expect(agreedBooking.serviceSubtotalSnapshot?.toFixed(2)).toBe('200.00')
      await expect(db.$executeRaw`UPDATE "Booking" SET "sessionStep" = 'SERVICE_IN_PROGRESS' WHERE id = ${finalized.booking.id}`)
        .rejects.toThrow('both participants must confirm')
      await acknowledgeConsultLookBrief({ ...reviewScope, expectedVersion: revised.version })
      await acknowledgeConsultLookBrief({ consultSessionId: sessionId, clientId: fx.clientId, actorUserId: fx.clientUserId, expectedVersion: revised.version })
      expect(await db.$transaction(tx => consultLookServiceReadiness(tx, sessionId, finalized.booking.id))).toBeNull()
      await expect(db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Booking" SET "sessionStep" = 'SERVICE_IN_PROGRESS' WHERE id = ${finalized.booking.id}`
        expect((await tx.booking.findUniqueOrThrow({ where: { id: finalized.booking.id } })).sessionStep).toBe('SERVICE_IN_PROGRESS')
        throw new Error('verified service start; roll back test transition')
      })).rejects.toThrow('verified service start; roll back test transition')
      const serviceStart = new Date(Date.now() - 10 * 60 * 60_000)
      const serviceEnd = new Date(serviceStart.getTime() + 75 * 60_000)
      await db.bookingCloseoutAuditLog.createMany({ data: [
        { bookingId: finalized.booking.id, professionalId: fx.professionalId, action: 'SESSION_STEP_CHANGED', route: 'test-service-start',
          createdAt: serviceStart, oldValue: { sessionStep: 'BEFORE_PHOTOS' }, newValue: { sessionStep: 'SERVICE_IN_PROGRESS' } },
        { bookingId: finalized.booking.id, professionalId: fx.professionalId, action: 'SESSION_STEP_CHANGED', route: 'test-service-finish',
          createdAt: serviceEnd, oldValue: { sessionStep: 'SERVICE_IN_PROGRESS' }, newValue: { sessionStep: 'FINISH_REVIEW' } },
      ] })
      // Exercise the database completion hook. Delayed payment/aftercare closeout
      // must not teach the consult that 75 minutes of service took ten hours.
      await db.booking.update({ where: { id: finalized.booking.id }, data: { status: 'COMPLETED', sessionStep: 'DONE',
        startedAt: serviceStart, finishedAt: new Date(), serviceSubtotalSnapshot: 200 } })
      const outcome = await db.consultLookVisitOutcome.findUniqueOrThrow({ where: { bookingId: finalized.booking.id } })
      expect(outcome.observedServiceMinutes).toBe(75)
      expect(outcome.finalServiceSubtotal?.toFixed(2)).toBe('200.00')
      await expect(db.consultLookVisitOutcome.update({ where: { id: outcome.id }, data: { observedServiceMinutes: 999 } })).rejects.toThrow('immutable')
      const completed = ofKind((await thread(sessionId)).messages, 'PLAN')[0]?.results?.lookBrief
      expect(completed?.completedVisit).toMatchObject({ observedServiceMinutes: 75, finalServiceSubtotal: '200.00', aftercare: null })
      const care = await db.aftercareSummary.create({ data: { bookingId: finalized.booking.id, notes: 'Private draft',
        careSections: { create: { label: 'At home', body: 'Use the agreed gentle routine.', sortOrder: 0 } } } })
      expect(ofKind((await thread(sessionId)).messages, 'PLAN')[0]?.results?.lookBrief?.completedVisit?.aftercare).toBeNull()
      await db.aftercareSummary.update({ where: { id: care.id }, data: { sentToClientAt: new Date(), notes: 'Your home care plan' } })
      expect(ofKind((await thread(sessionId)).messages, 'PLAN')[0]?.results?.lookBrief?.completedVisit?.aftercare)
        .toMatchObject({ notes: 'Your home care plan', sections: [{ label: 'At home', body: 'Use the agreed gentle routine.' }] })
      await expect(db.consultLookVisitOutcome.create({ data: { ...outcome, id: 'forged-outcome', bookingId: 'missing-booking-for-forged-feedback' } }))
        .rejects.toThrow('completed consultation feedback requires')
    } finally { vi.unstubAllEnvs() }
  }, 30_000)
})
