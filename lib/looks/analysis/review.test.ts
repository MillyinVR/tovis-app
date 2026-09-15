import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(), lookMediaAnalysis: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  lookMediaAnalysisReview: { create: vi.fn() }, notify: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { ...mocks, $transaction: async (callback: (tx: typeof mocks) => Promise<void>) => callback(mocks) } }))
vi.mock('./notify', () => ({ notifyLookAnalysis: mocks.notify }))
import { analysisRow, asset, lookReadingFixture } from './testFixtures'
import { listLookAnalyses, mutateLookAnalysis, parseLookReview, readReviewFrame } from './review'
const pro = { actorUserId: 'pro-user', professionalId: asset.professionalId, admin: false }
const admin = { actorUserId: 'admin-user', professionalId: null, admin: true }
beforeEach(() => { mocks.lookMediaAnalysis.findFirst.mockResolvedValue({ ...analysisRow(), mediaAsset: asset }); mocks.lookMediaAnalysis.update.mockResolvedValue({}); mocks.lookMediaAnalysisReview.create.mockResolvedValue({}) })

describe('review authority and stale writes', () => {
  it('retains previous admin corrections when approving a later review', async () => {
    mocks.lookMediaAnalysis.findFirst.mockResolvedValue({ ...analysisRow({ status: 'READY', reviewedAnalysis: lookReadingFixture('WARM') }), mediaAsset: asset })
    await mutateLookAnalysis(admin, 'analysis-1', { revision: 2, action: 'approve', corrections: {} })
    expect(mocks.lookMediaAnalysis.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewedAnalysis: expect.objectContaining({ attributes: expect.objectContaining({ tone: expect.objectContaining({ value: 'WARM' }) }) }) }) }))
  })

  it.each(['approve', 'reject', 'retry'] as const)('prevents a pro from %s before any write', async action => {
    await expect(mutateLookAnalysis(pro, 'analysis-1', { action, revision: 2 })).rejects.toMatchObject({ status: 403 })
    expect(mocks.$queryRaw).not.toHaveBeenCalled()
    expect(mocks.lookMediaAnalysis.update).not.toHaveBeenCalled()
  })
  it('prevents a pro from submitting admin corrections through answer', async () => {
    await expect(mutateLookAnalysis(pro, 'analysis-1', { action: 'answer', revision: 2, corrections: {} })).rejects.toMatchObject({ status: 403 })
  })
  it('scopes frame reads to the pro and conceals a missing or foreign row', async () => {
    mocks.lookMediaAnalysis.findFirst.mockResolvedValue(null)
    await expect(readReviewFrame(pro, 'foreign-analysis', 0)).rejects.toMatchObject({ status: 404 })
    expect(mocks.lookMediaAnalysis.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'foreign-analysis', mediaAsset: expect.objectContaining({ professionalId: 'pro-1' }) }) }))
  })
  it('refuses a pro scope with no professional identity', async () => {
    await expect(listLookAnalyses({ ...pro, professionalId: null })).rejects.toMatchObject({ status: 404 })
    expect(mocks.lookMediaAnalysis.findMany).not.toHaveBeenCalled()
  })
  it.each([{ revision: 1 }, { status: 'PROCESSING' as const }])('rejects stale revision or a live decoder lease', async overrides => {
    mocks.lookMediaAnalysis.findFirst.mockResolvedValue({ ...analysisRow(overrides), mediaAsset: asset })
    await expect(mutateLookAnalysis(admin, 'analysis-1', { action: 'approve', revision: 2 })).rejects.toMatchObject({ status: 409 })
    expect(mocks.lookMediaAnalysis.update).not.toHaveBeenCalled()
    expect(mocks.lookMediaAnalysisReview.create).not.toHaveBeenCalled()
  })
  it('rejects a reading whose source crop changed', async () => {
    mocks.lookMediaAnalysis.findFirst.mockResolvedValue({ ...analysisRow(), mediaAsset: { ...asset, cropX: 0.1 } })
    await expect(mutateLookAnalysis(admin, 'analysis-1', { action: 'reject', revision: 2 })).rejects.toMatchObject({ status: 404 })
    expect(mocks.lookMediaAnalysis.update).not.toHaveBeenCalled()
  })
})

describe('clarification and review provenance', () => {
  it('requires explicit clarification and treats not sure as an answer', async () => {
    await expect(mutateLookAnalysis(pro, 'analysis-1', { action: 'answer', revision: 2, answers: {} })).rejects.toMatchObject({ status: 400 })
    await mutateLookAnalysis(pro, 'analysis-1', { action: 'answer', revision: 2, answers: { mediaRole: 'UNKNOWN' } })
    expect(mocks.lookMediaAnalysis.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'NEEDS_ADMIN', proAnswers: { mediaRole: 'UNKNOWN' }, reviewedByUserId: null, revision: 3 }) }))
    expect(mocks.notify).toHaveBeenCalledWith(mocks, expect.objectContaining({ admin: true, revision: 3 }))
  })
  it('stores admin correction separately, preserves model observations, and appends actor history', async () => {
    const original = analysisRow()
    mocks.lookMediaAnalysis.findFirst.mockResolvedValue({ ...original, mediaAsset: asset })
    const correction = lookReadingFixture('WARM').attributes.tone
    await mutateLookAnalysis(admin, 'analysis-1', { action: 'approve', revision: 2, corrections: { tone: correction } })
    const data = mocks.lookMediaAnalysis.update.mock.calls[0]?.[0].data
    expect(data).toMatchObject({ status: 'READY', reviewedByUserId: 'admin-user', revision: 3, reviewedAnalysis: { attributes: { tone: { value: 'WARM' } } } })
    expect(data).not.toHaveProperty('readings')
    expect(original.readings).toEqual([lookReadingFixture(), lookReadingFixture('WARM')])
    expect(mocks.lookMediaAnalysisReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'admin-user', actorRole: 'ADMIN', action: 'approve', revision: 3, payload: expect.objectContaining({ corrections: { tone: correction } }) }) })
  })
  it('requires a frame change to be saved before approval', async () => {
    await expect(mutateLookAnalysis(admin, 'analysis-1', { action: 'approve', revision: 2, selectedFrame: 1 })).rejects.toMatchObject({ status: 409 })
    expect(mocks.lookMediaAnalysis.update).not.toHaveBeenCalled()
  })
  it('returns a controlled conflict when selecting an unreadable video frame', async () => {
    mocks.lookMediaAnalysis.findFirst.mockResolvedValue({ ...analysisRow({ readings: [lookReadingFixture(), null] }), mediaAsset: asset })
    await expect(mutateLookAnalysis(pro, 'analysis-1', { action: 'answer', revision: 2, selectedFrame: 1, answers: { mediaRole: 'FINISHED' } })).rejects.toMatchObject({ status: 409 })
    expect(mocks.lookMediaAnalysis.update).not.toHaveBeenCalled()
  })
  it.each([
    { revision: 0, action: 'approve', actorUserId: 'forged' },
    { revision: 0, action: 'approve', selectedFrame: 3 },
    { revision: 0, action: 'approve', corrections: { tone: { value: 'WARM', confidence: { min: 0.9, max: 0.2 }, region: null } } },
    { revision: 0, action: 'approve', corrections: { tone: { value: 'UNKNOWN', confidence: { min: 0, max: 0.9 }, region: null } } },
  ])('rejects malformed or authority-injecting payloads', raw => {
    expect(() => parseLookReview(raw)).toThrow()
  })
})
