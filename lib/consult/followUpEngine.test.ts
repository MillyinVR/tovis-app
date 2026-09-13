// lib/consult/followUpEngine.test.ts
//
// P5g — what the follow-up call is ALLOWED to have said.
//
// The provider is mocked here, and that is the correct scope: this file tests
// the sanitizer, which is the server deciding what a response may mean. That
// the schema and prompt actually WORK against the live model is a different
// claim and a different suite (tests/live/consult-provider-schema.test.ts,
// Part 0 rule 10) — a mock cannot make that one.

import { describe, expect, it } from 'vitest'

import {
  buildConsultFollowUpOutputSchema,
  CONSULT_FOLLOW_UP_MAX_OPTIONS,
  CONSULT_FOLLOW_UP_MAX_QUESTIONS,
  CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH,
  ConsultFollowUpError,
  sanitizeConsultFollowUpQuestions,
} from './followUpEngine'
import type {
  ConsultFollowUpVocabulary,
  ConsultFollowUpVocabularyEntry,
} from './followUpVocabulary'

function entry(
  key: string,
  values: string[],
  home: 'INTAKE' | 'FOLLOW_UP' = 'INTAKE',
  safety = false,
): ConsultFollowUpVocabularyEntry {
  return {
    key,
    home,
    packLabel: `The pack's own wording for ${key}`,
    options: values.map((value) => ({ value, label: value })),
    allowText: true,
    safety,
  }
}

function vocabulary(
  entries: ConsultFollowUpVocabularyEntry[],
): ConsultFollowUpVocabulary {
  return { entries, byKey: new Map(entries.map((item) => [item.key, item])) }
}

const VOCABULARY = vocabulary([
  entry('prior_lightening', ['never', 'within-3-months', 'not-sure'], 'INTAKE', true),
  entry('maintenance_tolerance', ['low', 'medium', 'high'], 'FOLLOW_UP'),
])

function question(overrides: Record<string, unknown> = {}) {
  return {
    key: 'prior_lightening',
    text: 'You’re at a light brown now and you loved the ash — when was your hair last lightened?',
    evidence: 'core.baseLevel LEVEL_6, wants tone:COOL',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'within-3-months', label: 'In the last few months' },
    ],
    ...overrides,
  }
}

const sanitize = (raw: unknown) =>
  sanitizeConsultFollowUpQuestions(raw, VOCABULARY)

