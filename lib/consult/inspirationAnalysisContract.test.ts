import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), cache: vi.fn(), findRevision: vi.fn() }))
vi.mock('./inspirationContract', () => ({ resolveLockedConsultInspirationReadTarget: mocks.resolve }))
vi.mock('@/lib/looks/analysis/cache', () => ({ loadReusableLookAnalysis: mocks.cache }))
vi.mock('@/lib/prisma', () => ({ prisma: { consultRevision: { findFirst: mocks.findRevision } } }))
import { prisma } from '@/lib/prisma'
import { asset, frames, lookReadingFixture } from '@/lib/looks/analysis/testFixtures'
import { prepareConsultInspirationRead } from './inspirationAnalysisContract'
const scope = { session: { id: 'consult-1', clientId: 'client-1', professionalId: 'pro-1' }, now: new Date('2026-09-15T00:00:00Z') }
beforeEach(() => {
  vi.stubEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED', 'true')
  mocks.resolve.mockResolvedValue({ kind: 'LOOK', inspirationId: 'reference-1', source: 'PLATFORM_LOOK', pointers: { storageBucket: asset.storageBucket, storagePath: asset.storagePath, url: null, analysisAsset: asset } })
  mocks.cache.mockResolvedValue(null)
  mocks.findRevision.mockResolvedValue(null)
})
it('blocks a pending shared look before an older per-consult artefact can bypass review', async () => {
  await expect(prepareConsultInspirationRead(prisma, scope)).rejects.toMatchObject({ code: 'INSPIRATION_ANALYSIS_UNAVAILABLE' })
  expect(mocks.findRevision).not.toHaveBeenCalled()
})
it('prepares a ready shared reference using its reviewed revision', async () => {
  const reusable = { id: 'saved-1', revision: 3, reading: lookReadingFixture(), frame: frames[0], reviewed: true }
  mocks.cache.mockResolvedValue(reusable)
  const plan = await prepareConsultInspirationRead(prisma, scope)
  expect(plan.reusable).toEqual(reusable)
  expect(mocks.findRevision).toHaveBeenCalledOnce()
})
it('preserves the existing per-consult behavior with the feature disabled', async () => {
  vi.stubEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED', 'false')
  expect((await prepareConsultInspirationRead(prisma, scope)).artefact).toBeNull()
  expect(mocks.findRevision).toHaveBeenCalledOnce()
})
