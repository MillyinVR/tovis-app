import { describe, expect, it } from 'vitest'

import {
  buildConsultDirectionOutputSchema,
  CONSULT_ANALYSIS_DIRECTION_OUTPUT_SCHEMA,
  CONSULT_ANALYSIS_PROFILE_OUTPUT_SCHEMA,
} from './analysisEngine'
import { CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA } from './inspirationVision'
import {
  findUnsupportedProviderSchemaKeywords,
  toProviderOutputSchema,
} from './providerSchema'

/**
 * The regression these tests exist for: `service-analysis-v3` shipped with
 * `minimum`/`maximum` on its numbers, `maxItems`/`uniqueItems` on its arrays,
 * and `minItems: 7` on its style directions. The Messages API rejects all
 * four, so every analysis call 400'd on the first request and the client saw
 * CONSULT_ANALYSIS_UNAVAILABLE. Nothing in the suite noticed, because the
 * provider was mocked everywhere.
 */
describe('toProviderOutputSchema', () => {
  it('strips every keyword the structured-output validator rejects', () => {
    const before = {
      type: 'object',
      additionalProperties: false,
      required: ['ratio', 'level', 'labels', 'exactly', 'name'],
      properties: {
        ratio: { type: 'number', minimum: 0, maximum: 1, multipleOf: 0.1 },
        level: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
        labels: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          uniqueItems: true,
          items: { type: 'string', enum: ['a', 'b'] },
        },
        exactly: { type: 'array', minItems: 7, items: { type: 'string' } },
        name: { type: 'string', minLength: 1, maxLength: 20, pattern: '^[a-z]+$' },
      },
    }
    expect(toProviderOutputSchema(before)).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['ratio', 'level', 'labels', 'exactly', 'name'],
      properties: {
        ratio: { type: 'number' },
        level: { type: ['integer', 'null'] },
        // minItems 1 survives; 7 does not.
        labels: { type: 'array', minItems: 1, items: { type: 'string', enum: ['a', 'b'] } },
        exactly: { type: 'array', items: { type: 'string' } },
        name: { type: 'string', minLength: 1, maxLength: 20, pattern: '^[a-z]+$' },
      },
    })
  })

  it('leaves a bound alone when it sits on a type the API does not police', () => {
    // `maxLength` on a string and `minItems: 0|1` on an array are accepted, so
    // the sanitizer must not over-strip and lose real constraints.
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', maxLength: 4 },
        b: { type: 'array', minItems: 0, items: { type: 'string' } },
      },
    }
    expect(toProviderOutputSchema(schema)).toEqual(schema)
  })

  it('makes every schema this repo sends acceptable, and proves the constants still state the bounds', () => {
    for (const schema of [
      CONSULT_ANALYSIS_PROFILE_OUTPUT_SCHEMA,
      CONSULT_ANALYSIS_DIRECTION_OUTPUT_SCHEMA,
      buildConsultDirectionOutputSchema({
        menuServiceNames: ['Balayage', 'Toner Gloss'],
        safetyCodes: ['ALLERGY_HISTORY_UNKNOWN'],
        suppliedShotKeys: ['hair_back', 'face_front'],
      }),
      CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
    ]) {
      // The constant is the statement of intent and still carries the bounds…
      expect(findUnsupportedProviderSchemaKeywords(schema).length).toBeGreaterThan(0)
      // …and what actually goes on the wire carries none of them.
      expect(findUnsupportedProviderSchemaKeywords(toProviderOutputSchema(schema))).toEqual(
        [],
      )
    }
  })
})
