import { writeFileSync } from 'node:fs'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

// Only the C6/C7 SERVE gate is stubbed — it is a founder allowlist a synthetic
// fixture pro can never be on. The C1–C5 founder gate this slice depends on
// stays real, driven by ENABLE_AI_CONSULT in the fixture.
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


import { seedLookConsultFixture, teardownLookConsultFixture, fx, runConsultToCompletion, createLook, attachAcceptedCapture, jsonRequest, body } from './_support/lookConsultFixture'
import { purgeConsultSessionRawObjects } from '@/lib/consult/capturePurge'
import { resetConsultLookFakes, fakeStorageObjects } from './_support/consultLookFakes'
import { loadConsultChartSources } from '@/lib/consult/chartReview'
import { CONSULT_CAPTURE_BUCKET } from '@/lib/consult/captureStorage'
import { loadClientChartFacts } from '@/lib/consult/chartFacts'
import { loadConsultIntakeState } from '@/lib/consult/intakeContract'
import { answerConsultChartReview, answerConsultChartFact } from '@/lib/consult/chartReviewContract'
import { acceptConsultAgreement, appendConsultIntakeRevision } from '@/lib/consult/writeBoundary'
import { POST as startLookConsult } from '@/app/api/v1/client/consult/look/route'
import { HAIR_COLOR_INTAKE_PACK } from '@/lib/consult/intake/packs/hairColor'
import { loadAuthorizedProConsultBriefs } from '@/lib/consult/proBrief'
import { ConsultActorType, ConsultAgreementKind } from '@prisma/client'
const db = new PrismaClient()
const clean = { maintenance_tolerance: 'medium', change_scale: 'noticeable', box_dye_history: 'never', prior_lightening: 'never',
  henna_plant_dye_history: 'never', other_chemical_history: 'never', prior_reaction: 'no' }
