// lib/notifications/reEngagementDispatcher.test.ts
//
// Pure-core coverage for the §8.1 unified dispatcher's global-priority allocator.
// The capstone guarantee cron-ordering could not make: when several triggers
// compete for a client's last pooled slot, the HIGHEST-priority one wins — even if a
// lower-priority candidate appeared first in the input.

import { describe, expect, it } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

import {
  type ReEngagementDispatchCandidate,
  allocateReEngagementDispatch,
} from './reEngagementDispatcher'

const COPY = { title: 't', body: 'b', href: '/h', data: {} }

function countdown(
  clientId: string,
  tierRank: number,
  dedupeKey = `cd:${clientId}:${tierRank}`,
): ReEngagementDispatchCandidate {
  return {
    clientId,
    trigger: 'EVENT_COUNTDOWN',
    eventKey: NotificationEventKey.EVENT_DATE_COUNTDOWN,
    dedupeKey,
    tierRank,
    copy: COPY,
  }
}

function saved(
  clientId: string,
  tierRank: number,
  dedupeKey = `sv:${clientId}:${tierRank}`,
): ReEngagementDispatchCandidate {
  return {
    clientId,
    trigger: 'AVAILABILITY_OPENED_ON_SAVE',
    eventKey: NotificationEventKey.SAVED_LOOK_AVAILABILITY_OPENED,
    dedupeKey,
    tierRank,
    copy: COPY,
  }
}

function rebook(
  clientId: string,
  tierRank: number,
  dedupeKey = `rb:${clientId}:${tierRank}`,
): ReEngagementDispatchCandidate {
  return {
    clientId,
    trigger: 'REBOOK_CADENCE',
    eventKey: NotificationEventKey.REBOOK_CADENCE_DUE,
    dedupeKey,
    tierRank,
    copy: COPY,
  }
}

function consult(
  clientId: string,
  tierRank: number,
  dedupeKey = `co:${clientId}:${tierRank}`,
): ReEngagementDispatchCandidate {
  return {
    clientId,
    trigger: 'HESITATION_CONSULT',
    eventKey: NotificationEventKey.SAVED_LOOK_CONSULT_NUDGE,
    dedupeKey,
    tierRank,
    copy: COPY,
  }
}

function mutedMap(
  entries: Array<[NotificationEventKey, string[]]>,
): Map<NotificationEventKey, ReadonlySet<string>> {
  return new Map(entries.map(([key, ids]) => [key, new Set(ids)]))
}

