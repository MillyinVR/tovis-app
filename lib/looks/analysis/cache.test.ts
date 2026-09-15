import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  lookMediaAnalysis: { findUnique: vi.fn(), upsert: vi.fn() },
  mediaAsset: { findFirst: vi.fn(), findMany: vi.fn() }, lookPost: { findFirst: vi.fn() },
  provider: vi.fn(), hairProvider: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks }))
vi.mock('@/lib/consult/hairMapRuntime', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/consult/hairMapRuntime')>(), runConsultHairMap: mocks.hairProvider }))
vi.mock('@/lib/consult/inspirationVision', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/consult/inspirationVision')>(), runConsultInspirationVision: mocks.provider }))
import { optionalConsultHairComparison } from '@/lib/consult/hairMapRuntime'
import { prisma } from '@/lib/prisma'
import { hairMapFixture } from '@/test/fixtures/consultHairMap'
import { loadReusableLookAnalysis } from './cache'
import { enqueueLookMediaAnalyses } from './queue'
import { LOOK_ANALYSIS_VERSION, lookAnalysisSourceHash } from './identity'
import { analysisRow, asset, frames, lookReadingFixture } from './testFixtures'

beforeEach(() => {
  vi.stubEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED', 'true')
  mocks.mediaAsset.findFirst.mockResolvedValue(asset)
  mocks.lookMediaAnalysis.findUnique.mockResolvedValue(analysisRow({ status: 'READY' }))
})

describe('reusable analysis', () => {
  it('refuses stale source pointers when the crop changed after resolution', async () => {
    mocks.mediaAsset.findFirst.mockResolvedValue({ ...asset, cropX: 0.1, cropY: 0.1, cropW: 0.8, cropH: 0.8 })
    expect(await loadReusableLookAnalysis(prisma, asset)).toBeNull()
    expect(mocks.lookMediaAnalysis.findUnique).not.toHaveBeenCalled()
  })
  it('retains the saved detailed map when admin approves without changing observations', async () => {
    const map = { model: 'map-model', map: hairMapFixture('inspiration') }
    mocks.lookMediaAnalysis.findUnique.mockResolvedValue(analysisRow({ status: 'READY', reviewedAnalysis: lookReadingFixture(), reviewedByUserId: 'admin-1', hairMaps: [map, map] }))
    expect((await loadReusableLookAnalysis(prisma, asset))?.referenceMap?.model).toBe('map-model')
  })

  it('loads the selected frame and admin correction in preference to the original without any provider call', async () => {
    mocks.lookMediaAnalysis.findUnique.mockResolvedValue(analysisRow({ status: 'READY', selectedFrame: 1, reviewedAnalysis: lookReadingFixture('NEUTRAL'), reviewedByUserId: 'admin-1' }))
    const result = await loadReusableLookAnalysis(prisma, asset)
    expect(result).toMatchObject({ frame: frames[1], reading: { attributes: { tone: { value: 'NEUTRAL' } } }, reviewed: true })
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(mocks.hairProvider).not.toHaveBeenCalled()
    expect(mocks.lookMediaAnalysis.findUnique).toHaveBeenCalledWith({ where: { mediaAssetId_sourceHash_promptVersion: { mediaAssetId: asset.id, sourceHash: lookAnalysisSourceHash(asset), promptVersion: LOOK_ANALYSIS_VERSION } } })
  })
  it.each(['PENDING', 'PROCESSING', 'NEEDS_PRO', 'NEEDS_ADMIN', 'REJECTED', 'FAILED'] as const)('does not reuse %s or invoke a provider to bypass review', async status => {
    mocks.lookMediaAnalysis.findUnique.mockResolvedValue(analysisRow({ status }))
    expect(await loadReusableLookAnalysis(prisma, asset)).toBeNull()
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(mocks.hairProvider).not.toHaveBeenCalled()
  })
  it('does not reuse media that is no longer eligible for the public pro feed', async () => {
    mocks.mediaAsset.findFirst.mockResolvedValue(null)
    expect(await loadReusableLookAnalysis(prisma, asset)).toBeNull()
    expect(mocks.lookMediaAnalysis.findUnique).not.toHaveBeenCalled()
  })
  it('honors the kill switch without querying media', async () => {
    vi.stubEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED', 'false')
    expect(await loadReusableLookAnalysis(prisma, asset)).toBeNull()
    expect(mocks.mediaAsset.findFirst).not.toHaveBeenCalled()
  })
  it('suppresses the original map after admin corrections instead of allowing contradictory AI facts', async () => {
    const map = { model: 'map-model', map: hairMapFixture('inspiration') }
    mocks.lookMediaAnalysis.findUnique.mockResolvedValue(analysisRow({ status: 'READY', reviewedAnalysis: lookReadingFixture('WARM'), reviewedByUserId: 'admin-1', hairMaps: [map, map] }))
    const result = await loadReusableLookAnalysis(prisma, asset)
    expect(result?.reading.attributes.tone?.value).toBe('WARM')
    expect(result?.referenceMap).toBeUndefined()
    expect(mocks.hairProvider).not.toHaveBeenCalled()
  })
})

describe('queue identity and deduplication', () => {
  it('deduplicates primary/gallery media and never resets existing work on repeated publication', async () => {
    mocks.lookPost.findFirst.mockResolvedValue({ primaryMediaAssetId: asset.id, assets: [{ mediaAssetId: asset.id }, { mediaAssetId: asset.id }] })
    mocks.mediaAsset.findMany.mockResolvedValue([asset])
    await enqueueLookMediaAnalyses(prisma, 'look-1')
    await enqueueLookMediaAnalyses(prisma, 'look-1')
    expect(mocks.mediaAsset.findMany.mock.calls[0]?.[0].where.id.in).toEqual([asset.id])
    expect(mocks.lookMediaAnalysis.upsert).toHaveBeenCalledTimes(2)
    for (const [request] of mocks.lookMediaAnalysis.upsert.mock.calls) {
      expect(request.update).toEqual({})
      expect(request.where.mediaAssetId_sourceHash_promptVersion).toEqual({ mediaAssetId: asset.id, sourceHash: lookAnalysisSourceHash(asset), promptVersion: LOOK_ANALYSIS_VERSION })
    }
  })
  it('cannot enqueue a look excluded by publication, author, visibility or moderation scope', async () => {
    mocks.lookPost.findFirst.mockResolvedValue(null)
    await enqueueLookMediaAnalyses(prisma, 'hidden-look')
    expect(mocks.lookPost.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'hidden-look', status: 'PUBLISHED', visibility: 'PUBLIC', moderationStatus: 'APPROVED', clientAuthorId: null, service: { category: { consultFamily: 'HAIR' } } } }))
    expect(mocks.lookMediaAnalysis.upsert).not.toHaveBeenCalled()
  })
})