const currentSessions: string[] = []
let sourcePhotoId = ''
beforeAll(async () => {
  await seedLookConsultFixture(db, { tagPrefix: 'chart_cycle_c' })
  mockRequireClient.mockResolvedValue({ ok: true, clientId: fx.clientId, user: { id: fx.clientUserId } })
  resetConsultLookFakes()
  for (let index = 0; index < 2; index++) {
    const consult = await runConsultToCompletion(db, await createLook(db, fx.balayageServiceId), `chart-history-${index}`, clean)
    const booking = await db.booking.create({ data: { clientId: fx.clientId, professionalId: fx.professionalId,
      serviceId: fx.balayageServiceId, proTenantId: fx.tenantId, clientHomeTenantId: fx.tenantId,
      sourceConsultSessionId: consult, scheduledFor: new Date(Date.now() - (index + 1) * 86400000), finishedAt: new Date(), status: 'COMPLETED',
      locationType: 'SALON', locationId: fx.locationId, locationTimeZone: 'America/Los_Angeles',
      subtotalSnapshot: new Prisma.Decimal(180), totalAmount: new Prisma.Decimal(180), totalDurationMinutes: 60 } })
    if (index === 1) {
      const capture = await db.consultCapture.findFirstOrThrow({ where: { consultSessionId: consult, shotKey: 'early_photo' } })
      const storagePath = `consult-chart/v1/${consult}/early_photo-${capture.id}.jpg`
      fakeStorageObjects.set(storagePath, { contentType: 'image/jpeg', sizeBytes: 123456, checksumSha256: 'a'.repeat(64) })
      const media = await db.mediaAsset.create({ data: { professionalId: fx.professionalId, proTenantId: fx.tenantId,
        primaryServiceId: fx.balayageServiceId, bookingId: booking.id, mediaType: 'IMAGE', visibility: 'PRO_CLIENT', phase: 'BEFORE',
        storageBucket: CONSULT_CAPTURE_BUCKET, storagePath } })
      sourcePhotoId = media.id
    }

  }
  process.env.AI_CONSULT_CHART_PREFILL_ENABLED = 'true'
})
beforeEach(() => { mockRequireClient.mockResolvedValue({ ok: true, clientId: fx.clientId, user: { id: fx.clientUserId } }) })
afterAll(async () => {
  delete process.env.AI_CONSULT_LOOK_PLANS_ENABLED; delete process.env.AI_CONSULT_CHART_PREFILL_ENABLED; delete process.env.AI_CONSULT_MENTOR_ENABLED
  await teardownLookConsultFixture(db, async () => {
    await db.mediaAsset.deleteMany({ where: { id: sourcePhotoId } })
    await db.booking.deleteMany({ where: { clientId: fx.clientId } })
    for (const id of currentSessions) await purgeConsultSessionRawObjects(id)
    await db.consultSession.deleteMany({ where: { id: { in: currentSessions } } })
  })
  await db.$disconnect()
})
async function startCurrent() {
  const response = await startLookConsult(jsonRequest('/api/v1/client/consult/look', { lookPostId: await createLook(db, fx.balayageServiceId) }))
  expect(response.status).toBe(200)
  const data = await body(response)
  if (!data.consult || typeof data.consult !== 'object' || !('id' in data.consult) || typeof data.consult.id !== 'string') throw new Error('Missing consult')
  const id = data.consult.id; currentSessions.push(id)
  for (const [kind, agreementVersionId] of [[ConsultAgreementKind.SENSITIVE_DATA_CONSENT, fx.consentVersionId], [ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION, fx.adultVersionId]] as const) {
    await acceptConsultAgreement({ consultSessionId: id, agreementVersionId, expectedKind: kind,
      actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId } })
  }
  await attachAcceptedCapture(db, id, 'early_photo', `current-${currentSessions.length}`)
  await appendConsultIntakeRevision({ consultSessionId: id, actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId },
    loadInput: async () => ({ idempotencyKey: `goals-${id}`, packVersion: HAIR_COLOR_INTAKE_PACK.version, schemaVersion: HAIR_COLOR_INTAKE_PACK.schemaVersion,
      complete: false, answers: { maintenance_tolerance: 'medium', change_scale: 'noticeable' } }) })
  return id
}
async function state(id: string) { return loadConsultIntakeState({ consultSessionId: id, clientId: fx.clientId }) }

