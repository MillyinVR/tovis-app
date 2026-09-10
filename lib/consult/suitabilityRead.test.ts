import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syntheticSuitabilityInput } from '@/tests/fixtures/consultSuitability'
import { buildConsultSuitabilityContext, sanitizeConsultSuitabilityResponse } from './suitabilityTranslation'
import { clientSuitability, proSuitability, normalizeStoredSuitability, loadConsultSuitability } from './suitabilityRead'
const mocks = vi.hoisted(() => ({ find: vi.fn(), revision: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { consultSuitabilityTranslation: { findFirst: mocks.find }, consultRevision: { findFirst: mocks.revision } } }))
import { prisma } from '@/lib/prisma'

const context = buildConsultSuitabilityContext(syntheticSuitabilityInput())
const translation = () => sanitizeConsultSuitabilityResponse({
  tailoring: [{ clientExplanation: 'Consider soft color near your face.', professionalDirection: 'Consider copper face framing.', clientChoiceIds: ['choice.0'], observationIds: ['profile.skinUndertone'] }],
  proConfirmations: [{ clientExplanation: 'Your pro can check your starting color.', professionalCheck: 'Assess current tone in person.', sourceIds: ['choice.0'] }],
}, context)

beforeEach(() => { mocks.find.mockResolvedValue(null); mocks.revision.mockResolvedValue(null) })
describe('stored suitability role projections', () => {
  it('retains exact quotes, professional terminology and observation provenance only in the pro projection', () => {
    const normalized = normalizeStoredSuitability(translation(), context)
    expect(normalized).toEqual(translation())
    if (!normalized) throw new Error('Expected valid translation')
    const client = clientSuitability(normalized)
    const pro = proSuitability(normalized)
    expect(client.whatYouLoved).toEqual(['Soft copper color around my face', 'Keep my own length'])
    expect(client.tailoring).toEqual([{ explanation: 'Consider soft color near your face.', needsConfirmation: false }])
    expect(JSON.stringify(client)).not.toMatch(/sources|confidence|professionalDirection|copper face framing/)
    expect(pro.tailoring[0]).toMatchObject({ direction: 'Consider copper face framing.', sources: [
      { provenance: 'CLIENT_REPORTED', revisionId: context.clientRevisionId },
      { label: 'Skin undertone', value: 'warm', provenance: 'OBSERVED', revisionId: context.analysisRevisionId, confidence: { min: 0.7, max: 0.85 }, evidence: ['face_front'] },
    ] })
  })
  it.each([
    { schemaVersion: 2 }, { promptVersion: 'future' }, { analysisRevisionId: 'different' },
    { clientRevisionId: 'different' }, { requiresProfessionalReview: false }, { whatYouLoved: [] },
    { tailoring: [] }, { extra: true }, { proConfirmations: [{}] },
  ])('omits malformed, unknown-version or mismatched stored data: %j', change => {
    expect(normalizeStoredSuitability({ ...translation(), ...change }, context)).toBeNull()
  })
  it('rejects forged source values and unsupported status even when citation IDs look valid', () => {
    const stored = translation()
    const item = stored.tailoring[0]
    if (!item) throw new Error('Missing fixture')
    item.sources[0] = { id: 'choice.0', value: 'Invented preference', revisionId: context.clientRevisionId, provenance: 'CLIENT_REPORTED', sentiment: 'LIKE' }
    expect(normalizeStoredSuitability(stored, context)).toBeNull()
    expect(normalizeStoredSuitability({ ...translation(), tailoring: [{ ...item, status: 'APPROVED' }] }, context)).toBeNull()
  })
  it('looks up only the requested same-session analysis and leaves historical absence empty', async () => {
    expect(await loadConsultSuitability(prisma, 'consult', 'analysis')).toBeNull()
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { consultSessionId: 'consult', analysisRevisionId: 'analysis' } }))
    expect(mocks.revision).not.toHaveBeenCalled()
  })
  it('omits a sibling when the client has already changed the inspiration revision', async () => {
    mocks.find.mockResolvedValue({ schemaVersion: 1, promptVersion: 'suitability-translation-v1', consultSessionId: 'consult', analysisRevisionId: 'analysis', clientRevisionId: 'client-v1',
      analysisRevision: { consultSessionId: 'consult', kind: 'ANALYSIS', revision: 3 }, clientRevision: { consultSessionId: 'consult', kind: 'INSPIRATION', revision: 2 } })
    mocks.revision.mockResolvedValue({ id: 'client-v2' })
    expect(await loadConsultSuitability(prisma, 'consult', 'analysis')).toBeNull()
  })
})
