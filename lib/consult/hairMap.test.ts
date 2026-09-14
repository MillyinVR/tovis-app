import { describe, expect, it } from 'vitest'
import { hairMapFixture, hairObservation } from '@/test/fixtures/consultHairMap'
import { buildConsultHairMapSchema, sanitizeConsultHairMap } from './hairMap'
import { compareConsultHairMaps, consultHairComparisonBlock } from './hairComparison'
import { findUnsupportedProviderSchemaKeywords, toProviderOutputSchema } from './providerSchema'

const scope = { role: 'CURRENT', views: ['hair_back'] } as const
describe('evidence-bound hair maps', () => {
  it('keeps different root, mid and end readings, including reversed depth', () => {
    const map = hairMapFixture()
    map.zones.roots.level = hairObservation('level', 'LEVEL_8')
    map.zones.ends.level = hairObservation('level', 'LEVEL_4')
    expect(sanitizeConsultHairMap(map, scope)).toEqual(map)
    expect(map.zones.mids.level.value).toBe('UNKNOWN')
  })
  it('never accepts inspiration as current-hair evidence', () => {
    const map = hairMapFixture()
    map.zones.roots.level = hairObservation('level', 'LEVEL_8', 'inspiration')
    expect(() => sanitizeConsultHairMap(map, scope)).toThrow()
    expect(() => buildConsultHairMapSchema({ role: 'REFERENCE', views: ['hair_back'] })).toThrow()
  })
  it('refuses known observations without visible evidence', () => {
    const map = hairMapFixture()
    map.zones.roots.level.value = 'LEVEL_8'
    expect(() => sanitizeConsultHairMap(map, scope)).toThrow()
  })
  it('refuses unknown claims with evidence or unsupported certainty', () => {
    const map = hairMapFixture()
    map.zones.roots.level.confidence.max = 0.8
    expect(() => sanitizeConsultHairMap(map, scope)).toThrow()
    map.zones.roots.level = hairObservation('level', 'UNKNOWN')
    expect(() => sanitizeConsultHairMap(map, scope)).toThrow()
  })
  it.each([NaN, Infinity, -0.1, 1.1])('refuses invalid confidence %s', value => {
    const map = hairMapFixture()
    map.zones.roots.level.confidence.max = value
    expect(() => sanitizeConsultHairMap(map, scope)).toThrow()
  })
  it('refuses out-of-frame and duplicate evidence', () => {
    const map = hairMapFixture()
    const observed = hairObservation('level', 'LEVEL_8')
    map.zones.roots.level = observed
    const evidence = observed.evidence[0]
    if (!evidence) throw new Error('Missing fixture evidence')
    evidence.region.w = 0.9
    expect(() => sanitizeConsultHairMap(map, scope)).toThrow()
    evidence.region.w = 0.3
    observed.evidence.push(evidence)
    expect(() => sanitizeConsultHairMap(map, scope)).toThrow()
  })
  it('caps color certainty for warning-tagged photos without discarding shape', () => {
    const map = hairMapFixture()
    map.zones.roots.level = hairObservation('level', 'LEVEL_8')
    map.shape.length = hairObservation('length', 'BELOW_CHEST')
    const result = sanitizeConsultHairMap(map, { ...scope, colorUncertainViews: ['hair_back'] })
    expect(result.zones.roots.level.confidence).toEqual({ min: 0.35, max: 0.49 })
    expect(result.shape.length.confidence.min).toBe(0.7)
  })
  it('refuses unknown fields and the wrong field vocabulary', () => {
    const map = hairMapFixture()
    expect(() => sanitizeConsultHairMap({ ...map, porosity: 'LOW' }, scope)).toThrow()
    expect(() => sanitizeConsultHairMap({ ...map, shape: { ...map.shape, length: hairObservation('tone', 'GOLD') } }, scope)).toThrow()
  })
  it('never promotes an any-light selfie into settled color evidence', () => {
    const map = hairMapFixture('early_photo')
    map.zones.roots.level = hairObservation('level', 'LEVEL_4', 'early_photo')
    const result = sanitizeConsultHairMap(map, { role: 'CURRENT', views: ['early_photo'] })
    expect(result.zones.roots.level.confidence.max).toBeLessThan(0.5)
  })
  it('uses the shared provider-schema adapter', () => {
    const schema = toProviderOutputSchema(buildConsultHairMapSchema(scope))
    expect(findUnsupportedProviderSchemaKeywords(schema)).toEqual([])
    expect(JSON.stringify(schema)).toContain('#/$defs/zone')
  })
})

describe('current/reference comparison', () => {
  it('computes a visual difference only when both readings support one', () => {
    const current = hairMapFixture()
    const reference = hairMapFixture('inspiration')
    current.zones.roots.level = hairObservation('level', 'LEVEL_4')
    reference.zones.roots.level = hairObservation('level', 'LEVEL_8', 'inspiration')
    current.zones.ends.tone = hairObservation('tone', 'GOLD')
    reference.zones.ends.tone = hairObservation('tone', 'GOLD', 'inspiration')
    const comparison = compareConsultHairMaps(current, reference)
    expect(comparison.differences).toHaveLength(20)
    expect(comparison.differences[0]).toMatchObject({ status: 'OBSERVED_DIFFERENCE', observedLevelDifference: 4 })
    expect(comparison.differences.find(item => item.field === 'zones.ends.tone')?.status).toBe('OBSERVED_MATCH')
    expect(comparison.differences.find(item => item.field === 'shape.length')?.status).toBe('NEEDS_CONFIRMATION')
    reference.zones.roots.level.confidence.min = 0.3
    const uncertain = compareConsultHairMaps(current, reference).differences[0]
    expect(uncertain?.status).toBe('NEEDS_CONFIRMATION')
    expect(uncertain).not.toHaveProperty('observedLevelDifference')
  })
  it('passes observations without inventing client goals, chemistry or menu work', () => {
    const comparison = compareConsultHairMaps(hairMapFixture(), hairMapFixture('inspiration'))
    expect(comparison).not.toHaveProperty('services')
    expect(comparison).not.toHaveProperty('target')
    const block = consultHairComparisonBlock(comparison)
    expect(block).toContain('not confirmed target attributes')
    expect(block).toContain('not achievable chemical lift')
  })
})
