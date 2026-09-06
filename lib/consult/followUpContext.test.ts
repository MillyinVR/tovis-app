// lib/consult/followUpContext.test.ts
//
// P5g — what the model is TOLD.
//
// 🔴 This file exists because of a defect the live model produced on the first
// real call: it was handed `lightestLevel:LEVEL_9` and quoted it back in a
// sentence written for a client to read. Three layers now stop that, and this
// is the first — the prompt never contains a code at all.

import { describe, expect, it } from 'vitest'

import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import type { ConsultAnalysisCore } from './analysisEngine'
import type {
  ConsultAnalysisEvidenceDTO,
  ConsultInspirationAnalysisAttributesDTO,
  ConsultInspirationAnalysisObservationDTO,
} from '@/lib/dto/consult'

import {
  consultStartingPointPhrase,
  CONSULT_FOLLOW_UP_SHOT_PHRASES,
  renderConsultFollowUpContext,
} from './followUpContext'
import type { ConsultFollowUpVocabulary } from './followUpVocabulary'

function observation<const T extends string>(
  value: T,
  min: number,
  max: number,
): ConsultInspirationAnalysisObservationDTO<T> {
  return { value, confidence: { min, max }, evidence: ['inspiration'], region: null }
}

function core<const T extends string>(value: T, evidence: ConsultAnalysisEvidenceDTO[]) {
  return { value, confidence: { min: 0.45, max: 0.7 }, evidence }
}

const INSPIRATION: ConsultInspirationAnalysisAttributesDTO = {
  baseLevel: observation('LEVEL_6', 0.45, 0.7),
  lightestLevel: observation('LEVEL_9', 0.5, 0.75),
  tone: observation('COOL', 0.45, 0.7),
  technique: observation('BABYLIGHTS', 0.4, 0.65),
  placement: observation('MIDS_TO_ENDS', 0.4, 0.65),
  rootBlend: observation('SEAMLESS_MELT', 0.4, 0.65),
  finish: observation('HIGH_SHINE', 0.4, 0.6),
  dimension: observation('UNKNOWN', 0.05, 0.3),
}

const CORE: ConsultAnalysisCore = {
  baseLevel: core('LEVEL_6', ['hair_back', 'hair_crown']),
  lightestLevel: core('LEVEL_7', ['hair_left']),
  currentTone: core('GOLDEN', ['hair_back']),
  visibleCondition: core('NO_VISIBLE_CONCERN', ['face_front']),
  density: core('MEDIUM', ['hair_crown']),
  texture: core('WAVY', ['hair_left']),
}

const VOCABULARY: ConsultFollowUpVocabulary = {
  entries: [
    {
      key: 'prior_lightening',
      home: 'INTAKE',
      packLabel: 'When was your hair last lightened?',
      safety: true,
      options: [{ value: 'never', label: 'Never' }],
    },
  ],
  byKey: new Map(),
}
VOCABULARY.byKey = new Map(VOCABULARY.entries.map((e) => [e.key, e]))

function render(overrides: Partial<Parameters<typeof renderConsultFollowUpContext>[0]> = {}) {
  return renderConsultFollowUpContext({
    professionalDisplayName: 'Susie',
    serviceName: 'Signature Balayage',
    inspiration: INSPIRATION,
    core: CORE,
    preferences: {
      wants: ['lightestLevel:LEVEL_9', 'tone:COOL'],
      avoids: ['baseLevel:LEVEL_6'],
      unsure: [],
      keep: ['My length'],
    },
    intakeAnswers: { change_scale: 'noticeable' },
    followUpAnswers: {},
    vocabulary: VOCABULARY,
    copy: defaultClientConsultInspirationCopy,
    roundNumber: 1,
    maxRounds: 3,
    ...overrides,
  })
}

