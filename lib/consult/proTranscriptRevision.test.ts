import { describe, expect, it } from 'vitest'
import { projectTranscriptInspiration } from './proTranscriptInspiration'
import { projectProTranscriptRevisions } from './proTranscriptRevision'
import { HAIR_GENERAL_INTAKE_PACK_V1 } from './intake/packs/hairGeneral'
import { buildExactClientDetails, buildPossibleProfessionalInterpretation } from './inspirationPack'

type Row = Parameters<typeof projectProTranscriptRevisions>[1][number]

function row(overrides: Partial<Row> = {}): Row {
  return { id: 'r1', consultSessionId: 'consult-1', revision: 1, kind: 'INTAKE',
    createdAt: new Date('2026-09-09T12:00:00Z'), schemaVersion: 2,
    payload: { packId: 'hair-general', packVersion: 1, schemaVersion: 2,
      complete: false, answers: { current_length: 'shoulder' } }, ...overrides }
}

describe('professional transcript revision foundation', () => {
  it('uses the historical pack and includes a single revision without needing a diff', () => {
    const question = HAIR_GENERAL_INTAKE_PACK_V1.questions.find(item => item.key === 'current_length')!
    const option = question.options[0]
    if (!option) throw new Error('Historical intake fixture has no options.')
    const input = row({ payload: { packId: 'hair-general', packVersion: 1, schemaVersion: 2,
      complete: false, answers: { current_length: option.value } } })
    expect(projectProTranscriptRevisions('consult-1', [input])).toEqual([{
      revisionId: 'r1', revision: 1, createdAt: '2026-09-09T12:00:00.000Z',
      kind: 'INTAKE', availability: 'AVAILABLE', items: [{
        questionKey: 'current_length', question: question.label, answerCode: option.value, answer: option.label,
      }],
    }])
  })

  it('fails closed for a mixed-session result', () => {
    expect(() => projectProTranscriptRevisions('consult-1', [row(), row({ consultSessionId: 'other' })]))
      .toThrow('scope mismatch')
  })

  it('preserves unavailable historical entries and later revision identity', () => {
    const output = projectProTranscriptRevisions('consult-1', [
      row({ payload: { schemaVersion: 999, hidden: 'never expose' } }),
      row({ id: 'r8', revision: 8, kind: 'BRIEF', payload: { hidden: 'never expose' } }),
    ])
    expect(output.map(item => [item.revision, item.availability])).toEqual([[1, 'UNAVAILABLE'], [8, 'REFERENCE_ONLY']])
    expect(JSON.stringify(output)).not.toContain('never expose')
  })

  it('sorts by immutable revision order without mutating the query result', () => {
    const inputs = [row({ id: 'r3', revision: 3, kind: 'BRIEF' }), row({ kind: 'ANALYSIS' })]
    expect(projectProTranscriptRevisions('consult-1', inputs).map(item => item.revision)).toEqual([1, 3])
    expect(inputs.map(item => item.revision)).toEqual([3, 1])
  })

  it('omits provider-only inspiration analysis and never spreads plan payloads', () => {
    const output = projectProTranscriptRevisions('consult-1', [
      row({ kind: 'INSPIRATION_ANALYSIS', payload: { reasoning: 'private' } }),
      row({ id: 'r2', revision: 2, kind: 'ANALYSIS', payload: { reasoning: 'private', objectKey: 'private/photo.jpg' } }),
    ])
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ kind: 'ANALYSIS', availability: 'REFERENCE_ONLY' })
    expect(JSON.stringify(output)).not.toMatch(/private|reasoning|objectKey|payload/)
  })

  it('projects client words without media IDs or professional interpretations', () => {
    const answers = [{ questionKey: 'favorite_colors' as const, selectedValues: ['warm-golden'], text: null, sentiment: null }]
    const details = buildExactClientDetails(answers)
    const input = row({ kind: 'INSPIRATION', schemaVersion: 1, payload: {
      contractId: 'hair-color-guided-inspiration', contractVersion: 1, schemaVersion: 1,
      source: 'EXTERNAL_UPLOAD', inspirationId: 'private-media-id', complete: false,
      answers, exactClientDetails: details, possibleProfessionalInterpretation: buildPossibleProfessionalInterpretation(details),
      catalogGuidance: [],
    } })
    const output = projectProTranscriptRevisions('consult-1', [input])
    expect(output[0]).toMatchObject({ kind: 'INSPIRATION', availability: 'AVAILABLE', details })
    expect(JSON.stringify(output)).not.toMatch(/private-media-id|possibleProfessionalInterpretation|catalogGuidance/)
  })

  it('keeps a marker when inspiration is malformed or has a mismatched schema pin', () => {
    expect(projectProTranscriptRevisions('consult-1', [row({ kind: 'INSPIRATION', payload: null })])[0])
      .toMatchObject({ kind: 'INSPIRATION', availability: 'UNAVAILABLE' })
  })

  it('returns an empty history for a session with no stored revisions', () => {
    expect(projectProTranscriptRevisions('consult-1', [])).toEqual([])
  })
})

it('keeps neutral reference answers in history even though they are omitted from the brief', () => {
  const answers = [{ questionKey: 'favorite_colors' as const, selectedValues: ['not-sure'], text: null, sentiment: null }]
  const payload = { contractId: 'hair-color-guided-inspiration', contractVersion: 1, schemaVersion: 1,
    source: 'EXTERNAL_UPLOAD', inspirationId: 'private-media', complete: false, answers,
    exactClientDetails: buildExactClientDetails(answers), possibleProfessionalInterpretation: [], catalogGuidance: [] }
  const items = projectTranscriptInspiration(payload)
  expect(items).toHaveLength(1)
  expect(items[0]?.value).toBe('Not sure')
  expect(JSON.stringify(items)).not.toContain('private-media')
})
