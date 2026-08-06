// lib/clientVisibility.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus } from '@prisma/client'

const findMany = vi.fn()
const findThread = vi.fn()
const findChartShare = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
    messageThread: {
      findFirst: (...args: unknown[]) => findThread(...args),
    },
    clientChartShare: {
      findUnique: (...args: unknown[]) => findChartShare(...args),
    },
  },
}))

import {
  RECENT_COMPLETED_WINDOW_DAYS,
  getProClientVisibility,
  getVisibleClientIdSetForPro,
  proClientVisibilityWhere,
} from './clientVisibility'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-06-21T12:00:00.000Z')

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS)
}

function daysFromNow(n: number): Date {
  return new Date(NOW.getTime() + n * DAY_MS)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  findMany.mockReset()
  // Default: no message thread. Thread-access tests override this.
  findThread.mockReset()
  findThread.mockResolvedValue(null)
  findChartShare.mockReset()
  findChartShare.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('proClientVisibilityWhere', () => {
  it('window constant is 30 days', () => {
    expect(RECENT_COMPLETED_WINDOW_DAYS).toBe(30)
  })

  it('emits exactly four OR clauses including the completed-window fallback', () => {
    const where = proClientVisibilityWhere(NOW)
    const cutoff = new Date(NOW.getTime() - 30 * DAY_MS)
    expect(where.OR).toEqual([
      { startedAt: { not: null }, finishedAt: null },
      { status: BookingStatus.PENDING },
      { status: BookingStatus.ACCEPTED, scheduledFor: { gte: NOW } },
      {
        status: BookingStatus.COMPLETED,
        OR: [
          { finishedAt: { gte: cutoff } },
          { finishedAt: null, scheduledFor: { gte: cutoff } },
        ],
      },
    ])
  })
})

describe('getProClientVisibility', () => {
  function row(over: Partial<{
    status: BookingStatus
    startedAt: Date | null
    finishedAt: Date | null
    scheduledFor: Date
  }>) {
    return {
      status: BookingStatus.COMPLETED,
      startedAt: null,
      finishedAt: null,
      scheduledFor: daysAgo(1),
      ...over,
    }
  }

  it('completed 29 days ago is visible with a RECENT_COMPLETED reason + accessUntil', async () => {
    findMany.mockResolvedValue([
      row({ status: BookingStatus.COMPLETED, finishedAt: daysAgo(29) }),
    ])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.canViewClient).toBe(true)
    expect(result.reason).toBe('RECENT_COMPLETED')
    // cutoff = finishedAt + 30 days = 1 day from now.
    expect(result.accessUntil).toEqual(daysFromNow(1))
  })

  it('completed 31 days ago is filtered out by the where clause (not visible)', async () => {
    // The DB filter excludes it, so findMany returns nothing.
    findMany.mockResolvedValue([])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.canViewClient).toBe(false)
    expect(result.canContactClient).toBe(false)
    expect(result.reason).toBe('NONE')
    expect(result.accessUntil).toBeNull()
  })

  it('cancelled bookings never count', async () => {
    // CANCELLED is not in any clause, so the DB returns no rows.
    findMany.mockResolvedValue([])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.canViewClient).toBe(false)
    expect(result.canContactClient).toBe(false)
    expect(result.reason).toBe('NONE')
    // Sanity: the where clause it queried with never references CANCELLED.
    expect(JSON.stringify(findMany.mock.calls[0]?.[0])).not.toContain('CANCELLED')
  })

  it('finishedAt: null falls back to scheduledFor for the cutoff', async () => {
    findMany.mockResolvedValue([
      row({ status: BookingStatus.COMPLETED, finishedAt: null, scheduledFor: daysAgo(10) }),
    ])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.reason).toBe('RECENT_COMPLETED')
    // accessUntil derives from scheduledFor (10 days ago) + 30 days = 20 days out.
    expect(result.accessUntil).toEqual(daysFromNow(20))
  })

  it('a pending booking re-opens access (open-ended, no countdown)', async () => {
    findMany.mockResolvedValue([
      row({ status: BookingStatus.PENDING, scheduledFor: daysFromNow(3) }),
      row({ status: BookingStatus.COMPLETED, finishedAt: daysAgo(29) }),
    ])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.canViewClient).toBe(true)
    // PENDING outranks RECENT_COMPLETED.
    expect(result.reason).toBe('PENDING_BOOKING')
    expect(result.accessUntil).toBeNull()
  })

  it('priority is deterministic: ACTIVE outranks every other reason', async () => {
    findMany.mockResolvedValue([
      row({ status: BookingStatus.COMPLETED, finishedAt: daysAgo(5) }),
      row({ status: BookingStatus.ACCEPTED, scheduledFor: daysFromNow(2) }),
      row({ status: BookingStatus.IN_PROGRESS, startedAt: daysAgo(0), finishedAt: null }),
    ])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.reason).toBe('ACTIVE_BOOKING')
    expect(result.accessUntil).toBeNull()
  })

  it('multiple recent-completed rows pick the most generous cutoff', async () => {
    findMany.mockResolvedValue([
      row({ status: BookingStatus.COMPLETED, finishedAt: daysAgo(29) }),
      row({ status: BookingStatus.COMPLETED, finishedAt: daysAgo(3) }),
    ])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.reason).toBe('RECENT_COMPLETED')
    // The 3-days-ago visit gives the later cutoff: 27 days out.
    expect(result.accessUntil).toEqual(daysFromNow(27))
  })

  // 🔴 W5 — THE headline change. This test asserted `canViewClient: true` and
  // was green through the whole defect: a bare message thread granted read AND
  // WRITE access to the client's entire chart, open-ended. Joining a waitlist
  // triggered it too, because `seedWaitlistThread` auto-creates the thread.
  it('a thread ALONE is CONTACT ONLY — it does not open the chart', async () => {
    findMany.mockResolvedValue([])
    findThread.mockResolvedValue({ id: 'thread1' })
    const result = await getProClientVisibility('pro1', 'client1')

    expect(result.canViewClient).toBe(false)
    expect(result.canContactClient).toBe(true)
    expect(result.reason).toBe('ACTIVE_THREAD')
    expect(result.accessUntil).toBeNull()
    // Scoped to this exact pro↔client pair.
    expect(findThread.mock.calls[0]?.[0]).toMatchObject({
      where: { professionalId: 'pro1', clientId: 'client1' },
    })
  })

  describe('W5 chart share', () => {
    it('a GRANTED share opens the chart with no booking at all', async () => {
      findMany.mockResolvedValue([])
      findThread.mockResolvedValue(null)
      findChartShare.mockResolvedValue({ status: 'GRANTED' })

      const result = await getProClientVisibility('pro1', 'client1')

      expect(result.canViewClient).toBe(true)
      expect(result.canContactClient).toBe(true)
      expect(result.reason).toBe('CHART_SHARE_GRANTED')
      expect(result.accessUntil).toBeNull()
      expect(findChartShare.mock.calls[0]?.[0]).toMatchObject({
        where: {
          clientId_professionalId: {
            clientId: 'client1',
            professionalId: 'pro1',
          },
        },
      })
    })

    // Every non-GRANTED status must read as "no". A pro ASKING must not be
    // enough, and a client's "no" must not be indistinguishable from silence.
    for (const status of ['REQUESTED', 'DECLINED', 'REVOKED'] as const) {
      it(`a ${status} share does NOT open the chart`, async () => {
        findMany.mockResolvedValue([])
        findThread.mockResolvedValue({ id: 'thread1' })
        findChartShare.mockResolvedValue({ status })

        const result = await getProClientVisibility('pro1', 'client1')

        expect(result.canViewClient).toBe(false)
        expect(result.reason).toBe('ACTIVE_THREAD')
      })
    }

    // Revoking must drop the pro back to contact-only, not lock them out of a
    // conversation the client is still having with them.
    it('a REVOKED share leaves the thread reachable', async () => {
      findMany.mockResolvedValue([])
      findThread.mockResolvedValue({ id: 'thread1' })
      findChartShare.mockResolvedValue({ status: 'REVOKED' })

      const result = await getProClientVisibility('pro1', 'client1')

      expect(result.canViewClient).toBe(false)
      expect(result.canContactClient).toBe(true)
    })

    // A booking is its own consent — a client who books has agreed to be
    // treated. A share is never needed to reach a client the pro is seeing.
    it('a booking wins without ever querying the share', async () => {
      findMany.mockResolvedValue([row({ status: BookingStatus.PENDING })])

      const result = await getProClientVisibility('pro1', 'client1')

      expect(result.canViewClient).toBe(true)
      expect(result.reason).toBe('PENDING_BOOKING')
      expect(findChartShare).not.toHaveBeenCalled()
    })
  })

  it('a booking takes priority over a thread (never falls through to the thread query)', async () => {
    findMany.mockResolvedValue([row({ status: BookingStatus.PENDING })])
    findThread.mockResolvedValue({ id: 'thread1' })
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.reason).toBe('PENDING_BOOKING')
    expect(findThread).not.toHaveBeenCalled()
  })

  it('no booking, no share and no thread is NONE', async () => {
    findMany.mockResolvedValue([])
    findThread.mockResolvedValue(null)
    findChartShare.mockResolvedValue(null)
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.canViewClient).toBe(false)
    expect(result.canContactClient).toBe(false)
    expect(result.reason).toBe('NONE')
  })
})

