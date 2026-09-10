import { PrismaClient, ConsultActorType, ConsultAgreementKind, ConsultInspirationSource, ConsultInspirationStatus } from '@prisma/client'
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

import { loadProConsultTranscript } from '@/lib/consult/proTranscript'
import { revokeConsultAgreement } from '@/lib/consult/writeBoundary'
import { resetConsultLookFakes } from './_support/consultLookFakes'
import { createLook, fx, runConsultToCompletion, seedLookConsultFixture, teardownLookConsultFixture } from './_support/lookConsultFixture'

const db = new PrismaClient()
beforeAll(async () => { vi.stubEnv('AI_CONSULT_LOOK_PLANS_ENABLED', 'true'); await seedLookConsultFixture(db, { tagPrefix: 'bt1_history' }) })
beforeEach(() => {
  vi.clearAllMocks()
  resetConsultLookFakes()
  mockRequireClient.mockResolvedValue({ ok: true, clientId: fx.clientId, user: { id: fx.clientUserId } })
})
afterAll(async () => { await teardownLookConsultFixture(db); await db.$disconnect(); vi.unstubAllEnvs() })

it('reads a completed consult, pages tied timestamps without duplicates, and enforces current access', async () => {
  const look = await createLook(db, fx.balayageServiceId)
  const consultSessionId = await runConsultToCompletion(db, look, 'history')
  const args = { consultSessionId, professionalId: fx.professionalId, actorUserId: fx.proUserId }
  const first = await loadProConsultTranscript(args)
  expect(first.events.some(event => event.title.includes('Client answers'))).toBe(true)
  expect(first.events.some(event => event.items.some(item => item.value.length > 0))).toBe(true)
  expect(first.events.some(event => event.title === 'Saved reference reading' && event.items.length > 0)).toBe(true)
  expect(first.events.some(event => event.title.startsWith('Look plan version') && event.items.some(item => item.label === 'Summary'))).toBe(true)
  await expect(loadProConsultTranscript({ ...args, actorUserId: fx.clientUserId })).rejects.toThrow()
  await expect(loadProConsultTranscript({ ...args, professionalId: 'another-pro' })).rejects.toThrow()

  // Reference records exercise the real UNION and a timestamp tie across pages.
  const source = await db.consultInspiration.findFirstOrThrow({ where: { consultSessionId } })
  await db.consultInspiration.createMany({ data: Array.from({ length: 45 }, (_, index) => ({
    ...source, sourceIdempotencyKey: `history-page-${index}`,
    source: ConsultInspirationSource.EXTERNAL_UPLOAD, status: ConsultInspirationStatus.REPLACED,
    sourceLookPostId: null, contentType: 'image/jpeg', sizeBytes: 100,
    purgedAt: new Date('2026-01-03T00:00:00Z'), uploadExpiresAt: new Date('2026-01-01T01:00:00Z'),
    useExpiresAt: new Date('2026-01-02T00:00:00Z'),
    id: `history_page_${index}_${consultSessionId}`, createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })) })
  const seen = new Set<string>()
  let cursor: string | null = null
  let pageCount = 0
  do {
    const page = await loadProConsultTranscript({ ...args, cursor })
    for (const event of page.events) { expect(seen.has(event.id)).toBe(false); seen.add(event.id) }
    cursor = page.nextCursor
    pageCount += 1
    expect(pageCount).toBeLessThan(10)
  } while (cursor)
  expect(pageCount).toBeGreaterThan(1)
  expect([...seen].filter(id => id.includes('history_page_'))).toHaveLength(45)
  const consent = await db.consultAgreementAcceptance.findFirstOrThrow({ where: {
    consultSessionId, kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT, revokedAt: null,
  } })
  await revokeConsultAgreement({ consultSessionId, acceptanceId: consent.id, reason: 'Integration test withdrawal',
    actor: { type: ConsultActorType.CLIENT, id: fx.clientUserId } })
  await expect(loadProConsultTranscript(args)).rejects.toThrow()
}, 60000)