describe('consultation does not repeat prepared reference analysis', () => {
  it('does not reload or analyze a blocked or corrected reference even with the comparison feature enabled', async () => {
    vi.stubEnv('AI_CONSULT_HAIR_MAP_ENABLED', 'true')
    const loadReference = vi.fn()
    const result = await optionalConsultHairComparison({
      family: 'HAIR', lookPlanning: true, startedAt: Date.now(),
      current: [{ view: 'hair_back', image: frames[0] }], colorUncertainViews: [],
      referenceReadDisabled: true, loadReference, provider: mocks.hairProvider,
    })
    expect(result).toBeUndefined()
    expect(loadReference).not.toHaveBeenCalled()
    expect(mocks.hairProvider).not.toHaveBeenCalled()
  })
  it('analyzes only the client when a saved reference map is available', async () => {
    vi.stubEnv('AI_CONSULT_HAIR_MAP_ENABLED', 'true')
    const loadReference = vi.fn()
    mocks.hairProvider.mockResolvedValue({ model: 'saved-map-model', raw: hairMapFixture('hair_back') })
    const result = await optionalConsultHairComparison({
      family: 'HAIR', lookPlanning: true, startedAt: Date.now(),
      current: [{ view: 'hair_back', image: frames[0] }], colorUncertainViews: [],
      referenceReadDisabled: true, referenceMap: { model: 'saved-map-model', map: hairMapFixture('inspiration') },
      loadReference, provider: mocks.hairProvider,
    })
    expect(result).toBeDefined()
    expect(mocks.hairProvider).toHaveBeenCalledTimes(1)
    expect(mocks.hairProvider).toHaveBeenCalledWith(expect.objectContaining({ scope: expect.objectContaining({ role: 'CURRENT' }) }))
    expect(loadReference).not.toHaveBeenCalled()
  })
})