describe('getVisibleClientIdSetForPro is deliberately NARROWER than the per-client gate', () => {
  // ⚠️ These two are NOT the same policy, and making them agree is a regression,
  // not a cleanup. The batched set answers "which clients get a chart LINK in a
  // list", and is booking-based on purpose so inquiry-only contacts don't flood
  // the CRM. The per-client gate answers "may this pro open this client at all",
  // and a message thread is enough for that.
  //
  // The divergence is load-bearing for waitlist outreach: a waitlist client the
  // pro has only messaged is NOT in the batched set (so the calendar row renders
  // their name as plain text) but IS viewable, so `/pro/bookings/new?clientId=…`
  // pre-fills them. Gating the offer deep-link on the batched set would delete
  // the "message them, then offer them a time" flow.
  it('a thread-only client is viewable one-by-one but stays OUT of the batched set', async () => {
    findMany.mockResolvedValue([])
    findThread.mockResolvedValue({ id: 'thread1', clientId: 'threadOnly' })

    const single = await getProClientVisibility('pro1', 'threadOnly')
    // W5: contactable, NOT viewable. The divergence this block exists to protect
    // survives the consent change — it just moved from `canViewClient` to
    // `canContactClient`, which is the field the outreach flow actually needs.
    expect(single.canViewClient).toBe(false)
    expect(single.canContactClient).toBe(true)
    expect(single.reason).toBe('ACTIVE_THREAD')

    findThread.mockClear()
    findMany.mockResolvedValue([{ clientId: 'hasBooking' }])

    const set = await getVisibleClientIdSetForPro('pro1')
    expect(set.has('hasBooking')).toBe(true)
    expect(set.has('threadOnly')).toBe(false)
    // Not "it happens to miss threads" — it must never ask about them.
    expect(findThread).not.toHaveBeenCalled()
  })

  // ALLOW case: the batched set still returns everything the booking filter
  // matched, so narrowing it further would be just as wrong.
  it('every client with a qualifying booking is in the set', async () => {
    findMany.mockResolvedValue([
      { clientId: 'a' },
      { clientId: 'b' },
      { clientId: 'c' },
    ])
    const set = await getVisibleClientIdSetForPro('pro1')
    expect([...set].sort()).toEqual(['a', 'b', 'c'])
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { professionalId: 'pro1' },
      distinct: ['clientId'],
    })
  })
})

