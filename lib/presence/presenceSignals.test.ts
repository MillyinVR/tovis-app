import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  zadd: vi.fn(),
  expire: vi.fn(),
  zremrangebyscore: vi.fn(),
  zcard: vi.fn(),
  zrem: vi.fn(),
  getRedis: vi.fn(),
  waitlistCount: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  getRedis: mocks.getRedis,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistEntry: {
      count: mocks.waitlistCount,
    },
  },
}))

import {
  recordHeartbeat,
  countWatching,
  countWaitlisted,
  getPresenceSignals,
  removePresence,
} from './presenceSignals'

const fakeRedis = {
  zadd: mocks.zadd,
  expire: mocks.expire,
  zremrangebyscore: mocks.zremrangebyscore,
  zcard: mocks.zcard,
  zrem: mocks.zrem,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getRedis.mockReturnValue(fakeRedis)
  mocks.zadd.mockResolvedValue(1)
  mocks.expire.mockResolvedValue(1)
  mocks.zremrangebyscore.mockResolvedValue(0)
  mocks.zcard.mockResolvedValue(3)
  mocks.zrem.mockResolvedValue(1)
  mocks.waitlistCount.mockResolvedValue(5)
})

describe('recordHeartbeat', () => {
  it('adds clientId to sorted set with timestamp score', async () => {
    const before = Date.now()
    const result = await recordHeartbeat({
      resourceType: 'opening',
      resourceId: 'op-1',
      clientId: 'client-1',
    })

    expect(result).toBe(true)
    expect(mocks.zadd).toHaveBeenCalledWith(
      'presence:watching:opening:op-1',
      expect.objectContaining({
        member: 'client-1',
      }),
    )

    const call = mocks.zadd.mock.calls[0] as [string, { score: number; member: string }]
    expect(call[1].score).toBeGreaterThanOrEqual(before)
    expect(call[1].score).toBeLessThanOrEqual(Date.now())

    expect(mocks.expire).toHaveBeenCalledWith('presence:watching:opening:op-1', 90)
  })

  it('returns false when Redis is unavailable', async () => {
    mocks.getRedis.mockReturnValue(null)
    const result = await recordHeartbeat({
      resourceType: 'opening',
      resourceId: 'op-1',
      clientId: 'client-1',
    })

    expect(result).toBe(false)
    expect(mocks.zadd).not.toHaveBeenCalled()
  })
})

describe('countWatching', () => {
  it('prunes stale entries and returns count', async () => {
    const result = await countWatching({
      resourceType: 'opening',
      resourceId: 'op-1',
    })

    expect(result).toBe(3)
    expect(mocks.zremrangebyscore).toHaveBeenCalledWith(
      'presence:watching:opening:op-1',
      0,
      expect.any(Number),
    )
    expect(mocks.zcard).toHaveBeenCalledWith('presence:watching:opening:op-1')
  })

  it('returns null when Redis is unavailable', async () => {
    mocks.getRedis.mockReturnValue(null)
    const result = await countWatching({
      resourceType: 'offering',
      resourceId: 'off-1',
    })

    expect(result).toBeNull()
  })
})

describe('countWaitlisted', () => {
  it('counts active waitlist entries for professional', async () => {
    const result = await countWaitlisted({ professionalId: 'pro-1' })

    expect(result).toBe(5)
    expect(mocks.waitlistCount).toHaveBeenCalledWith({
      where: { professionalId: 'pro-1', status: 'ACTIVE' },
    })
  })

  it('filters by serviceId when provided', async () => {
    await countWaitlisted({ professionalId: 'pro-1', serviceId: 'svc-1' })

    expect(mocks.waitlistCount).toHaveBeenCalledWith({
      where: { professionalId: 'pro-1', status: 'ACTIVE', serviceId: 'svc-1' },
    })
  })
})

describe('getPresenceSignals', () => {
  it('returns both watching and waitlisted counts', async () => {
    const result = await getPresenceSignals({
      resourceType: 'opening',
      resourceId: 'op-1',
      professionalId: 'pro-1',
    })

    expect(result).toEqual({ watching: 3, waitlisted: 5 })
  })

  it('returns null watching when Redis is down', async () => {
    mocks.getRedis.mockReturnValue(null)
    const result = await getPresenceSignals({
      resourceType: 'opening',
      resourceId: 'op-1',
      professionalId: 'pro-1',
    })

    expect(result).toEqual({ watching: null, waitlisted: 5 })
  })
})

describe('removePresence', () => {
  it('removes clientId from sorted set', async () => {
    await removePresence({
      resourceType: 'opening',
      resourceId: 'op-1',
      clientId: 'client-1',
    })

    expect(mocks.zrem).toHaveBeenCalledWith(
      'presence:watching:opening:op-1',
      'client-1',
    )
  })

  it('does nothing when Redis is unavailable', async () => {
    mocks.getRedis.mockReturnValue(null)
    await removePresence({
      resourceType: 'opening',
      resourceId: 'op-1',
      clientId: 'client-1',
    })

    expect(mocks.zrem).not.toHaveBeenCalled()
  })
})
