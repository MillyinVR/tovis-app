// lib/clientVisibility.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus } from '@prisma/client'

const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}))

import {
  RECENT_COMPLETED_WINDOW_DAYS,
  getProClientVisibility,
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
    expect(result.reason).toBe('NONE')
    expect(result.accessUntil).toBeNull()
  })

  it('cancelled bookings never count', async () => {
    // CANCELLED is not in any clause, so the DB returns no rows.
    findMany.mockResolvedValue([])
    const result = await getProClientVisibility('pro1', 'client1')
    expect(result.canViewClient).toBe(false)
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
})

describe('no re-divergence of the visibility rule', () => {
  // Guard: the post-visit window must live ONLY in proClientVisibilityWhere.
  // If this fails, someone re-inlined the booking-status OR clauses instead of
  // importing proClientVisibilityWhere — consolidate it back.
  it('no other source file inlines the visibility OR clauses', () => {
    const root = join(__dirname, '..')
    // The clients list page must import the helper, not re-declare clauses.
    const listPage = readFileSync(join(root, 'app/pro/clients/page.tsx'), 'utf8')
    expect(listPage).toContain('proClientVisibilityWhere')
    expect(listPage).not.toMatch(/startedAt:\s*\{\s*not:\s*null\s*\}/)
    // The in-progress clause should appear exactly once in the codebase — in
    // the SSOT module itself.
    const ssot = readFileSync(join(root, 'lib/clientVisibility.ts'), 'utf8')
    const occurrences = ssot.match(/startedAt:\s*\{\s*not:\s*null\s*\}/g) ?? []
    expect(occurrences.length).toBe(1)
  })
})
