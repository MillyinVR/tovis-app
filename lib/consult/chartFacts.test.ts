import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ gate: vi.fn(), query: vi.fn(), accessBooking: vi.fn(), share: vi.fn(), visits: vi.fn(), photos: vi.fn(), allergies: vi.fn(), captures: vi.fn() }))
vi.mock('@/lib/clientVisibility', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/clientVisibility')>()), assertProCanViewClient: mocks.gate }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction: async (work: (tx: { consultCapture: { findMany: typeof mocks.captures }; clientAllergy: { findMany: typeof mocks.allergies }; $queryRaw: typeof mocks.query; clientChartShare: { findUnique: typeof mocks.share }; booking: { findFirst: typeof mocks.accessBooking; findMany: typeof mocks.visits }; mediaAsset: { findMany: typeof mocks.photos } }) => Promise<unknown>) =>
    work({ consultCapture: { findMany: mocks.captures }, clientAllergy: { findMany: mocks.allergies }, $queryRaw: mocks.query, clientChartShare: { findUnique: mocks.share }, booking: { findFirst: mocks.accessBooking, findMany: mocks.visits }, mediaAsset: { findMany: mocks.photos } }),
} }))
import { chartAnswerValidity, loadClientChartFacts, projectClientChartVisitFacts } from './chartFacts'
const now = new Date('2026-09-08T12:00:00Z')
const args = { clientId: 'client', professionalId: 'pro', excludeConsultSessionId: 'current', now }
const visit = {
  id: 'visit', professionalId: 'pro', scheduledFor: new Date('2026-08-01T12:00:00Z'), finishedAt: new Date('2026-08-03T14:00:00Z'),
  serviceItems: [], service: { name: 'Haircut' }, aftercareSummary: null, sourceConsultSession: null,
  consultSession: { id: 'old-consult', status: 'COMPLETED' as const, revisions: [], lookBriefVersions: [], followUpRounds: [
    { id: 'old', createdAt: new Date('2026-07-01'), answeredAt: new Date('2026-07-02'), answers: { box_dye_history: ['never'] } },
    { id: 'new', createdAt: new Date('2026-08-01'), answeredAt: new Date('2026-08-02'), answers: { box_dye_history: ['not-sure'] } },
  ] },
}
beforeEach(() => { mocks.captures.mockResolvedValue([]); mocks.allergies.mockResolvedValue([]); mocks.accessBooking.mockResolvedValue({ id: 'access' }); mocks.gate.mockResolvedValue({ ok: true }); mocks.share.mockResolvedValue(null); mocks.visits.mockResolvedValue([]); mocks.photos.mockResolvedValue([]) })
describe('chart fact freshness and provenance', () => {
  it('never confirms expired history or carries a relative time bucket forward', () => {
    expect(chartAnswerValidity('box_dye_history', 'never', new Date('2024-01-01'), now).state).toBe('REASK')
    expect(chartAnswerValidity('prior_lightening', 'within-3-months', new Date('2026-08-01'), now).state).toBe('REASK')
  })
  it('keeps a reported reaction indefinitely, with explicit confirmation still required', () => {
    expect(chartAnswerValidity('prior_reaction', 'yes', new Date('2020-01-01'), now)).toEqual({ validUntil: null, state: 'CONFIRM' })
    expect(chartAnswerValidity('prior_reaction', 'no', new Date('2026-08-01'), now).state).toBe('REASK')
  })
  it('does not resurrect an older clean history after a newer unsure answer', () => {
    const fact = projectClientChartVisitFacts([visit], now).find(item => item.key === 'box_dye_history')
    expect(fact).toMatchObject({ sourceId: 'new', value: 'not-sure', recordedAt: '2026-08-02T00:00:00.000Z', state: 'REASK' })
  })
  it('does not present a recommended product as a product the client uses', () => {
    const result = projectClientChartVisitFacts([{ ...visit, aftercareSummary: { id: 'care', sentToClientAt: now,
      recommendedProducts: [{ id: 'product', externalName: 'Gentle shampoo', product: null }] } }], now)
    expect(result.find(item => item.key === 'recommended_product')).toMatchObject({ source: 'PUBLISHED_PRODUCT', state: 'REASK' })
  })
  it('excludes draft aftercare', () => {
    expect(projectClientChartVisitFacts([{ ...visit, aftercareSummary: { id: 'care', sentToClientAt: null,
      recommendedProducts: [{ id: 'product', externalName: 'Private draft', product: null }] } }], now)
      .some(item => item.source === 'PUBLISHED_PRODUCT')).toBe(false)
  })
  it('reads no history at all when the chart access gate denies the pro', async () => {
    mocks.gate.mockResolvedValue({ ok: false })
    expect(await loadClientChartFacts(args)).toMatchObject({ available: false, facts: [], photos: [] })
    expect(mocks.share).not.toHaveBeenCalled(); expect(mocks.visits).not.toHaveBeenCalled()
  })
  it('requires explicit granted sharing before including another professional’s visits', async () => {
    await loadClientChartFacts(args)
    expect(mocks.visits).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ professionalId: 'pro', clientId: 'client', status: 'COMPLETED' }) }))
    mocks.share.mockResolvedValue({ status: 'GRANTED' })
    await loadClientChartFacts(args)
    expect(mocks.visits.mock.lastCall?.[0].where).not.toHaveProperty('professionalId')
  })
  it('continues restricting photos to the canonical media visibility boundary after sharing', async () => {
    mocks.share.mockResolvedValue({ status: 'GRANTED' }); mocks.visits.mockResolvedValue([visit])
    await loadClientChartFacts(args)
    expect(mocks.photos.mock.lastCall?.[0].where.AND[0]).toMatchObject({ mediaType: 'IMAGE', booking: { clientId: 'client' },
      OR: [{ professionalId: 'pro' }, { visibility: 'PUBLIC', reviewId: { not: null } }] })
  })
  it('does not make an old capture fresh when it is copied into a recent chart', async () => {
    mocks.visits.mockResolvedValue([visit])
    mocks.photos.mockResolvedValue([{ id: 'photo', bookingId: visit.id, createdAt: now, phase: 'BEFORE', storagePath: 'consult-chart/v1/session/early_photo-capture.jpg' }])
    mocks.captures.mockResolvedValue([{ id: 'capture', createdAt: new Date('2025-01-01') }])
    expect((await loadClientChartFacts(args)).photos).toEqual([])
  })

})