describe('the follow-up context', () => {
  it('🔴 states what she tapped in WORDS, never as an attribute:VALUE code', () => {
    const context = render()
    // The exact string the live model quoted back into a client-facing
    // question on the first real call.
    expect(context).not.toContain('lightestLevel:LEVEL_9')
    expect(context).not.toContain('tone:COOL')
    expect(context).not.toContain('baseLevel:LEVEL_6')
    // What it says instead — the reading, in the words the client's own cards
    // use for it.
    expect(context).toContain('how light it gets: light blonde')
    expect(context).toContain('the warmth of it: cool, silvery cast')
    expect(context).toContain('where the color starts: light brown')
  })

  it('🔴 names her photographs the way she may be told about them', () => {
    const context = render()
    // A reading cites `hair_back`; a question may say "the photo of the back of
    // your hair". The KEY never reaches the prompt — and neither do the two
    // shot names that name a part of a person, which the identity rule refuses
    // outright.
    expect(context).toContain('the photo of the back of your hair')
    expect(context).not.toContain('hair_back')
    expect(context).not.toContain('face_front')
    expect(CONSULT_FOLLOW_UP_SHOT_PHRASES.face_front).not.toMatch(/\bface\b/i)
    expect(CONSULT_FOLLOW_UP_SHOT_PHRASES.eyes_closeup).not.toMatch(/\beyes?\b/i)
  })

  it('states UNKNOWN rather than omitting it', () => {
    // A reading the model is not told about is one it can quietly invent; one
    // it is told is UNKNOWN is one Part 0 rule 8 forbids it to lean on.
    expect(render()).toContain('dimension: UNKNOWN')
    expect(render()).toContain('must not refer to it')
  })

  it('says plainly when there is nothing to describe', () => {
    const blank = render({ inspiration: null, core: null, preferences: null })
    expect(blank).toContain('has not been read')
    expect(blank).toContain('has not been read yet')
    expect(blank).toContain('has not pointed at anything')
  })

  it('lists what she already answered, so it cannot be asked again', () => {
    const context = render({
      intakeAnswers: { change_scale: 'noticeable', prior_reaction: 'no' },
      followUpAnswers: { budget: ['under-150'] },
    })
    expect(context).toContain('NEVER ask any of these again')
    expect(context).toContain('- prior_reaction: no')
    expect(context).toContain('- budget: under-150')
  })

  it('marks the safety questions so they are asked first', () => {
    expect(render()).toContain('[SAFETY — ask before anything else]')
  })

  it('🔴 gives ONE starting-point phrase, and the same one every round', () => {
    // Left to the model, round 1 said "your current light brown base" and round
    // 2 said "a golden base" about the same head of hair (Tori, 2026-09-06).
    // It is composed here, from the plan, so every round of a plan version gets
    // a byte-identical phrase.
    const phrase = consultStartingPointPhrase(CORE, defaultClientConsultInspirationCopy)
    expect(phrase).toBe('your light brown, golden base')
    for (const round of [1, 2, 3]) {
      const context = render({ roundNumber: round })
      expect(context).toContain('"your light brown, golden base"')
      expect(context).toContain('use that phrase EXACTLY as written')
    }
  })

  it('falls back to whichever half the plan settled, and says nothing when neither', () => {
    const toneOnly = { ...CORE, baseLevel: core('UNKNOWN', ['hair_back']) }
    expect(
      consultStartingPointPhrase(toneOnly, defaultClientConsultInspirationCopy),
    ).toBe('your golden base')
    const levelOnly = { ...CORE, currentTone: core('UNKNOWN', ['hair_back']) }
    expect(
      consultStartingPointPhrase(levelOnly, defaultClientConsultInspirationCopy),
    ).toBe('your light brown base')
    const neither = {
      ...CORE,
      baseLevel: core('UNKNOWN', ['hair_back']),
      currentTone: core('UNKNOWN', ['hair_back']),
    }
    // 🔴 Null, not a half-sentence. There is nothing honest to call her
    // starting point, and the prompt is told so rather than being handed
    // something to finish.
    expect(
      consultStartingPointPhrase(neither, defaultClientConsultInspirationCopy),
    ).toBeNull()
    expect(render({ core: neither })).toContain('Do not invent a description of it')
  })

  it('🔴 asks in US English', () => {
    // The model answered "colour" because the prompt asked in British English.
    const context = render()
    expect(context).not.toMatch(/\bcolour(ist)?\b/i)
    expect(context).toContain('as a colorist read it')
  })

  it('says which round it is, so the model can stop', () => {
    expect(render({ roundNumber: 3 })).toContain('This is round 3 of at most 3')
  })
})
