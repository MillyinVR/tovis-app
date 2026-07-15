import { NotificationEventKey } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  RE_ENGAGEMENT_BUDGET_WINDOW_DAYS,
  RE_ENGAGEMENT_EVENT_KEYS,
  RE_ENGAGEMENT_TRIGGER_PRIORITY,
  RE_ENGAGEMENT_WEEKLY_CAP,
  allocateBudgetToCandidates,
  isReEngagementEventKey,
  pickHighestPriorityCandidate,
  reEngagementBudgetWindowStart,
  reEngagementTriggerForEventKey,
  resolveReEngagementBudget,
  sortByTriggerPriority,
  type ReEngagementTrigger,
} from './reEngagementBudget'

describe('reEngagementBudget — taxonomy', () => {
  it('maps only shipped event keys to a trigger', () => {
    expect(
      reEngagementTriggerForEventKey(
        NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
      ),
    ).toBe('AVAILABILITY_OPENED_ON_SAVE')
    expect(isReEngagementEventKey(NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED)).toBe(
      true,
    )
    // §8 event countdown — the top-priority trigger (its emitter is live).
    expect(
      reEngagementTriggerForEventKey(NotificationEventKey.EVENT_DATE_COUNTDOWN),
    ).toBe('EVENT_COUNTDOWN')
    expect(isReEngagementEventKey(NotificationEventKey.EVENT_DATE_COUNTDOWN)).toBe(
      true,
    )
    // §6.7 cadence rebook prompt — the third pooled trigger (its emitter is live).
    expect(
      reEngagementTriggerForEventKey(NotificationEventKey.REBOOK_CADENCE_DUE),
    ).toBe('REBOOK_CADENCE')
    expect(isReEngagementEventKey(NotificationEventKey.REBOOK_CADENCE_DUE)).toBe(
      true,
    )
    // §6.8 hesitation consult nudge — the fourth pooled trigger (its emitter is live).
    expect(
      reEngagementTriggerForEventKey(NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE),
    ).toBe('HESITATION_CONSULT')
    expect(
      isReEngagementEventKey(NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE),
    ).toBe(true)
  })

  it('counts the event-countdown key toward the pooled budget', () => {
    expect(RE_ENGAGEMENT_EVENT_KEYS).toContain(
      NotificationEventKey.EVENT_DATE_COUNTDOWN,
    )
  })

  it('does not treat transactional / social events as re-engagement', () => {
    for (const key of [
      NotificationEventKey.BOOKING_CONFIRMED,
      NotificationEventKey.PAYMENT_COLLECTED,
      NotificationEventKey.MESSAGE_RECEIVED,
      NotificationEventKey.LOOK_SAVED,
      NotificationEventKey.APPOINTMENT_REMINDER,
    ]) {
      expect(isReEngagementEventKey(key)).toBe(false)
      expect(reEngagementTriggerForEventKey(key)).toBeNull()
    }
  })

  it('exposes the budgeted keys derived from the trigger map', () => {
    expect(RE_ENGAGEMENT_EVENT_KEYS).toContain(
      NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    )
    // Every listed key must round-trip through the trigger map.
    for (const key of RE_ENGAGEMENT_EVENT_KEYS) {
      expect(reEngagementTriggerForEventKey(key)).not.toBeNull()
    }
  })

  it('orders priority per spec §8.1: countdown > availability > rebook > rest', () => {
    const p = RE_ENGAGEMENT_TRIGGER_PRIORITY
    expect(p.EVENT_COUNTDOWN).toBeLessThan(p.AVAILABILITY_OPENED_ON_SAVE)
    expect(p.AVAILABILITY_OPENED_ON_SAVE).toBeLessThan(p.REBOOK_CADENCE)
    // Hesitation consult (a clockless conversion nudge) sits below the three
    // time-sensitive triggers but above the post-event archive housekeeping.
    expect(p.REBOOK_CADENCE).toBeLessThan(p.HESITATION_CONSULT)
    expect(p.HESITATION_CONSULT).toBeLessThan(p.BOARD_ARCHIVE)
    expect(p.BOARD_ARCHIVE).toBeLessThan(p.OTHER)
  })
})

