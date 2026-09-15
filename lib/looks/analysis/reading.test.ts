import { describe, expect, it } from 'vitest'
import { analysisQuestions, parseFrames, parseReading, readAnalysis, readingAt } from './reading'
import { analysis, asset, frames, lookReadingFixture } from './testFixtures'
import { lookAnalysisSourceHash } from './identity'

describe('stored readings fail closed', () => {
  it('retains canonical observations and rejects silently degraded enum values', () => {
    expect(readAnalysis(lookReadingFixture().attributes)).toEqual(analysis())
    const attributes = lookReadingFixture().attributes
    expect(() => readAnalysis({ ...attributes, tone: { ...attributes.tone, value: 'invented' } })).toThrow()
  })
  it('does not substitute a different video reading for an unreadable or invalid selection', () => {
    expect(() => readingAt([null, lookReadingFixture()], 0)).toThrow()
    expect(readingAt([null, lookReadingFixture()], 1)).toEqual(lookReadingFixture())
    for (const index of [-1, 0.5, 2]) expect(() => readingAt([lookReadingFixture()], index)).toThrow()
  })
  it.each([[], [...frames, ...frames], [{ ...frames[0], atSeconds: -1 }], [{ ...frames[0], base64: '<script>' }], [{ ...frames[0], mediaType: 'text/html' }]].map(value => ({ value })))('rejects malformed stored frame sets', ({ value }) => {
    expect(() => parseFrames(value)).toThrow()
  })
  it('asks for uncertain fields and credibility clarifications without turning them into confirmed facts', () => {
    const result = parseReading({ ...lookReadingFixture(), attributes: { ...lookReadingFixture().attributes, tone: { value: 'UNKNOWN', confidence: { min: 0, max: 0.3 }, region: null, evidence: [] } }, credibilityFlags: ['EXTENSIONS_LIKELY', 'LIKELY_EDITED'] })
    expect(analysisQuestions(result, true).map(question => question.key)).toEqual(['mediaRole', 'field:tone', 'extensions', 'edited'])
    expect(result.attributes.tone?.value).toBe('UNKNOWN')
  })
})

describe('source identity', () => {
  it('invalidates reuse for changed pixels and crop but not caption edits', () => {
    const original = lookAnalysisSourceHash(asset)
    expect(lookAnalysisSourceHash({ ...asset, caption: 'new caption' })).toBe(original)
    expect(lookAnalysisSourceHash({ ...asset, storagePath: 'replacement.mp4' })).not.toBe(original)
    expect(lookAnalysisSourceHash({ ...asset, cropW: 0.5 })).not.toBe(original)
  })
})
