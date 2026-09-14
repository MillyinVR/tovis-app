import { afterEach, describe, expect, it, vi } from 'vitest'
import { syntheticSuitabilityInput } from '@/tests/fixtures/consultSuitability'
import { runConsultSuitability, optionalConsultSuitability, CONSULT_SUITABILITY_LATEST_START_MS, CONSULT_SUITABILITY_TIMEOUT_MS } from './suitabilityRuntime'
import { ConsultAnalysisProviderError } from './analysisValidation'
import { buildConsultSuitabilityContext } from './suitabilityTranslation'
import { resetConsultAnalysisClientForTests } from './analysisEngine'
import { flushConsultProviderMeter } from './providerMeter'
const transport = vi.hoisted(() => ({ create: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { consultProviderCall: { create: transport.record } } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: transport.create } } }))

const raw = {
  tailoring: [{ clientExplanation: 'Consider soft color near your face.', professionalDirection: 'Consider soft copper placement.', clientChoiceIds: ['choice.0'], observationIds: ['profile.skinUndertone'] }],
  proConfirmations: [{ clientExplanation: 'Your pro can check your starting color.', professionalCheck: 'Assess current tone in person.', sourceIds: ['choice.0'] }],
}
afterEach(() => vi.unstubAllEnvs())
const args = () => ({ family: 'HAIR', startedAt: Date.now(), input: syntheticSuitabilityInput() })

