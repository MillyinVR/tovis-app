import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hairMapFixture } from '@/test/fixtures/consultHairMap'
import { optionalConsultHairComparison, runConsultHairMap, type ConsultHairMapProvider } from './hairMapRuntime'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./analysisEngine', () => ({ analysisModel: () => 'test-model', requestConsultAnalysisJson: mocks.request }))
const image = { base64: 'test', mediaType: 'image/jpeg' } as const
const provider = vi.fn<ConsultHairMapProvider>()
const loadReference = vi.fn(async () => image)
const input = () => ({ family: 'HAIR', lookPlanning: true, startedAt: Date.now(), current: [{ view: 'hair_back' as const, image }], colorUncertainViews: [], loadReference, provider })
beforeEach(() => {
  vi.stubEnv('AI_CONSULT_HAIR_MAP_ENABLED', 'true')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  provider.mockImplementation(async ({ scope }) => ({ raw: hairMapFixture(scope.views[0]), model: 'test-model' }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('optional map runtime', () => {
  it.each(['false', ''])('does no fetch or paid work when flag is %s', async flag => {
    vi.stubEnv('AI_CONSULT_HAIR_MAP_ENABLED', flag)
    expect(await optionalConsultHairComparison(input())).toBeUndefined()
    expect(loadReference).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
  })
  it('does not run for non-hair, missing reference, or an expired start window', async () => {
    for (const override of [{ family: 'NAILS' }, { lookPlanning: false }, { loadReference: undefined }, { startedAt: Date.now() - 100_000 }]) {
      expect(await optionalConsultHairComparison({ ...input(), ...override })).toBeUndefined()
    }
    expect(provider).not.toHaveBeenCalled()
    expect(loadReference).not.toHaveBeenCalled()
  })
  it('reads the subjects separately and forwards both calls to the existing meter', async () => {
    const meter = { consultSessionId: 'session', analysisRunId: 'run' }
    const result = await optionalConsultHairComparison({ ...input(), meter })
    expect(result?.comparison.differences).toHaveLength(20)
    expect(provider).toHaveBeenCalledTimes(2)
    expect(provider.mock.calls[0]?.[0]).toMatchObject({ scope: { role: 'CURRENT', views: ['hair_back'] }, meter })
    expect(provider.mock.calls[1]?.[0]).toMatchObject({ scope: { role: 'REFERENCE', views: ['inspiration'] }, meter })
  })
  it('contains failures without retries or logging image/provider content', async () => {
    provider.mockRejectedValueOnce(new Error('private image data'))
    expect(await optionalConsultHairComparison(input())).toBeUndefined()
    expect(provider).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private image data')
  })
  it('revalidates injected providers, including cross-subject evidence', async () => {
    provider.mockResolvedValue({ model: 'test-model', raw: { secret: 'not a map' } })
    expect(await optionalConsultHairComparison(input())).toBeUndefined()
  })
  it('rejects mismatched models', async () => {
    provider.mockResolvedValueOnce({ model: 'other', raw: hairMapFixture() })
    expect(await optionalConsultHairComparison(input())).toBeUndefined()
  })
  it('uses the existing transport with a bounded timeout and dedicated meter kind', async () => {
    mocks.request.mockResolvedValue(hairMapFixture())
    await runConsultHairMap({ scope: { role: 'CURRENT', views: ['hair_back'] }, images: [{ view: 'hair_back', image }] })
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ANALYSIS_HAIR_MAP', timeoutMs: 30_000, maxTokens: 6000 }))
    await expect(runConsultHairMap({ scope: { role: 'CURRENT', views: ['hair_back'] }, images: [] })).rejects.toThrow()
  })
})
