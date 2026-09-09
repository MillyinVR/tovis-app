import { describe, expect, it } from 'vitest'

import { syntheticSuitabilityInput } from '@/tests/fixtures/consultSuitability'
import { ConsultAnalysisProviderError } from './analysisValidation'
import {
  buildConsultSuitabilityContext, buildConsultSuitabilityOutputSchema,
  consultSuitabilityProviderContext, sanitizeConsultSuitabilityResponse,
} from './suitabilityTranslation'

function response() {
  return {
    tailoring: [{ clientExplanation: 'Keep your soft copper feeling with gentle color around your face.',
      professionalDirection: 'Use a soft copper tone direction with diffused face-framing placement.',
      clientChoiceIds: ['choice.0'], observationIds: ['profile.skinUndertone', 'faceColor.skinDepth'] }],
    proConfirmations: [{ clientExplanation: 'Your pro will check your current color and hair history.',
      professionalCheck: 'Confirm the starting tone and color history in person before selecting a technical approach.',
      sourceIds: ['choice.0', 'choice.1'] }],
  }
}

describe('C2-2 shared suitability contract', () => {
  it('resolves both role translations to the same immutable sources without promoting model authority', () => {
    const input = syntheticSuitabilityInput()
    const before = structuredClone(input)
    const context = buildConsultSuitabilityContext(input)
    const result = sanitizeConsultSuitabilityResponse(response(), context)
    expect(result.whatYouLoved.map(source => source.value)).toEqual(input.clientChoices.slice(0, 2).map(item => item.clientWords))
    expect(result.tailoring[0]?.provenance).toBe('DERIVED_GUIDANCE')
    expect(result.requiresProfessionalReview).toBe(true)
    expect(result.proConfirmations[0]?.provenance).toBe('NEEDS_PRO_CONFIRMATION')
    expect(result.tailoring[0]?.sources.find(source => source.id === 'faceColor.skinDepth')).toEqual({
      id: 'faceColor.skinDepth', provenance: 'OBSERVED', revisionId: input.analysisRevisionId,
      value: 'MEDIUM', confidence: { min: 0.65, max: 0.8 }, evidence: ['face_front'],
    })
    expect(input).toEqual(before)
    result.tailoring[0]!.sources[0]!.value = 'mutated output'
    expect(context.sources[0]?.value).toBe(input.clientChoices[0]?.clientWords)
  })

  it('preserves verbatim client words and snapshots sources before later input mutations', () => {
    const input = syntheticSuitabilityInput()
    input.clientChoices[0]!.clientWords = '  I like this look at age 50.  '
    const context = buildConsultSuitabilityContext(input)
    input.clientChoices[0]!.clientWords = 'a later choice'
    input.analysis.profile.skinUndertone.evidence.length = 0
    const result = sanitizeConsultSuitabilityResponse(response(), context)
    expect(result.whatYouLoved[0]?.value).toBe('  I like this look at age 50.  ')
    expect(result.tailoring[0]?.sources.find(source => source.id === 'profile.skinUndertone')).toMatchObject({ evidence: ['face_front'] })
  })

  it('excludes missing, UNKNOWN, low-confidence and intake-only observations from the provider citation vocabulary', () => {
    const input = syntheticSuitabilityInput()
    input.faceColor = undefined
    input.analysis.profile.skinUndertone.confidence.min = 0.49
    input.analysis.core.currentTone = { value: 'GOLDEN', confidence: { min: 0.7, max: 0.9 }, evidence: ['intake'] }
    const context = buildConsultSuitabilityContext(input)
    expect(context.sources.every(source => source.provenance === 'CLIENT_REPORTED')).toBe(true)
    expect(context.unknownFields).toEqual(expect.arrayContaining(['profile.skinUndertone', 'profile.eyeColor', 'core.currentTone', 'faceColor.skinDepth']))
    const schema = JSON.stringify(buildConsultSuitabilityOutputSchema(context))
    expect(schema).not.toContain('profile.skinUndertone')
    expect(schema).not.toContain('faceColor.skinDepth')
    expect(() => sanitizeConsultSuitabilityResponse(response(), context)).toThrow(ConsultAnalysisProviderError)
    const uncertain = response()
    uncertain.tailoring[0]!.clientChoiceIds = ['choice.0']
    uncertain.tailoring[0]!.observationIds = []
    uncertain.tailoring[0]!.clientExplanation = 'Your pro will confirm how to tailor your chosen copper look.'
    uncertain.tailoring[0]!.professionalDirection = 'Assess the starting point before determining placement.'
    expect(sanitizeConsultSuitabilityResponse(uncertain, context).tailoring[0]?.status).toBe('NEEDS_PRO_CONFIRMATION')
    const selfCertified = { ...uncertain, tailoring: [{ ...uncertain.tailoring[0], status: 'SUPPORTED' }] }
    expect(() => sanitizeConsultSuitabilityResponse(selfCertified, context)).toThrow(ConsultAnalysisProviderError)
  })

  it('keeps avoidance boundaries separate from desired choices and labels client-only directions as needing confirmation', () => {
    const raw = response()
    raw.tailoring[0]!.clientChoiceIds = ['choice.2']
    raw.tailoring[0]!.observationIds = []
    raw.tailoring[0]!.clientExplanation = 'Keep your color transition soft rather than striped.'
    raw.tailoring[0]!.professionalDirection = 'Respect the client boundary against defined stripes.'
    const result = sanitizeConsultSuitabilityResponse(raw, buildConsultSuitabilityContext(syntheticSuitabilityInput()))
    expect(result.whatYouLoved.map(source => source.id)).toEqual(['choice.0', 'choice.1'])
    expect(result.tailoring[0]?.status).toBe('NEEDS_PRO_CONFIRMATION')
    expect(result.tailoring[0]?.sources[0]).toMatchObject({ id: 'choice.2', sentiment: 'DISLIKE', provenance: 'CLIENT_REPORTED' })
  })

  it('rejects a companion from another analysis and invalid color or confidence evidence', () => {
    const input = syntheticSuitabilityInput()
    input.faceColor!.analysisRevisionId = 'older-analysis'
    expect(() => buildConsultSuitabilityContext(input)).toThrow(ConsultAnalysisProviderError)
    input.faceColor!.analysisRevisionId = input.analysisRevisionId
    input.faceColor!.profile.skinDepth.evidence = ['eyes_closeup']
    expect(() => buildConsultSuitabilityContext(input)).toThrow(ConsultAnalysisProviderError)
    input.faceColor = undefined
    input.analysis.profile.skinUndertone.confidence.min = Number.NaN
    expect(() => buildConsultSuitabilityContext(input)).toThrow(ConsultAnalysisProviderError)
  })

  it('keeps opaque revision IDs out of the provider packet and rejects missing client intent', () => {
    const input = syntheticSuitabilityInput()
    const packet = consultSuitabilityProviderContext(buildConsultSuitabilityContext(input))
    expect(packet).not.toContain(input.analysisRevisionId)
    expect(packet).not.toContain(input.clientRevisionId)
    expect(packet).toContain('CLIENT_REPORTED')
    input.clientChoices = [{ clientWords: 'No bold stripes', sentiment: 'DISLIKE' }]
    expect(() => buildConsultSuitabilityContext(input)).toThrow(ConsultAnalysisProviderError)
  })

  it.each(['profile.eyeColor', 'older-analysis:skinDepth', 'kb.fabricated', 'inspiration.skinDepth'])(
    'rejects unavailable or fabricated source %s', id => {
      const raw = response(); raw.tailoring[0]!.observationIds.push(id)
      expect(() => sanitizeConsultSuitabilityResponse(raw, buildConsultSuitabilityContext(syntheticSuitabilityInput()))).toThrow(ConsultAnalysisProviderError)
    },
  )

  it('rejects model-controlled preferences, wrong source roles, duplicated citations and authority claims', () => {
    const context = buildConsultSuitabilityContext(syntheticSuitabilityInput())
    for (const loved of [['choice.0'], ['choice.0', 'choice.2'], ['choice.0', 'choice.0']]) {
      expect(() => sanitizeConsultSuitabilityResponse({ ...response(), whatYouLoved: loved }, context)).toThrow(ConsultAnalysisProviderError)
    }
    const raw = response()
    raw.tailoring[0]!.clientChoiceIds = ['profile.skinUndertone']
    expect(() => sanitizeConsultSuitabilityResponse(raw, context)).toThrow(ConsultAnalysisProviderError)
    raw.tailoring[0]!.clientChoiceIds = ['choice.0', 'choice.0']
    expect(() => sanitizeConsultSuitabilityResponse(raw, context)).toThrow(ConsultAnalysisProviderError)
    expect(() => sanitizeConsultSuitabilityResponse({ ...response(), provenance: 'KB_VERIFIED' }, context)).toThrow(ConsultAnalysisProviderError)
    expect(() => sanitizeConsultSuitabilityResponse({ ...response(), proConfirmations: [] }, context)).toThrow(ConsultAnalysisProviderError)
  })

  it.each(['Use 20 volume developer.', 'Order two packs.', 'Order sixteen packs.', 'Use ½ of the mixture.', 'Charge $100.', 'Use a mixing ratio.', 'Wait ten minutes.'])(
    'rejects unsourced technical guidance: %s', text => {
      const raw = response(); raw.tailoring[0]!.professionalDirection = text
      expect(() => sanitizeConsultSuitabilityResponse(raw, buildConsultSuitabilityContext(syntheticSuitabilityInput()))).toThrow(ConsultAnalysisProviderError)
    },
  )
})
