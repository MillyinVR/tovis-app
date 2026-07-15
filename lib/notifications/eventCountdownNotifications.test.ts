import { BoardType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  allocateEventCountdowns,
  buildEventCountdownDedupeKey,
  composeEventCountdownCopy,
  daysUntilEventDate,
  resolveCountdownMilestone,
  selectEventCountdownCandidates,
  type DatedBoardRow,
  type EventCountdownCandidate,
} from './eventCountdownNotifications'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-15T12:00:00.000Z')

/** A UTC-midnight @db.Date value `days` out from NOW. */
function eventDate(days: number): Date {
  const d = new Date(NOW.getTime() + days * DAY_MS)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function board(overrides: Partial<DatedBoardRow>): DatedBoardRow {
  return {
    boardId: 'board-1',
    clientId: 'client-1',
    boardType: BoardType.PROM,
    eventDate: eventDate(14),
    ...overrides,
  }
}

describe('daysUntilEventDate', () => {
  it('counts whole UTC days regardless of time-of-day', () => {
    expect(daysUntilEventDate(eventDate(14), NOW)).toBe(14)
    // Same event date, but "now" late in the day — still 14 (floored to UTC days).
    const lateNow = new Date('2026-07-15T23:30:00.000Z')
    expect(daysUntilEventDate(eventDate(14), lateNow)).toBe(14)
  })

  it('is negative once the event has passed', () => {
    expect(daysUntilEventDate(eventDate(-2), NOW)).toBe(-2)
  })
})

describe('resolveCountdownMilestone', () => {
  it('maps each day-count to the tightest crossed milestone', () => {
    expect(resolveCountdownMilestone(31)).toBeNull() // beyond furthest window
    expect(resolveCountdownMilestone(30)).toBe(30)
    expect(resolveCountdownMilestone(18)).toBe(30) // "18 days until prom"
    expect(resolveCountdownMilestone(14)).toBe(14)
    expect(resolveCountdownMilestone(8)).toBe(14)
    expect(resolveCountdownMilestone(7)).toBe(7)
    expect(resolveCountdownMilestone(4)).toBe(7)
    expect(resolveCountdownMilestone(3)).toBe(3)
    expect(resolveCountdownMilestone(1)).toBe(3)
  })

  it('never fires day-of or after the event', () => {
    expect(resolveCountdownMilestone(0)).toBeNull()
    expect(resolveCountdownMilestone(-5)).toBeNull()
  })
})

describe('buildEventCountdownDedupeKey', () => {
  it('is stable per (board, milestone) and distinct across milestones', () => {
    const a = buildEventCountdownDedupeKey({ boardId: 'b', milestone: 14 })
    expect(a).toBe('event-countdown:b:14')
    expect(buildEventCountdownDedupeKey({ boardId: 'b', milestone: 14 })).toBe(a)
    expect(buildEventCountdownDedupeKey({ boardId: 'b', milestone: 7 })).not.toBe(a)
    expect(buildEventCountdownDedupeKey({ boardId: 'c', milestone: 14 })).not.toBe(a)
  })
})

describe('selectEventCountdownCandidates', () => {
  it('produces one candidate per in-window board with its milestone', () => {
    const candidates = selectEventCountdownCandidates({
      boards: [board({ eventDate: eventDate(14) })],
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.milestone).toBe(14)
    expect(candidates[0]?.daysUntil).toBe(14)
    expect(candidates[0]?.trigger).toBe('EVENT_COUNTDOWN')
    expect(candidates[0]?.dedupeKey).toBe('event-countdown:board-1:14')
  })

  it('drops boards outside every milestone window (too far / day-of / past)', () => {
    const candidates = selectEventCountdownCandidates({
      boards: [
        board({ boardId: 'far', eventDate: eventDate(45) }),
        board({ boardId: 'today', eventDate: eventDate(0) }),
        board({ boardId: 'past', eventDate: eventDate(-3) }),
      ],
      alreadyNotifiedDedupeKeys: new Set(),
      now: NOW,
    })
    expect(candidates).toHaveLength(0)
  })

  it('excludes a board already nudged for its current milestone', () => {
    const candidates = selectEventCountdownCandidates({
      boards: [board({ eventDate: eventDate(7) })],
      alreadyNotifiedDedupeKeys: new Set(['event-countdown:board-1:7']),
      now: NOW,
    })
    expect(candidates).toHaveLength(0)
  })

  it('still nudges a later milestone the board has not been sent yet', () => {
    // Board is 7 days out (milestone 7); it was nudged at 14 but not at 7.
    const candidates = selectEventCountdownCandidates({
      boards: [board({ eventDate: eventDate(7) })],
      alreadyNotifiedDedupeKeys: new Set(['event-countdown:board-1:14']),
      now: NOW,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.milestone).toBe(7)
  })
})

describe('allocateEventCountdowns', () => {
  function candidate(
    clientId: string,
    boardId: string,
    daysUntil: number,
  ): EventCountdownCandidate {
    return {
      clientId,
      boardId,
      boardType: BoardType.BRIDAL,
      eventDate: eventDate(daysUntil),
      daysUntil,
      milestone: resolveCountdownMilestone(daysUntil) ?? 30,
      dedupeKey: `event-countdown:${boardId}:x`,
      trigger: 'EVENT_COUNTDOWN',
    }
  }

  it('caps per client by the pooled weekly budget, soonest event first', () => {
    const result = allocateEventCountdowns({
      candidates: [
        candidate('c1', 'bA', 14),
        candidate('c1', 'bB', 3),
        candidate('c1', 'bC', 7),
        candidate('c1', 'bD', 10),
      ],
      sentCountByClient: new Map(),
      mutedClients: new Set(),
      cap: 3,
    })
    // cap 3 → 3 granted, soonest (3 days, bB) first, 1 blocked.
    expect(result.granted).toHaveLength(3)
    expect(result.granted[0]?.boardId).toBe('bB')
    expect(result.budgetBlocked).toBe(1)
  })

  it('accounts for pooled sends already made this window', () => {
    const result = allocateEventCountdowns({
      candidates: [candidate('c1', 'bA', 3), candidate('c1', 'bB', 7)],
      sentCountByClient: new Map([['c1', 2]]),
      mutedClients: new Set(),
      cap: 3,
    })
    expect(result.granted).toHaveLength(1)
    expect(result.budgetBlocked).toBe(1)
  })

  it('drops muted recipients before spending budget and counts opt-outs', () => {
    const result = allocateEventCountdowns({
      candidates: [candidate('c-muted', 'bA', 5), candidate('c-ok', 'bB', 5)],
      sentCountByClient: new Map(),
      mutedClients: new Set(['c-muted']),
      cap: 3,
    })
    expect(result.granted.map((c) => c.clientId)).toEqual(['c-ok'])
    expect(result.mutedOptOut).toBe(1)
    expect(result.budgetBlocked).toBe(0)
  })
})

describe('composeEventCountdownCopy', () => {
  it('is white-label safe, non-urgent, and carries the milestone payload', () => {
    const copy = composeEventCountdownCopy({
      candidate: {
        boardId: 'board-9',
        boardType: BoardType.PROM,
        eventDate: eventDate(18),
        daysUntil: 18,
        milestone: 30,
      },
    })
    expect(copy.title).toBe('18 days until prom')
    expect(copy.body).not.toMatch(/hurry|last chance|now or never|act fast/i)
    expect(copy.href).toBe('/client/boards/board-9')
    expect(copy.data.trigger).toBe('EVENT_COUNTDOWN')
    expect(copy.data.boardId).toBe('board-9')
    expect(copy.data.milestone).toBe('30')
    expect(copy.data.daysUntil).toBe('18')
    // The @db.Date is serialized as a plain YYYY-MM-DD, never a localized string.
    expect(copy.data.eventDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('uses the wedding noun for bridal boards', () => {
    const copy = composeEventCountdownCopy({
      candidate: {
        boardId: 'b',
        boardType: BoardType.BRIDAL,
        eventDate: eventDate(7),
        daysUntil: 7,
        milestone: 7,
      },
    })
    expect(copy.title).toBe('7 days until your wedding')
  })

  it('renders a singular day and a generic noun fallback', () => {
    const copy = composeEventCountdownCopy({
      candidate: {
        boardId: 'b',
        boardType: BoardType.NAILS,
        eventDate: eventDate(1),
        daysUntil: 1,
        milestone: 3,
      },
    })
    expect(copy.title).toBe('1 day until your event')
    expect(copy.body).toContain('event is coming up')
  })
})