describe('reEngagementBudget — window', () => {
  it('computes the trailing window start from now', () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    const start = reEngagementBudgetWindowStart(now)
    expect(now.getTime() - start.getTime()).toBe(
      RE_ENGAGEMENT_BUDGET_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
    // 7 days earlier.
    expect(start.toISOString()).toBe('2026-07-08T12:00:00.000Z')
  })
})

describe('reEngagementBudget — cap arithmetic', () => {
  it('allows sends under the cap and reports remaining after this one', () => {
    const decision = resolveReEngagementBudget({ recentSendCount: 0 })
    expect(decision.allowed).toBe(true)
    expect(decision.cap).toBe(RE_ENGAGEMENT_WEEKLY_CAP)
    expect(decision.remaining).toBe(RE_ENGAGEMENT_WEEKLY_CAP - 1)
    expect(decision.reason).toBeNull()
  })

  it('blocks at exactly the cap (boundary)', () => {
    const decision = resolveReEngagementBudget({
      recentSendCount: RE_ENGAGEMENT_WEEKLY_CAP,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.remaining).toBe(0)
    expect(decision.reason).toBe('AT_CAP')
  })

  it('allows the last slot (cap - 1 already sent)', () => {
    const decision = resolveReEngagementBudget({
      recentSendCount: RE_ENGAGEMENT_WEEKLY_CAP - 1,
    })
    expect(decision.allowed).toBe(true)
    expect(decision.remaining).toBe(0)
  })

  it('honors a custom cap and clamps negative / fractional inputs', () => {
    expect(resolveReEngagementBudget({ recentSendCount: 1, cap: 1 }).allowed).toBe(
      false,
    )
    expect(
      resolveReEngagementBudget({ recentSendCount: -5, cap: 2 }).allowed,
    ).toBe(true)
    expect(
      resolveReEngagementBudget({ recentSendCount: 1.9, cap: 2 }).allowed,
    ).toBe(true)
  })
})

describe('reEngagementBudget — priority selection', () => {
  const mk = (trigger: ReEngagementTrigger, id: string) => ({ trigger, id })

  it('sorts highest priority first, stable within a tier', () => {
    const sorted = sortByTriggerPriority([
      mk('OTHER', 'a'),
      mk('AVAILABILITY_OPENED_ON_SAVE', 'b'),
      mk('EVENT_COUNTDOWN', 'c'),
      mk('AVAILABILITY_OPENED_ON_SAVE', 'd'),
    ])
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('picks the single highest-priority candidate', () => {
    expect(
      pickHighestPriorityCandidate([
        mk('REBOOK_CADENCE', 'a'),
        mk('EVENT_COUNTDOWN', 'b'),
      ])?.id,
    ).toBe('b')
    expect(pickHighestPriorityCandidate([])).toBeNull()
  })
})

describe('reEngagementBudget — in-run allocation', () => {
  const mk = (trigger: ReEngagementTrigger, id: string) => ({ trigger, id })

  it('grants up to the cap, dropping the lowest priority when over', () => {
    const { granted, denied } = allocateBudgetToCandidates({
      candidates: [
        mk('OTHER', 'low'),
        mk('EVENT_COUNTDOWN', 'top'),
        mk('AVAILABILITY_OPENED_ON_SAVE', 'mid'),
        mk('BOARD_ARCHIVE', 'archive'),
      ],
      alreadySent: 0,
      cap: 3,
    })
    expect(granted.map((c) => c.id)).toEqual(['top', 'mid', 'archive'])
    expect(denied.map((c) => c.id)).toEqual(['low'])
  })

  it('accounts for sends already made this window', () => {
    const { granted, denied } = allocateBudgetToCandidates({
      candidates: [
        mk('AVAILABILITY_OPENED_ON_SAVE', 'x'),
        mk('AVAILABILITY_OPENED_ON_SAVE', 'y'),
      ],
      alreadySent: 2,
      cap: 3,
    })
    expect(granted.map((c) => c.id)).toEqual(['x'])
    expect(denied.map((c) => c.id)).toEqual(['y'])
  })

  it('grants nothing when already at cap', () => {
    const { granted, denied } = allocateBudgetToCandidates({
      candidates: [mk('EVENT_COUNTDOWN', 'x')],
      alreadySent: 3,
      cap: 3,
    })
    expect(granted).toHaveLength(0)
    expect(denied.map((c) => c.id)).toEqual(['x'])
  })
})
