// lib/pro/cameraQuota.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
  getQuota: vi.fn(),
  enforcementEnabled: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({ getRedis: mocks.getRedis }))
vi.mock('@/lib/pro/entitlements', () => ({
  getProCameraImageMonthlyQuota: mocks.getQuota,
}))
vi.mock('@/lib/membership/enforcement', () => ({
  membershipEnforcementEnabled: mocks.enforcementEnabled,
}))

import {
  enforceCameraImageQuota,
  getProCameraUsage,
  grantCameraBonusImages,
  recordCameraImageUse,
} from './cameraQuota'

const NOW = new Date('2026-07-15T00:00:00.000Z')
const USED_KEY = 'quota:pro:camera:pro-1:2026-07'
const BONUS_KEY = 'quota:pro:camera:bonus:pro-1:2026-07'

function makeRedis(store: Record<string, number>) {
  return {
    get: vi.fn(async (k: string) => (k in store ? String(store[k]) : null)),
    incrby: vi.fn(async (k: string, n: number) => {
      store[k] = (store[k] ?? 0) + n
      return store[k]
    }),
    expire: vi.fn(async () => 1),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enforcementEnabled.mockReturnValue(true)
  mocks.getQuota.mockResolvedValue(6)
})

describe('getProCameraUsage', () => {
  it('sums plan quota + bonus and computes remaining', async () => {
    mocks.getRedis.mockReturnValue(makeRedis({ [USED_KEY]: 4, [BONUS_KEY]: 2 }))

    const usage = await getProCameraUsage({ professionalId: 'pro-1', now: NOW })
    expect(usage).toMatchObject({
      used: 4,
      baseQuota: 6,
      bonus: 2,
      quota: 8,
      remaining: 4,
      enforced: true,
    })
  })

  it('fails safe to 0 used / 0 bonus when Redis is unavailable', async () => {
    mocks.getRedis.mockReturnValue(null)

    const usage = await getProCameraUsage({ professionalId: 'pro-1', now: NOW })
    expect(usage).toMatchObject({ used: 0, bonus: 0, quota: 6, remaining: 6 })
  })
})

describe('grantCameraBonusImages', () => {
  it('increments the month bonus counter and returns the new total', async () => {
    const store: Record<string, number> = {}
    mocks.getRedis.mockReturnValue(makeRedis(store))

    expect(await grantCameraBonusImages({ professionalId: 'pro-1', count: 5, now: NOW })).toBe(5)
    expect(await grantCameraBonusImages({ professionalId: 'pro-1', count: 3, now: NOW })).toBe(8)
    expect(store[BONUS_KEY]).toBe(8)
  })

  it('rejects non-positive counts and null Redis', async () => {
    mocks.getRedis.mockReturnValue(makeRedis({}))
    expect(await grantCameraBonusImages({ professionalId: 'pro-1', count: 0, now: NOW })).toBeNull()

    mocks.getRedis.mockReturnValue(null)
    expect(await grantCameraBonusImages({ professionalId: 'pro-1', count: 5, now: NOW })).toBeNull()
  })
})

// The flag is OFF by default in prod (and in vitest.setup.ts) — metering is
// inert until ENABLE_MEMBERSHIP_ENFORCEMENT is turned on. Every other test here
// runs with it forced ON, so these lock the disabled-path short-circuit: it must
// allow/no-op WITHOUT ever touching Redis or the plan-quota lookup.
describe('enforcement disabled (flag OFF) short-circuits', () => {
  beforeEach(() => {
    mocks.enforcementEnabled.mockReturnValue(false)
  })

  it('enforceCameraImageQuota allows without reading Redis or the plan quota, even when way over', async () => {
    mocks.getRedis.mockReturnValue(makeRedis({ [USED_KEY]: 100, [BONUS_KEY]: 0 }))

    const decision = await enforceCameraImageQuota({
      professionalId: 'pro-1',
      imageCount: 5,
      now: NOW,
    })

    expect(decision).toEqual({ allowed: true })
    // Short-circuits at the flag check — before any metering infrastructure runs.
    expect(mocks.getRedis).not.toHaveBeenCalled()
    expect(mocks.getQuota).not.toHaveBeenCalled()
  })

  it('recordCameraImageUse records nothing when metering is off', async () => {
    const redis = makeRedis({})
    mocks.getRedis.mockReturnValue(redis)

    await recordCameraImageUse({ professionalId: 'pro-1', imageCount: 3, now: NOW })

    expect(mocks.getRedis).not.toHaveBeenCalled()
    expect(redis.incrby).not.toHaveBeenCalled()
    expect(redis.expire).not.toHaveBeenCalled()
  })

  it('getProCameraUsage still reports real usage but flags enforced:false', async () => {
    mocks.getRedis.mockReturnValue(makeRedis({ [USED_KEY]: 4, [BONUS_KEY]: 2 }))

    const usage = await getProCameraUsage({ professionalId: 'pro-1', now: NOW })

    expect(usage).toMatchObject({
      used: 4,
      baseQuota: 6,
      bonus: 2,
      quota: 8,
      remaining: 4,
      enforced: false,
    })
  })
})

describe('enforceCameraImageQuota with bonus', () => {
  it('adds granted bonus to the effective quota', async () => {
    mocks.getRedis.mockReturnValue(makeRedis({ [USED_KEY]: 6, [BONUS_KEY]: 3 }))
    // used 6, quota 6 + 3 bonus = 9 → 6 + 2 = 8 ≤ 9 → allowed
    expect(await enforceCameraImageQuota({ professionalId: 'pro-1', imageCount: 2, now: NOW })).toEqual({
      allowed: true,
    })
  })

  it('blocks once used + request exceeds base + bonus', async () => {
    mocks.getRedis.mockReturnValue(makeRedis({ [USED_KEY]: 8, [BONUS_KEY]: 3 }))
    // used 8, quota 9 → 8 + 2 = 10 > 9 → blocked
    expect(await enforceCameraImageQuota({ professionalId: 'pro-1', imageCount: 2, now: NOW })).toEqual({
      allowed: false,
      used: 8,
      quota: 9,
    })
  })
})
