// lib/nfc/cleanupTapIntents.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tapIntent: { deleteMany: mocks.deleteMany },
  },
}))

import { prisma } from '@/lib/prisma'

import { pruneExpiredTapIntents } from './cleanupTapIntents'

describe('pruneExpiredTapIntents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes intents expired at or before now and returns the count', async () => {
    const now = new Date('2026-04-12T12:00:00.000Z')
    mocks.deleteMany.mockResolvedValue({ count: 7 })

    const deleted = await pruneExpiredTapIntents(prisma, now)

    expect(deleted).toBe(7)
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    })
  })
})
