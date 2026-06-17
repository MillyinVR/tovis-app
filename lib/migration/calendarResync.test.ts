// lib/migration/calendarResync.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  fetchCalendarFeed: vi.fn(),
  parseCalendarFeed: vi.fn(),
  commitCalendarImport: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { calendarFeedSubscription: { findMany: mocks.findMany, update: mocks.update } },
}))
vi.mock('./calendarFeed', () => ({ fetchCalendarFeed: mocks.fetchCalendarFeed }))
vi.mock('./calendarImport', () => ({ parseCalendarFeed: mocks.parseCalendarFeed }))
vi.mock('./calendarImportServer', () => ({ commitCalendarImport: mocks.commitCalendarImport }))

import { runCalendarResync } from './calendarResync'

const NOW = new Date('2026-09-01T12:00:00.000Z')

function sub(id: string) {
  return { id, professionalId: `pro-${id}`, feedUrl: 'https://cal.example.com/f.ics', professional: { userId: `user-${id}` } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.update.mockResolvedValue({})
  mocks.parseCalendarFeed.mockReturnValue([{ uid: 'e1' }])
  mocks.commitCalendarImport.mockResolvedValue({ created: { bookings: 1, blocks: 2, history: 3 }, skipped: 0, failed: 0 })
})

describe('runCalendarResync', () => {
  it('reports an empty run when no feeds are connected', async () => {
    mocks.findMany.mockResolvedValue([])
    const summary = await runCalendarResync({ now: NOW })
    expect(summary).toMatchObject({ scanned: 0, synced: 0, errored: 0 })
    expect(mocks.fetchCalendarFeed).not.toHaveBeenCalled()
  })

  it('queries active + errored feeds, oldest-synced first', async () => {
    mocks.findMany.mockResolvedValue([])
    await runCalendarResync({ now: NOW })
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['ACTIVE', 'ERROR'] } },
        orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }],
      }),
    )
  })

  it('syncs a feed: commits with the pro user as actor and marks it ACTIVE', async () => {
    mocks.findMany.mockResolvedValue([sub('a')])
    mocks.fetchCalendarFeed.mockResolvedValue({ ok: true, ics: 'ICS' })

    const summary = await runCalendarResync({ now: NOW })

    expect(mocks.fetchCalendarFeed).toHaveBeenCalledWith('https://cal.example.com/f.ics')
    expect(mocks.commitCalendarImport).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId: 'pro-a', actorUserId: 'user-a', now: NOW }),
    )
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          lastSyncError: null,
          lastSyncedAt: NOW,
          lastSyncCounts: { bookings: 1, blocks: 2, history: 3, failed: 0 },
        }),
      }),
    )
    expect(summary).toMatchObject({ scanned: 1, synced: 1, errored: 0 })
  })

  it('marks a feed ERROR when the fetch fails and never commits', async () => {
    mocks.findMany.mockResolvedValue([sub('b')])
    mocks.fetchCalendarFeed.mockResolvedValue({ ok: false, code: 'UNREACHABLE', error: 'nope' })

    const summary = await runCalendarResync({ now: NOW })

    expect(mocks.commitCalendarImport).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b' },
        data: expect.objectContaining({ status: 'ERROR', lastSyncError: 'UNREACHABLE: nope' }),
      }),
    )
    expect(summary).toMatchObject({ scanned: 1, synced: 0, errored: 1 })
  })

  it('keeps going when one feed throws', async () => {
    mocks.findMany.mockResolvedValue([sub('a'), sub('b')])
    mocks.fetchCalendarFeed.mockResolvedValueOnce({ ok: true, ics: 'ICS' })
    mocks.commitCalendarImport.mockRejectedValueOnce(new Error('boom'))
    mocks.fetchCalendarFeed.mockResolvedValueOnce({ ok: true, ics: 'ICS' })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const summary = await runCalendarResync({ now: NOW })
      expect(summary).toMatchObject({ scanned: 2, synced: 1, errored: 1 })
    } finally {
      errSpy.mockRestore()
    }
  })
})
