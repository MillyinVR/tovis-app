// lib/booking/holdOverlapPrompt.test.ts

import { describe, expect, it } from 'vitest'

import {
  HELD_SLOT_RELATIONSHIPS,
  HOLD_OVERLAP_DECISION_CODE,
  holdOverlapPromptCopy,
  parseHeldSlotDecision,
  readHoldOverlapDecision,
  type HeldSlotDecision,
} from './holdOverlapPrompt'

const decision: HeldSlotDecision = {
  holdId: 'hold_1',
  relationship: 'RETURNING',
  serviceName: 'Signature Manicure',
  startsAt: '2026-09-01T19:00:00.000Z',
  endsAt: '2026-09-01T20:15:00.000Z',
  expiresAt: '2026-09-01T18:40:00.000Z',
  additionalHeldSlots: 0,
}

describe('parseHeldSlotDecision', () => {
  it('accepts a well-formed payload', () => {
    expect(parseHeldSlotDecision({ ...decision })).toEqual(decision)
  })

  // A popup that renders half a fact — "A client is booking  for " — is worse
  // than the plain refusal it replaced, so a missing or unusable field takes
  // the caller back to its ordinary error path rather than degrading.
  it.each([
    ['holdId', ''],
    ['serviceName', '   '],
    ['startsAt', 'not-a-date'],
    ['endsAt', 'not-a-date'],
    ['expiresAt', 'not-a-date'],
    ['relationship', 'MAYBE'],
  ])('rejects an unusable %s', (field, value) => {
    expect(parseHeldSlotDecision({ ...decision, [field]: value })).toBeNull()
  })

  it.each([['holdId'], ['serviceName'], ['expiresAt'], ['relationship']])(
    'rejects a missing %s',
    (field) => {
      const partial: Record<string, unknown> = { ...decision }
      delete partial[field]
      expect(parseHeldSlotDecision(partial)).toBeNull()
    },
  )

  it('rejects a non-object', () => {
    expect(parseHeldSlotDecision(null)).toBeNull()
    expect(parseHeldSlotDecision('hold')).toBeNull()
  })

  it.each(HELD_SLOT_RELATIONSHIPS)('accepts the %s label', (relationship) => {
    expect(parseHeldSlotDecision({ ...decision, relationship })?.relationship).toBe(
      relationship,
    )
  })

  // Not a hard failure: the count is a nicety, and a server that omits it (or
  // sends nonsense) should still get the popup, just without the extra line.
  it.each([[undefined], [-3], [Number.NaN], ['two']])(
    'floors an unusable additionalHeldSlots (%s) to zero',
    (additionalHeldSlots) => {
      expect(
        parseHeldSlotDecision({ ...decision, additionalHeldSlots })
          ?.additionalHeldSlots,
      ).toBe(0)
    },
  )

  it('truncates a fractional additionalHeldSlots rather than rounding up', () => {
    expect(
      parseHeldSlotDecision({ ...decision, additionalHeldSlots: 2.9 })
        ?.additionalHeldSlots,
    ).toBe(2)
  })

  // 🔴 The parser is also a leak guard on the way IN: whatever the server sent,
  // only the seven known fields survive into the object a component renders.
  it('drops any extra field a payload carries', () => {
    const parsed = parseHeldSlotDecision({
      ...decision,
      clientName: 'Marguerite Okonkwo',
      clientId: 'client_1',
      email: 'marguerite@example.com',
    })

    expect(parsed).toEqual(decision)
    expect(JSON.stringify(parsed)).not.toContain('Marguerite')
  })
})

describe('readHoldOverlapDecision', () => {
  it('reads the decision off the failure body', () => {
    expect(
      readHoldOverlapDecision({
        ok: false,
        error: 'A client is checking out for this time right now.',
        code: HOLD_OVERLAP_DECISION_CODE,
        heldSlot: decision,
      }),
    ).toEqual(decision)
  })

  // Every other booking failure keeps its ordinary handling — the popup must
  // not hijack a TIME_BOOKED that happens to carry a stray key.
  it('ignores a body with a different code', () => {
    expect(
      readHoldOverlapDecision({
        ok: false,
        code: 'TIME_BOOKED',
        heldSlot: decision,
      }),
    ).toBeNull()
  })

  it('ignores the right code with no payload', () => {
    expect(
      readHoldOverlapDecision({ ok: false, code: HOLD_OVERLAP_DECISION_CODE }),
    ).toBeNull()
  })
})

describe('holdOverlapPromptCopy', () => {
  it.each([
    ['NEW' as const, 'A new client is booking'],
    ['RETURNING' as const, 'A returning client is booking'],
    // Says only what is true — a hold with no client is not "new".
    ['UNKNOWN' as const, 'A client is booking'],
  ])('leads with the %s label', (relationship, leadIn) => {
    expect(holdOverlapPromptCopy(relationship, 'create').leadIn).toBe(leadIn)
  })

  it('changes only the action wording between create and reschedule', () => {
    const create = holdOverlapPromptCopy('NEW', 'create')
    const edit = holdOverlapPromptCopy('NEW', 'edit')

    expect(create.proceedLabel).not.toBe(edit.proceedLabel)
    expect(create.leadIn).toBe(edit.leadIn)
    expect(create.countdownSuffix).toBe(edit.countdownSuffix)
  })

  it('pluralizes the extra-holds note', () => {
    const copy = holdOverlapPromptCopy('NEW', 'create')

    expect(copy.additionalHeldSlotsNote(1)).toContain('One more client')
    expect(copy.additionalHeldSlotsNote(3)).toContain('3 more clients')
  })

  // 🔴 No copy path may name anybody: the only variable in the sentence is the
  // relationship label.
  it.each(HELD_SLOT_RELATIONSHIPS)(
    'never names a client in the %s copy',
    (relationship) => {
      const copy = holdOverlapPromptCopy(relationship, 'create')

      expect(copy.leadIn).toMatch(/^A (new |returning )?client is booking$/)
    },
  )
})