describe('optional suitability runtime', () => {
  it('uses bounded production transport and removes database IDs from provider input', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only')
    resetConsultAnalysisClientForTests()
    transport.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(raw) }] })
    const context = buildConsultSuitabilityContext(syntheticSuitabilityInput())
    expect((await runConsultSuitability({ context })).raw).toEqual(raw)
    const sent = JSON.stringify(transport.create.mock.calls[0]?.[0])
    expect(sent).not.toContain('synthetic-analysis')
    expect(sent).not.toContain('synthetic-client-choice')
    expect(sent).toContain('choice.0')
    expect(transport.create.mock.calls[0]?.[1]).toEqual({ timeout: CONSULT_SUITABILITY_TIMEOUT_MS })
    expect(CONSULT_SUITABILITY_LATEST_START_MS + CONSULT_SUITABILITY_TIMEOUT_MS).toBeLessThanOrEqual(275_000)
  })
  it.each([false, true])('meters successful and rejected paid responses (invalid: %s)', async invalid => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-only')
    resetConsultAnalysisClientForTests()
    transport.record.mockResolvedValue({ id: 'test-meter' })
    transport.create.mockResolvedValue({ stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 },
      content: [{ type: 'text', text: JSON.stringify(invalid ? {} : raw) }] })
    const request = runConsultSuitability({ context: buildConsultSuitabilityContext(syntheticSuitabilityInput()), meter: { consultSessionId: 'test-session' } })
    if (invalid) await expect(request).rejects.toThrow()
    else await expect(request).resolves.toHaveProperty('raw')
    await flushConsultProviderMeter()
    expect(transport.record).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      kind: 'ANALYSIS_SUITABILITY', outcome: invalid ? 'BAD_OUTPUT' : 'OK', inputTokens: 100, outputTokens: 20,
      // The refusing check reaches the COLUMN, not just the log: a BAD_OUTPUT
      // row has to be explainable after the logs have aged out.
      failureCheck: invalid ? expect.stringMatching(/^[a-z0-9_]+$/) : null,
    }) }))
  })
  it.each(['', 'false', '1', 'TRUE'])('does no provider work when the flag is %s', async flag => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', flag)
    const provider = vi.fn()
    expect(await optionalConsultSuitability({ ...args(), provider })).toBeUndefined()
    expect(provider).not.toHaveBeenCalled()
  })
  it('skips unsupported families, absent desired choices and exhausted time budgets', async () => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const provider = vi.fn()
    const base = args()
    for (const overrides of [
      { family: 'NAILS' },
      { startedAt: Date.now() - CONSULT_SUITABILITY_LATEST_START_MS },
      { input: { ...base.input, clientChoices: [{ clientWords: 'No stripes', sentiment: 'DISLIKE' as const }] } },
    ]) expect(await optionalConsultSuitability({ ...base, ...overrides, provider })).toBeUndefined()
    expect(provider).not.toHaveBeenCalled()
  })
  it('assigns exact revision provenance and quotes client words on the server', async () => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const provider = vi.fn().mockResolvedValue({ raw, model: 'test-model' })
    const result = await optionalConsultSuitability({ ...args(), provider })
    expect(result?.translation.analysisRevisionId).toBe('synthetic-analysis')
    expect(result?.translation.whatYouLoved.map(s => s.value)).toEqual(['Soft copper color around my face', 'Keep my own length'])
    expect(result?.translation.tailoring[0]?.sources.map(s => s.revisionId)).toEqual(['synthetic-client-choice', 'synthetic-analysis'])
    expect(provider).toHaveBeenCalledOnce()
  })
  it.each(['unavailable', 'refused', 'bad_output'] as const)('keeps the consultation on provider %s', async kind => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const provider = vi.fn().mockRejectedValue(new ConsultAnalysisProviderError(kind))
    expect(await optionalConsultSuitability({ ...args(), provider })).toBeUndefined()
  })
  it('recovers the 2026-09-13 production failure by asking once more', async () => {
    // ANALYSIS_SUITABILITY returned BAD_OUTPUT on a live consult and the client
    // silently lost her whole suitability translation, because this call had no
    // second attempt. One retry is the repair.
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const provider = vi.fn()
      .mockRejectedValueOnce(new ConsultAnalysisProviderError('bad_output', 'text_empty'))
      .mockResolvedValueOnce({ raw, model: 'test-model' })
    const result = await optionalConsultSuitability({ ...args(), provider })
    expect(provider).toHaveBeenCalledTimes(2)
    expect(result?.translation.analysisRevisionId).toBe('synthetic-analysis')
  })
  it.each(['unavailable', 'refused'] as const)('does not spend a second call on %s', async kind => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const provider = vi.fn().mockRejectedValue(new ConsultAnalysisProviderError(kind))
    expect(await optionalConsultSuitability({ ...args(), provider })).toBeUndefined()
    expect(provider).toHaveBeenCalledOnce()
  })
  it('gives up rather than starting a retry that would overrun the budget', async () => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const provider = vi.fn().mockRejectedValue(new ConsultAnalysisProviderError('bad_output'))
    // Inside the start gate, but with no room left for another full timeout.
    const startedAt = Date.now() - (CONSULT_SUITABILITY_LATEST_START_MS - CONSULT_SUITABILITY_TIMEOUT_MS) - 1
    expect(await optionalConsultSuitability({ ...args(), startedAt, provider })).toBeUndefined()
    expect(provider).toHaveBeenCalledOnce()
  })
  it('rejects fabricated citations, invalid model labels and mismatched companion revisions', async () => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const provider = vi.fn().mockResolvedValue({ raw: { ...raw, tailoring: [{ ...raw.tailoring[0], observationIds: ['profile.invented'] }] }, model: 'test-model' })
    expect(await optionalConsultSuitability({ ...args(), provider })).toBeUndefined()
    provider.mockResolvedValue({ raw, model: ' ' })
    expect(await optionalConsultSuitability({ ...args(), provider })).toBeUndefined()
    const base = args()
    if (!base.input.faceColor) throw new Error('Missing fixture')
    base.input.faceColor.analysisRevisionId = 'different-analysis'
    provider.mockClear()
    expect(await optionalConsultSuitability({ ...base, provider })).toBeUndefined()
    expect(provider).not.toHaveBeenCalled()
  })
  it('supports unknown observations without adding feature claims', async () => {
    vi.stubEnv('AI_CONSULT_SUITABILITY_ENABLED', 'true')
    const base = args()
    base.input.faceColor = undefined
    base.input.analysis.profile.skinUndertone = { value: 'UNKNOWN', confidence: { min: 0, max: 0.35 }, evidence: [] }
    const provider = vi.fn().mockResolvedValue({ raw: { ...raw, tailoring: [{ ...raw.tailoring[0], observationIds: [] }] }, model: 'test-model' })
    const result = await optionalConsultSuitability({ ...base, provider })
    expect(result?.translation.tailoring[0]?.status).toBe('NEEDS_PRO_CONFIRMATION')
  })
})
