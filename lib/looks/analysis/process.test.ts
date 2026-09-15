import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(), lookMediaAnalysis: { update: vi.fn(), updateMany: vi.fn() },
  mediaAsset: { findFirst: vi.fn(), findUnique: vi.fn() }, lookMediaAnalysisCall: { create: vi.fn() },
  notify: vi.fn(), kick: vi.fn(), flush: vi.fn(), loadFrames: vi.fn(), provider: vi.fn(), hairProvider: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { ...mocks, $transaction: async (callback: (tx: typeof mocks) => Promise<unknown>) => callback(mocks) } }))
vi.mock('./notify', () => ({ notifyLookAnalysis: mocks.notify }))
vi.mock('./images', () => ({ loadLookAnalysisFrames: mocks.loadFrames }))
vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({ kickNotificationDrain: mocks.kick }))
vi.mock('@/lib/consult/providerMeter', () => ({ flushConsultProviderMeter: mocks.flush }))
vi.mock('@/lib/consult/hairMapRuntime', () => ({ runConsultHairMap: mocks.hairProvider }))
vi.mock('@/lib/consult/inspirationVision', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/consult/inspirationVision')>(), runConsultInspirationVision: mocks.provider }))
import { ConsultInspirationVisionError } from '@/lib/consult/inspirationVision'
import { hairMapFixture } from '@/test/fixtures/consultHairMap'
import { processNextLookAnalysis } from './process'
import { analysis, analysisRow, asset, frames } from './testFixtures'

beforeEach(() => {
  vi.stubEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED', 'true')
  mocks.$queryRaw.mockResolvedValue([{ id: 'analysis-1' }])
  mocks.lookMediaAnalysis.update.mockResolvedValue(analysisRow({ status: 'PROCESSING' }))
  mocks.lookMediaAnalysis.updateMany.mockResolvedValue({ count: 1 })
  mocks.mediaAsset.findFirst.mockResolvedValue(asset)
  mocks.mediaAsset.findUnique.mockResolvedValue({ professionalId: asset.professionalId })
  mocks.provider.mockResolvedValue({ analysis: analysis(), credibilityFlags: [], model: 'model-fixture' })
  mocks.hairProvider.mockResolvedValue({ raw: hairMapFixture('inspiration'), model: 'map-fixture' })
  mocks.loadFrames.mockResolvedValue(frames)
})

describe('claim and source boundaries', () => {
  it('performs no work with the kill switch off', async () => {
    vi.stubEnv('AI_LOOK_UPLOAD_ANALYSIS_ENABLED', 'false')
    expect(await processNextLookAnalysis()).toEqual({ status: 'DISABLED' })
    expect(mocks.$queryRaw).not.toHaveBeenCalled()
    expect(mocks.provider).not.toHaveBeenCalled()
  })
  it('does not call a provider when no job was claimed', async () => {
    mocks.$queryRaw.mockResolvedValue([])
    expect(await processNextLookAnalysis()).toEqual({ status: 'IDLE' })
    expect(mocks.provider).not.toHaveBeenCalled()
  })
  it.each([{ promptVersion: 'outdated' }, { sourceHash: 'old-pixels' }])('rejects stale source identity before decoding or paid calls', async overrides => {
    mocks.lookMediaAnalysis.update.mockResolvedValue(analysisRow(overrides))
    expect(await processNextLookAnalysis()).toEqual({ status: 'SOURCE_CHANGED' })
    expect(mocks.loadFrames).not.toHaveBeenCalled()
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(mocks.hairProvider).not.toHaveBeenCalled()
  })
  it('does not publish a result or notify after losing the claim', async () => {
    mocks.lookMediaAnalysis.updateMany.mockResolvedValue({ count: 0 })
    expect(await processNextLookAnalysis()).toEqual({ status: 'LEASE_LOST' })
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(mocks.hairProvider).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
    for (const [request] of mocks.lookMediaAnalysis.updateMany.mock.calls) {
      expect(request.where).toMatchObject({ id: 'analysis-1', status: 'PROCESSING', claimedAt: expect.any(Date) })
    }
  })
  it('reports a lease lost during provider calls without issuing a notification', async () => {
    mocks.lookMediaAnalysis.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 })
    expect(await processNextLookAnalysis()).toEqual({ status: 'LEASE_LOST' })
    expect(mocks.provider).toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('rechecks public source eligibility before publishing a completed reading', async () => {
    mocks.mediaAsset.findFirst.mockResolvedValueOnce(asset).mockResolvedValueOnce(null)
    expect(await processNextLookAnalysis()).toEqual({ status: 'SOURCE_CHANGED' })
    expect(mocks.lookMediaAnalysis.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', failure: 'SOURCE_CHANGED' }) }))
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})

describe('video analysis and bounded retries', () => {
  it('reuses saved frames and selects the first readable frame without shifting its index', async () => {
    mocks.provider.mockRejectedValueOnce(new ConsultInspirationVisionError('unreadable'))
    expect(await processNextLookAnalysis()).toEqual({ status: 'NEEDS_PRO' })
    expect(mocks.loadFrames).not.toHaveBeenCalled()
    const completion = mocks.lookMediaAnalysis.updateMany.mock.calls.find(([request]) => request.data.status === 'NEEDS_PRO')?.[0].data
    expect(completion).toMatchObject({ selectedFrame: 1, readings: [null, expect.objectContaining({ model: 'model-fixture' })] })
    expect(mocks.notify).toHaveBeenCalledWith(mocks, expect.objectContaining({ admin: false }))
  })
  it('fails fully unreadable video without retrying and requests admin review', async () => {
    mocks.provider.mockRejectedValue(new ConsultInspirationVisionError('unreadable'))
    expect(await processNextLookAnalysis()).toEqual({ status: 'FAILED' })
    expect(mocks.notify).toHaveBeenCalledWith(mocks, expect.objectContaining({ admin: true }))
  })
  it.each([{ attemptCount: 1, status: 'RETRY_SCHEDULED' }, { attemptCount: 3, status: 'FAILED' }])('bounds unavailable-provider retries at attempt $attemptCount', async ({ attemptCount, status }) => {
    mocks.lookMediaAnalysis.update.mockResolvedValue(analysisRow({ attemptCount }))
    mocks.provider.mockRejectedValue(new ConsultInspirationVisionError('unavailable', 'secret-provider-output'))
    expect(await processNextLookAnalysis()).toEqual({ status })
    const writes = JSON.stringify(mocks.lookMediaAnalysis.updateMany.mock.calls)
    expect(writes).not.toContain('secret-provider-output')
    expect(writes).toContain('VISION_UNAVAILABLE')
  })
})
