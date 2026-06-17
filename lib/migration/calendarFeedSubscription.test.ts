// lib/migration/calendarFeedSubscription.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarFeedSubscription: {
      upsert: mocks.upsert,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
    },
  },
}))

import {
  disconnectCalendarFeedSubscription,
  saveCalendarFeedSubscription,
} from './calendarFeedSubscription'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upsert.mockResolvedValue({
    feedUrl: 'https://cal.example.com/f.ics',
    status: 'ACTIVE',
    lastSyncedAt: null,
    lastSyncError: null,
  })
  mocks.updateMany.mockResolvedValue({ count: 1 })
})

describe('saveCalendarFeedSubscription', () => {
  it('rejects a non-https / invalid URL without touching the DB', async () => {
    const result = await saveCalendarFeedSubscription({ professionalId: 'pro-1', feedUrl: 'http://evil.example.com' })
    expect(result.ok).toBe(false)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('normalizes webcal:// to https and upserts as ACTIVE', async () => {
    const result = await saveCalendarFeedSubscription({
      professionalId: 'pro-1',
      feedUrl: 'webcal://cal.example.com/f.ics',
    })
    expect(result.ok).toBe(true)
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { professionalId: 'pro-1' },
        create: expect.objectContaining({ feedUrl: 'https://cal.example.com/f.ics', status: 'ACTIVE' }),
        update: expect.objectContaining({ status: 'ACTIVE', lastSyncError: null }),
      }),
    )
  })
})

describe('disconnectCalendarFeedSubscription', () => {
  it('pauses the subscription (kept for history)', async () => {
    await disconnectCalendarFeedSubscription('pro-1')
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro-1' },
      data: { status: 'PAUSED' },
    })
  })
})
