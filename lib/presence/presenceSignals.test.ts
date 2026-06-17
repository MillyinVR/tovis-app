import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  zadd: vi.fn(),
  expire: vi.fn(),
  zremrangebyscore: vi.fn(),
  zcard: vi.fn(),
  zrem: vi.fn(),
  zcount: vi.fn(),
  pipelineExec: vi.fn(),
  getRedis: vi.fn(),
  waitlistCount: vi.fn(),
  waitlistGroupBy: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  getRedis: mocks.getRedis,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistEntry: {
      count: mocks.waitlistCount,
      groupBy: mocks.waitlistGroupBy,
    },
  },
}))

import {
  recordHeartbeat,
  countWatching,
  countWaitlisted,
  getPresenceSignals,
  getPresenceSignalsBatch,
  removePresence,
} from './presenceSignals'

// Each pipeline() call records the zcount keys then resolves to pipelineExec().
const pipelineCalls: string[][] = []

const fakeRedis = {
  zadd: mocks.zadd,
  expire: mocks.expire,
  zremrangebyscore: mocks.zremrangebyscore,
  zcard: mocks.zcard,
  zrem: mocks.zrem,
  pipeline: () => {
    const keys: string[] = []
    pipelineCalls.push(keys)
    return {
      zcount: (key: string) => {
        keys.push(key)
      },
      exec: mocks.pipelineExec,
    }
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  pipelineCalls.length = 0
  mocks.getRedis.mockReturnValue(fakeRedis)
  mocks.zadd.mockResolvedValue(1)
  mocks.expire.mockResolvedValue(1)
  mocks.zremrangebyscore.mockResolvedValue(0)
  mocks.zcard.mockResolvedValue(3)
  mocks.zrem.mockResolvedValue(1)
  mocks.waitlistCount.mockResolvedValue(5)
  mocks.waitlistGroupBy.mockResolvedValue([])
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

describe('getPresenceSignalsBatch', () => {
  it('returns empty map for empty input without touching Redis or DB', async () => {
    const result = await getPresenceSignalsBatch([])
    expect(result).toEqual({})
    expect(mocks.waitlistGroupBy).not.toHaveBeenCalled()
  })

  it('pipelines one zcount per resource and maps counts by resourceId', async () => {
    mocks.pipelineExec.mockResolvedValue([4, 0])
    mocks.waitlistGroupBy.mockResolvedValue([
      { professionalId: 'pro-1', serviceId: 'svc-1', _count: { _all: 7 } },
    ])

    const result = await getPresenceSignalsBatch([
      { resourceType: 'opening', resourceId: 'op-1', professionalId: 'pro-1', serviceId: 'svc-1' },
      { resourceType: 'opening', resourceId: 'op-2', professionalId: 'pro-2', serviceId: 'svc-2' },
    ])

    // One pipeline, one zcount key per item, in order.
    expect(pipelineCalls).toHaveLength(1)
    expect(pipelineCalls[0]).toEqual([
      'presence:watching:opening:op-1',
      'presence:watching:opening:op-2',
    ])

    expect(result).toEqual({
      'op-1': { watching: 4, waitlisted: 7 },
      'op-2': { watching: 0, waitlisted: 0 },
    })
  })

  it('groups waitlist counts by professional + service', async () => {
    mocks.pipelineExec.mockResolvedValue([0, 0])
    mocks.waitlistGroupBy.mockResolvedValue([])

    await getPresenceSignalsBatch([
      { resourceType: 'opening', resourceId: 'op-1', professionalId: 'pro-1', serviceId: 'svc-1' },
      { resourceType: 'opening', resourceId: 'op-2', professionalId: 'pro-2', serviceId: 'svc-2' },
    ])

    expect(mocks.waitlistGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['professionalId', 'serviceId'],
        where: expect.objectContaining({
          status: 'ACTIVE',
          professionalId: { in: ['pro-1', 'pro-2'] },
          serviceId: { in: ['svc-1', 'svc-2'] },
        }),
      }),
    )
  })

  it('returns null watching for every resource when Redis is down', async () => {
    mocks.getRedis.mockReturnValue(null)
    mocks.waitlistGroupBy.mockResolvedValue([
      { professionalId: 'pro-1', serviceId: 'svc-1', _count: { _all: 2 } },
    ])

    const result = await getPresenceSignalsBatch([
      { resourceType: 'opening', resourceId: 'op-1', professionalId: 'pro-1', serviceId: 'svc-1' },
    ])

    expect(result).toEqual({ 'op-1': { watching: null, waitlisted: 2 } })
    expect(pipelineCalls).toHaveLength(0)
  })
})
