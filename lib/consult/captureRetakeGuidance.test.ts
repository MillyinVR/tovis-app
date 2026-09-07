import { describe, expect, it } from 'vitest'

import { consultSlotRetakeGuidance } from './captureRetakeGuidance'

const base = {
  qualityReasonCode: 'TOO_DARK' as const,
  previousReasonCode: null,
  retakeTip: 'Move somewhere brighter.',
  attemptCount: 1,
}

describe('consultSlotRetakeGuidance', () => {
  it('says nothing extra on a first refusal — the tip is the whole message', () => {
    expect(consultSlotRetakeGuidance(base)).toEqual({
      attemptLabel: null,
      repeatedLine: null,
      nextStep: 'Move somewhere brighter.',
    })
  })

  it('numbers the attempt and names the repeat when the SAME finding recurs', () => {
    const guidance = consultSlotRetakeGuidance({
      ...base,
      previousReasonCode: 'TOO_DARK',
      attemptCount: 2,
    })
    expect(guidance.attemptLabel).toBe('Attempt 2')
    expect(guidance.repeatedLine).toBe('This one’s dark too.')
  })

  it('gives a DIFFERENT next step on a repeat, not the model tip again', () => {
    const guidance = consultSlotRetakeGuidance({
      ...base,
      previousReasonCode: 'TOO_DARK',
      attemptCount: 2,
    })
    expect(guidance.nextStep).not.toBe(base.retakeTip)
    expect(guidance.nextStep).toBe(
      'Try turning on more light, or moving to a brighter room.',
    )
  })

  it('does NOT say "too" when the finding changed — that is progress', () => {
    const guidance = consultSlotRetakeGuidance({
      ...base,
      qualityReasonCode: 'BLURRY',
      previousReasonCode: 'TOO_DARK',
      attemptCount: 2,
    })
    expect(guidance.repeatedLine).toBeNull()
    // ...and the model's own tip stands, because it looked at THIS frame.
    expect(guidance.nextStep).toBe('Move somewhere brighter.')
    // The count still shows: she has been here twice, whatever the reason.
    expect(guidance.attemptLabel).toBe('Attempt 2')
  })

  it('keeps counting past two', () => {
    expect(
      consultSlotRetakeGuidance({
        ...base,
        previousReasonCode: 'TOO_DARK',
        attemptCount: 4,
      }).attemptLabel,
    ).toBe('Attempt 4')
  })

  it('never claims a repeat of PASS', () => {
    expect(
      consultSlotRetakeGuidance({
        qualityReasonCode: 'PASS',
        previousReasonCode: 'PASS',
        retakeTip: null,
        attemptCount: 3,
      }).repeatedLine,
    ).toBeNull()
  })

  it('falls back to the model tip when a repeat has no escalated lever', () => {
    expect(
      consultSlotRetakeGuidance({
        qualityReasonCode: 'PASS',
        previousReasonCode: 'PASS',
        retakeTip: 'a tip',
        attemptCount: 2,
      }).nextStep,
    ).toBe('a tip')
  })
})