it('two completed visits reduce history prep to one confirmation and one reaction question', async () => {
  const id = await startCurrent()
  const before = await state(id)
  expect(before.chartReview?.facts).toHaveLength(4)
  const fingerprint = before.chartReview!.fingerprint
  await answerConsultChartReview({ consultSessionId: id, actorUserId: fx.clientUserId, fingerprint, decision: 'CONFIRMED', idempotencyKey: 'confirmed' })
  const after = await state(id)
  expect(after.chartReview).toBeUndefined()
  expect(after.latestRevision?.answers).toMatchObject({ box_dye_history: 'never', prior_lightening: 'never' })
  expect(after.questionPack.questions.filter(question => question.requirement === 'REQUIRED' && !after.latestRevision?.answers[question.key]).map(question => question.key)).toEqual(['prior_reaction'])
  const replay = await answerConsultChartReview({ consultSessionId: id, actorUserId: fx.clientUserId, fingerprint, decision: 'CONFIRMED', idempotencyKey: 'confirmed' })
  expect(replay.replayed).toBe(true)
  expect(await db.consultChartReview.count({ where: { consultSessionId: id } })).toBe(1)
})
it('box dye at home retains only explicitly confirmed facts and asks its timing gap', async () => {
  const id = await startCurrent(); const before = await state(id)
  await answerConsultChartReview({ consultSessionId: id, actorUserId: fx.clientUserId, fingerprint: before.chartReview!.fingerprint,
    decision: 'BOX_DYE_ONLY', idempotencyKey: 'box-gap' })
  const after = await state(id)
  expect(after.latestRevision?.answers.box_dye_history).toBeUndefined()
  expect(after.latestRevision?.answers.henna_plant_dye_history).toBe('never')
  expect(after.questionPack.questions.filter(question => question.requirement === 'REQUIRED' && !after.latestRevision?.answers[question.key]).map(question => question.key)).toEqual(['box_dye_history', 'prior_reaction'])
  await expect(db.consultChartReview.updateMany({ where: { consultSessionId: id }, data: { decision: 'CONFIRMED' } })).rejects.toThrow('immutable')
})
it('an unrelated professional cannot load chart facts', async () => {
  expect(await loadClientChartFacts({ clientId: fx.clientId, professionalId: 'unknown-pro', excludeConsultSessionId: 'new' })).toMatchObject({ available: false, facts: [] })
})
it('one-question confirmations retain their source and a newer client answer overrides it', async () => {
  const id = await startCurrent(); const intake = await state(id)
  const fact = intake.prefillSuggestions.find(item => item.questionKey === 'box_dye_history')!
  const sourceId = fact.provenance.find(item => item.source === 'CHART_FACT')!.sourceId!
  const args = { consultSessionId: id, actorUserId: fx.clientUserId, sourceId, questionKey: 'box_dye_history', value: 'never', idempotencyKey: 'one-fact' }
  await answerConsultChartFact(args)
  expect((await loadConsultChartSources(db, id, 99999)).some(source => source.questionKey === 'box_dye_history')).toBe(true)
  expect((await answerConsultChartFact(args)).replayed).toBe(true)
  await expect(answerConsultChartFact({ ...args, value: 'within-6-months' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  await answerConsultChartFact({ ...args, value: 'within-6-months', idempotencyKey: 'correction' })
  expect((await loadConsultChartSources(db, id, 99999)).some(source => source.questionKey === 'box_dye_history')).toBe(false)
})
it('mentor is opt-in, hair-only, and projected from the stored Brief', async () => {
  process.env.AI_CONSULT_MENTOR_ENABLED = 'true'
  const before = await loadAuthorizedProConsultBriefs({ professionalId: fx.professionalId, clientId: fx.clientId })
  expect(before.every(brief => !brief.mentor)).toBe(true)
  await db.professionalProfile.update({ where: { id: fx.professionalId }, data: { consultMentorEnabled: true, consultProductLines: ['Test Brand Line'] } })
  const after = await loadAuthorizedProConsultBriefs({ professionalId: fx.professionalId, clientId: fx.clientId })
  expect(after.length).toBeGreaterThan(0)
  expect(after[0]?.mentor?.sections).toHaveLength(5)
})

it('reused chart photo traverses the quality gate and is pinned to the completed Brief', async () => {
  process.env.AI_CONSULT_LOOK_PLANS_ENABLED = 'true'
  const id = await runConsultToCompletion(db, await createLook(db, fx.balayageServiceId), 'chart-photo-analysis', clean, { chartPhotoMediaAssetId: sourcePhotoId })
  const use = await db.consultChartPhotoUse.findFirstOrThrow({ where: { consultSessionId: id }, include: { capture: true, analyses: true } })
  expect(use.capture.status).toBe('ACCEPTED')
  expect(use.analyses).toHaveLength(1)
  const briefs = await loadAuthorizedProConsultBriefs({ professionalId: fx.professionalId, clientId: fx.clientId })
  const brief = briefs.find(brief => brief.consultId === id)
  expect(brief?.lookBrief?.chartSources?.some(source => source.questionKey === `chart_photo:${use.captureId}`)).toBe(true)
  expect(brief?.mentor?.sections).toHaveLength(5)
  if (process.env.CONSULT_CYCLE_C_MENTOR_FIXTURE) writeFileSync(process.env.CONSULT_CYCLE_C_MENTOR_FIXTURE, JSON.stringify(brief?.mentor, null, 2))
})
