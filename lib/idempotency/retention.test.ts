import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { idempotencyKey: { deleteMany: mocks.deleteMany } },
}))

import {
  IDEMPOTENCY_RETENTION_DAYS,
  purgeExpiredIdempotencyKeys,
} from '@/lib/idempotency/retention'

const NOW = new Date('2026-08-21T12:00:00.000Z')

describe('purgeExpiredIdempotencyKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteMany.mockResolvedValue({ count: 3 })
  })

  it('deletes rows older than the retention window and nothing newer', async () => {
    const { deleted, cutoff } = await purgeExpiredIdempotencyKeys({ now: NOW })

    expect(deleted).toBe(3)
    expect(cutoff.toISOString()).toBe('2026-08-14T12:00:00.000Z')
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
    })
  })

  // Keyed on createdAt, NOT completedAt: a row that never completed has a null
  // completedAt and would be immortal under the obvious implementation — which
  // is exactly the class of row that accumulates.
  it('filters on createdAt so never-completed rows are still swept', async () => {
    await purgeExpiredIdempotencyKeys({ now: NOW })

    const where = mocks.deleteMany.mock.calls[0]?.[0]?.where
    expect(where).toHaveProperty('createdAt')
    expect(where).not.toHaveProperty('completedAt')
    expect(where).not.toHaveProperty('status')
  })

  it('honours an explicit retention window', async () => {
    const { cutoff } = await purgeExpiredIdempotencyKeys({
      now: NOW,
      retentionDays: 1,
    })

    expect(cutoff.toISOString()).toBe('2026-08-20T12:00:00.000Z')
  })

  // Deleting a row a client would still have replayed re-executes the write, so
  // the default is deliberately generous. If this ever drops near the two-minute
  // lock window, that reasoning was lost.
  it('defaults to a window far wider than the two-minute lock', () => {
    expect(IDEMPOTENCY_RETENTION_DAYS).toBeGreaterThanOrEqual(1)
    expect(IDEMPOTENCY_RETENTION_DAYS).toBe(7)
  })
})