describe('allocateReEngagementDispatch', () => {
  it('grants the higher-priority trigger the last slot even when it was found LAST', () => {
    // One slot; rebook listed first, countdown second. Cron ordering could send the
    // rebook first; the global allocator must not.
    const result = allocateReEngagementDispatch({
      candidates: [rebook('c1', 0), countdown('c1', 0)],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: new Map(),
      cap: 1,
    })

    expect(result.granted).toHaveLength(1)
    expect(result.granted[0]!.trigger).toBe('EVENT_COUNTDOWN')
    expect(result.grantedByTrigger.EVENT_COUNTDOWN).toBe(1)
    expect(result.budgetBlocked).toBe(1)
    expect(result.budgetBlockedByTrigger.REBOOK_CADENCE).toBe(1)
  })

  it('spends the whole ladder in priority order when the budget allows', () => {
    // Fresh client, cap 3, one candidate per trigger → all three sent, ordered
    // countdown > availability > rebook.
    const result = allocateReEngagementDispatch({
      candidates: [rebook('c1', 0), saved('c1', 100), countdown('c1', 5)],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: new Map(),
      cap: 3,
    })

    expect(result.granted.map((g) => g.trigger)).toEqual([
      'EVENT_COUNTDOWN',
      'AVAILABILITY_OPENED_ON_SAVE',
      'REBOOK_CADENCE',
    ])
    expect(result.budgetBlocked).toBe(0)
  })

  it('ranks the hesitation consult below all three time-sensitive triggers', () => {
    // Fresh client, cap 4, one candidate per trigger → all four sent, consult last.
    const result = allocateReEngagementDispatch({
      candidates: [
        consult('c1', 0),
        rebook('c1', 0),
        countdown('c1', 5),
        saved('c1', 100),
      ],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: new Map(),
      cap: 4,
    })

    expect(result.granted.map((g) => g.trigger)).toEqual([
      'EVENT_COUNTDOWN',
      'AVAILABILITY_OPENED_ON_SAVE',
      'REBOOK_CADENCE',
      'HESITATION_CONSULT',
    ])
    expect(result.budgetBlocked).toBe(0)
  })

  it('yields the last pooled slot from a hesitation consult to a rebook', () => {
    // One slot; the clockless consult must lose to the higher-priority rebook.
    const result = allocateReEngagementDispatch({
      candidates: [consult('c1', 0), rebook('c1', 0)],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: new Map(),
      cap: 1,
    })

    expect(result.granted).toHaveLength(1)
    expect(result.granted[0]!.trigger).toBe('REBOOK_CADENCE')
    expect(result.budgetBlockedByTrigger.HESITATION_CONSULT).toBe(1)
  })

  it('honors the pooled already-sent count across triggers', () => {
    // 1 already sent this window, cap 3 → 2 slots. Priority keeps countdown + saved,
    // drops the rebook.
    const result = allocateReEngagementDispatch({
      candidates: [rebook('c1', 0), saved('c1', 100), countdown('c1', 5)],
      sentCountByClient: new Map([['c1', 1]]),
      mutedClientsByEventKey: new Map(),
      cap: 3,
    })

    expect(result.granted.map((g) => g.trigger)).toEqual([
      'EVENT_COUNTDOWN',
      'AVAILABILITY_OPENED_ON_SAVE',
    ])
    expect(result.budgetBlocked).toBe(1)
    expect(result.budgetBlockedByTrigger.REBOOK_CADENCE).toBe(1)
  })

  it('breaks ties within a trigger tier by urgency (lower tierRank wins)', () => {
    const result = allocateReEngagementDispatch({
      candidates: [countdown('c1', 30, 'far'), countdown('c1', 3, 'soon')],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: new Map(),
      cap: 1,
    })

    expect(result.granted).toHaveLength(1)
    expect(result.granted[0]!.dedupeKey).toBe('soon')
  })

  it('drops a candidate the recipient muted for THAT trigger, not the others', () => {
    // c1 muted rebook only: the rebook is an opt-out (not a budget block), the
    // countdown still sends.
    const result = allocateReEngagementDispatch({
      candidates: [countdown('c1', 5), rebook('c1', -10)],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: mutedMap([
        [NotificationEventKey.REBOOK_CADENCE_DUE, ['c1']],
      ]),
      cap: 3,
    })

    expect(result.granted.map((g) => g.trigger)).toEqual(['EVENT_COUNTDOWN'])
    expect(result.mutedOptOut).toBe(1)
    expect(result.mutedByTrigger.REBOOK_CADENCE).toBe(1)
    expect(result.budgetBlocked).toBe(0)
  })

  it('counts a fully-muted trigger as opt-out and sends nothing', () => {
    const result = allocateReEngagementDispatch({
      candidates: [countdown('c1', 5)],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: mutedMap([
        [NotificationEventKey.EVENT_DATE_COUNTDOWN, ['c1']],
      ]),
      cap: 3,
    })

    expect(result.granted).toEqual([])
    expect(result.mutedOptOut).toBe(1)
    expect(result.mutedByTrigger.EVENT_COUNTDOWN).toBe(1)
  })

  it('allocates each client an independent budget', () => {
    // c1 is already at cap; c2 is fresh. Only c2 gets its countdown.
    const result = allocateReEngagementDispatch({
      candidates: [countdown('c1', 5), countdown('c2', 5)],
      sentCountByClient: new Map([['c1', 3]]),
      mutedClientsByEventKey: new Map(),
      cap: 3,
    })

    expect(result.granted.map((g) => g.clientId)).toEqual(['c2'])
    expect(result.budgetBlocked).toBe(1)
    expect(result.budgetBlockedByTrigger.EVENT_COUNTDOWN).toBe(1)
  })

  it('returns an all-zero allocation for no candidates', () => {
    const result = allocateReEngagementDispatch({
      candidates: [],
      sentCountByClient: new Map(),
      mutedClientsByEventKey: new Map(),
    })

    expect(result.granted).toEqual([])
    expect(result.mutedOptOut).toBe(0)
    expect(result.budgetBlocked).toBe(0)
    expect(result.grantedByTrigger.EVENT_COUNTDOWN).toBe(0)
  })
})