describe('no re-divergence of the visibility rule', () => {
  // Guard: the post-visit window must live ONLY in proClientVisibilityWhere.
  // If this fails, someone re-inlined the booking-status OR clauses instead of
  // importing proClientVisibilityWhere — consolidate it back.
  it('no other source file inlines the visibility OR clauses', () => {
    const root = join(__dirname, '..')
    const inlineClause = /startedAt:\s*\{\s*not:\s*null\s*\}/
    // Every surface that gates chart linkability (clients list, bookings list,
    // reminders) must consume a SSOT helper, never re-declare the clauses —
    // otherwise the list and the page gate can disagree (e.g. a recently
    // completed client linkable on one surface but not another).
    const ssotConsumers = [
      'app/pro/clients/page.tsx',
      'app/pro/bookings/page.tsx',
      'app/pro/reminders/page.tsx',
      // The dashboard's retention buckets name clients and link each one
      // straight to the chart (ProRetentionSection). That href is unconditional,
      // and it is only correct because THIS loader scopes its roster with the
      // SSOT predicate. Drop the import and every "slipping away" client — the
      // bucket most likely to hold someone past the post-visit window — becomes
      // a link to a refusal.
      'lib/analytics/proRetentionInsights.ts',
    ]
    for (const rel of ssotConsumers) {
      const src = readFileSync(join(root, rel), 'utf8')
      expect(
        /proClientVisibilityWhere|getVisibleClientIdSetForPro/.test(src),
        `${rel} must import a clientVisibility SSOT helper`,
      ).toBe(true)
      expect(
        inlineClause.test(src),
        `${rel} must not inline the visibility OR clauses`,
      ).toBe(false)
    }
    // The in-progress clause should appear exactly once in the codebase — in
    // the SSOT module itself.
    const ssot = readFileSync(join(root, 'lib/clientVisibility.ts'), 'utf8')
    const occurrences = ssot.match(/startedAt:\s*\{\s*not:\s*null\s*\}/g) ?? []
    expect(occurrences.length).toBe(1)
  })
})
