import { ConsultProviderCallKind, ConsultProviderCallOutcome } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  buildConsultProviderCallRecord,
  consultProviderCheckForError,
} from './providerMeter'

describe('consultProviderCheckForError', () => {
  it('reads the analysis engine spelling (`check`)', () => {
    expect(
      consultProviderCheckForError(
        Object.assign(new Error('x'), { kind: 'bad_output', check: 'text_empty' }),
      ),
    ).toBe('text_empty')
  })

  it('reads the inspiration engine spelling (`stage`)', () => {
    // The two names are the same concept — see the mapper's header for why the
    // divergence is tolerated rather than renamed.
    expect(
      consultProviderCheckForError(
        Object.assign(new Error('x'), {
          kind: 'bad_output',
          stage: 'region_containment',
        }),
      ),
    ).toBe('region_containment')
  })

  it('prefers `check` when an error somehow carries both', () => {
    expect(
      consultProviderCheckForError(
        Object.assign(new Error('x'), { check: 'text_length', stage: 'envelope' }),
      ),
    ).toBe('text_length')
  })

  it('yields null for errors that name no check', () => {
    for (const value of [null, undefined, new Error('plain'), {}, 'text_empty']) {
      expect(consultProviderCheckForError(value)).toBeNull()
    }
  })

  it('refuses anything that is not a short identifier', () => {
    // The column's guarantee: never a value, a prompt, or client text, whatever
    // a future engine decides to pass.
    for (const check of [
      'she said her hair feels dry', // prose (spaces)
      'x'.repeat(65), // unbounded
      '', // empty
      '   ', // whitespace only
      { nested: 'object' },
      42,
    ]) {
      expect(
        consultProviderCheckForError(Object.assign(new Error('x'), { check })),
      ).toBeNull()
    }
  })

  it('accepts every check name the engines actually emit', () => {
    // Sampled from the real throw sites across the three engines.
    for (const check of [
      'text_empty',
      'region_containment',
      'confidence_range',
      'options_not_allowed',
      'key_not_in_vocabulary',
      'max_tokens',
      'json_parse',
    ]) {
      expect(
        consultProviderCheckForError(Object.assign(new Error('x'), { check })),
      ).toBe(check)
    }
  })
})

describe('buildConsultProviderCallRecord', () => {
  const base = {
    kind: ConsultProviderCallKind.ANALYSIS_PROFILE,
    outcome: ConsultProviderCallOutcome.BAD_OUTPUT,
    model: 'claude-sonnet-5',
    latencyMs: 1200,
  }

  it('carries the failure check onto the row', () => {
    expect(
      buildConsultProviderCallRecord({ ...base, failureCheck: 'text_empty' }),
    ).toMatchObject({ failureCheck: 'text_empty' })
  })

  it('records null rather than refusing when no check is supplied', () => {
    expect(buildConsultProviderCallRecord(base)).toMatchObject({
      failureCheck: null,
    })
  })

  it('never lets an unbounded value reach the column', () => {
    expect(
      buildConsultProviderCallRecord({ ...base, failureCheck: 'a'.repeat(200) }),
    ).toMatchObject({ failureCheck: null })
  })
})