describe('the follow-up sanitizer', () => {
  it('accepts a well-formed round and carries the home from the vocabulary', () => {
    const questions = sanitize({ questions: [question()] })
    expect(questions).toHaveLength(1)
    // 🔴 `home` is the SERVER's, never the model's: it decides where the answer
    // is filed, and a model that could choose it could file a henna answer
    // somewhere the safety policy cannot read.
    expect(questions[0]!.home).toBe('INTAKE')
    expect(questions[0]!.options.map((o) => o.value)).toEqual([
      'never',
      'within-3-months',
    ])
  })

  it('🔴 refuses an option value the key does not actually have', () => {
    // The constraint the grammar could not hold (Part 0 rule 11): which values
    // are legal depends on which key was chosen, and a JSON-schema enum cannot
    // depend on a sibling property. So it is checked here, and a violation
    // fails the whole round rather than being dropped — dropping it would leave
    // her a question with one button.
    expect(() =>
      sanitize({
        questions: [question({ options: [
          { value: 'never', label: 'Never' },
          { value: 'last-tuesday', label: 'Last Tuesday' },
        ] })],
      }),
    ).toThrow(ConsultFollowUpError)
  })

  it('refuses a key outside the vocabulary', () => {
    expect(() => sanitize({ questions: [question({ key: 'invented_key' })] })).toThrow(
      ConsultFollowUpError,
    )
  })

  it('refuses the same key twice in one round', () => {
    expect(() => sanitize({ questions: [question(), question()] })).toThrow(
      ConsultFollowUpError,
    )
  })

  it('refuses a question with fewer than two answers', () => {
    expect(() =>
      sanitize({
        questions: [question({ options: [{ value: 'never', label: 'Never' }] })],
      }),
    ).toThrow(ConsultFollowUpError)
  })

  it('refuses more questions than a round may ask', () => {
    // `maxItems` does not survive the provider boundary, so this is the only
    // thing enforcing it before the database CHECK does.
    const many = Array.from({ length: CONSULT_FOLLOW_UP_MAX_QUESTIONS + 1 }, (_, i) =>
      question({ key: i === 0 ? 'prior_lightening' : 'maintenance_tolerance' }),
    )
    expect(() => sanitize({ questions: many })).toThrow(ConsultFollowUpError)
  })

  it('refuses an empty round', () => {
    expect(() => sanitize({ questions: [] })).toThrow(ConsultFollowUpError)
  })

  it('🔴 refuses a question that says anything about the PERSON', () => {
    // The same word list the database CHECK carries, applied here so a
    // violating round becomes a REFUSAL — and therefore a safety fallback —
    // rather than a constraint violation at the insert. The database is the
    // backstop; this is the place that fails politely.
    for (const text of [
      'Your skin looks warm, so would you like a warmer tone?',
      'That shade would suit your face — shall we go lighter?',
      'Any health conditions we should know about?',
    ]) {
      expect(() => sanitize({ questions: [question({ text })] })).toThrow(
        ConsultFollowUpError,
      )
    }
  })

  it('refuses an identity word hiding in an option LABEL', () => {
    expect(() =>
      sanitize({
        questions: [question({ options: [
          { value: 'never', label: 'Never' },
          { value: 'within-3-months', label: 'Since my skin reacted' },
        ] })],
      }),
    ).toThrow(ConsultFollowUpError)
  })

  it('refuses prose past the cap, and blank prose', () => {
    expect(() =>
      sanitize({
        questions: [question({ text: 'a'.repeat(CONSULT_FOLLOW_UP_MAX_TEXT_LENGTH + 1) })],
      }),
    ).toThrow(ConsultFollowUpError)
    expect(() => sanitize({ questions: [question({ text: '   ' })] })).toThrow(
      ConsultFollowUpError,
    )
    expect(() => sanitize({ questions: [question({ evidence: '' })] })).toThrow(
      ConsultFollowUpError,
    )
  })

  it('🔴 refuses an internal name on a surface the CLIENT reads', () => {
    // Found by running it, not by reading it: the first live call produced
    // "You loved that cool, pale lightestLevel:LEVEL_9 look…" for a client to
    // read. The context no longer passes a code and the prompt forbids one;
    // this is the layer that makes it structural.
    for (const text of [
      'You loved that cool, pale lightestLevel:LEVEL_9 look — how much upkeep works?',
      'Your reference reads BABYLIGHTS through the mids. Is that what you want?',
      'You marked change_scale as noticeable — is there a date you are working to?',
    ]) {
      expect(() => sanitize({ questions: [question({ text })] })).toThrow(
        ConsultFollowUpError,
      )
    }
    expect(() =>
      sanitize({
        questions: [question({ options: [
          { value: 'never', label: 'Never' },
          { value: 'within-3-months', label: 'Since my LEVEL_9 service' },
        ] })],
      }),
    ).toThrow(ConsultFollowUpError)
  })

  it('🔴 still allows an internal name in EVIDENCE, which no client reads', () => {
    // The mirror image, and it is load-bearing: evidence is what a reviewer
    // grades the question by, and a code is exactly what makes it gradeable.
    // A check applied here would refuse every honest evidence line.
    const questions = sanitize({
      questions: [
        question({
          evidence: 'wants lightestLevel:LEVEL_9 and tone:COOL; core.baseLevel LEVEL_6',
        }),
      ],
    })
    expect(questions[0]!.evidence).toContain('lightestLevel:LEVEL_9')
  })

  it('accepts plain-language prose that merely mentions a level', () => {
    // The rule must not be so broad that it refuses the sentence P5g is FOR.
    const questions = sanitize({
      questions: [
        question({
          text: 'You’re at a light brown now and you loved the ash — that’s usually two visits. Would coming back in a few weeks work?',
        }),
      ],
    })
    expect(questions[0]!.text).toContain('light brown')
  })

  it('refuses a duplicated option value', () => {
    expect(() =>
      sanitize({
        questions: [question({ options: [
          { value: 'never', label: 'Never' },
          { value: 'never', label: 'Never again' },
        ] })],
      }),
    ).toThrow(ConsultFollowUpError)
  })
})

describe('the follow-up output schema', () => {
  it('🔴 pins the key enum to THIS consult’s vocabulary', () => {
    const schema = buildConsultFollowUpOutputSchema(VOCABULARY)
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    const key = (defs.question!.properties as Record<string, Record<string, unknown>>)
      .key!
    // A per-run enum is the remedy Part 0 rule 11 names first: reshape so the
    // grammar can hold the constraint. An invented question is not a thing this
    // call can return, rather than a thing the sanitizer has to catch.
    expect(key.enum).toEqual(['prior_lightening', 'maintenance_tolerance'])
  })

  it('states the caps the grammar cannot hold, in the description', () => {
    const schema = buildConsultFollowUpOutputSchema(VOCABULARY)
    const questions = (schema.properties as Record<string, Record<string, unknown>>)
      .questions!
    expect(String(questions.description)).toContain(
      String(CONSULT_FOLLOW_UP_MAX_QUESTIONS),
    )
    const defs = schema.$defs as Record<string, Record<string, unknown>>
    expect(
      String(
        (defs.question!.properties as Record<string, Record<string, unknown>>).options!
          .description,
      ),
    ).toContain(String(CONSULT_FOLLOW_UP_MAX_OPTIONS))
  })

  it('never carries a free-text field the payload could not hold', () => {
    const schema = buildConsultFollowUpOutputSchema(VOCABULARY)
    expect(JSON.stringify(schema)).not.toContain('"notes"')
    expect(schema.additionalProperties).toBe(false)
  })
})
