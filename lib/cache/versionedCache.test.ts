// lib/cache/versionedCache.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  getRedis: mocks.getRedis,
}))

import {
  getCached,
  setCached,
  withVersionedCache,
} from './versionedCache'

type FakeStore = Map<string, unknown>

function makeFakeRedis(store: FakeStore = new Map()) {
  return {
    get: vi.fn(async (key: string) => {
      return (store.get(key) ?? null) as unknown
    }),
    set: vi.fn(
      async (key: string, value: unknown, _opts?: { ex?: number }) => {
        store.set(key, value)
        return 'OK'
      },
    ),
  }
}

beforeEach(() => {
  mocks.getRedis.mockReset()
})

describe('versionedCache', () => {
  it('cache miss runs loader and stores the result', async () => {
    const store: FakeStore = new Map()
    const redis = makeFakeRedis(store)
    mocks.getRedis.mockReturnValue(redis)

    const loader = vi.fn(async () => ({ ok: true, n: 42 }))

    const result = await withVersionedCache(
      { scope: 'availability:bootstrap', scopeId: 'pro_1', version: 1 },
      loader,
    )

    expect(result.cacheHit).toBe(false)
    expect(result.value).toEqual({ ok: true, n: 42 })
    expect(loader).toHaveBeenCalledTimes(1)
    expect(redis.set).toHaveBeenCalledWith(
      'vc:availability:bootstrap:pro_1:v1',
      { ok: true, n: 42 },
      { ex: 300 },
    )
  })

  it('cache hit returns the stored value without calling the loader', async () => {
    const store: FakeStore = new Map([
      ['vc:availability:bootstrap:pro_1:v1', { ok: true, n: 42 }],
    ])
    const redis = makeFakeRedis(store)
    mocks.getRedis.mockReturnValue(redis)

    const loader = vi.fn(async () => ({ ok: true, n: 99 }))

    const result = await withVersionedCache(
      { scope: 'availability:bootstrap', scopeId: 'pro_1', version: 1 },
      loader,
    )

    expect(result.cacheHit).toBe(true)
    expect(result.value).toEqual({ ok: true, n: 42 })
    expect(loader).not.toHaveBeenCalled()
  })

  it('different versions produce different keys (version bump invalidates)', async () => {
    const store: FakeStore = new Map([
      ['vc:availability:bootstrap:pro_1:v1', { stale: true }],
    ])
    const redis = makeFakeRedis(store)
    mocks.getRedis.mockReturnValue(redis)

    const loader = vi.fn(async () => ({ fresh: true }))

    const result = await withVersionedCache(
      { scope: 'availability:bootstrap', scopeId: 'pro_1', version: 2 },
      loader,
    )

    expect(result.cacheHit).toBe(false)
    expect(result.value).toEqual({ fresh: true })
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('extra discriminators namespace the key', async () => {
    const store: FakeStore = new Map([
      [
        'vc:availability:day:pro_1:v1:2026-05-15:SALON',
        { date: '2026-05-15', mode: 'SALON' },
      ],
    ])
    const redis = makeFakeRedis(store)
    mocks.getRedis.mockReturnValue(redis)

    const loader = vi.fn(async () => ({ should: 'not run' }))

    const result = await withVersionedCache(
      {
        scope: 'availability:day',
        scopeId: 'pro_1',
        version: 1,
        extra: '2026-05-15:SALON',
      },
      loader,
    )

    expect(result.cacheHit).toBe(true)
    expect(result.value).toEqual({ date: '2026-05-15', mode: 'SALON' })
    expect(loader).not.toHaveBeenCalled()
  })

  it('different scopes do not collide', async () => {
    const store: FakeStore = new Map([
      ['vc:scope-a:pro_1:v1', { from: 'a' }],
      ['vc:scope-b:pro_1:v1', { from: 'b' }],
    ])
    const redis = makeFakeRedis(store)
    mocks.getRedis.mockReturnValue(redis)

    const a = await withVersionedCache(
      { scope: 'scope-a', scopeId: 'pro_1', version: 1 },
      async () => ({ should: 'not run' }),
    )
    const b = await withVersionedCache(
      { scope: 'scope-b', scopeId: 'pro_1', version: 1 },
      async () => ({ should: 'not run' }),
    )

    expect(a.value).toEqual({ from: 'a' })
    expect(b.value).toEqual({ from: 'b' })
  })

  it('Redis unavailable: loader runs every time, no error thrown', async () => {
    mocks.getRedis.mockReturnValue(null)

    const loader = vi.fn(async () => ({ value: 'computed' }))

    const a = await withVersionedCache(
      { scope: 'scope-a', scopeId: 'pro_1', version: 1 },
      loader,
    )
    const b = await withVersionedCache(
      { scope: 'scope-a', scopeId: 'pro_1', version: 1 },
      loader,
    )

    expect(a.cacheHit).toBe(false)
    expect(b.cacheHit).toBe(false)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('Redis get error: caller still gets a value via the loader, no throw', async () => {
    const redis = {
      get: vi.fn(async () => {
        throw new Error('redis boom')
      }),
      set: vi.fn(async () => 'OK'),
    }
    mocks.getRedis.mockReturnValue(redis)

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    const loader = vi.fn(async () => ({ recovered: true }))

    const result = await withVersionedCache(
      { scope: 'scope-a', scopeId: 'pro_1', version: 1 },
      loader,
    )

    expect(result.cacheHit).toBe(false)
    expect(result.value).toEqual({ recovered: true })
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('Redis set error does not break the response', async () => {
    const redis = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw new Error('redis set boom')
      }),
    }
    mocks.getRedis.mockReturnValue(redis)

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    const result = await withVersionedCache(
      { scope: 'scope-a', scopeId: 'pro_1', version: 1 },
      async () => ({ ok: true }),
    )

    expect(result.cacheHit).toBe(false)
    expect(result.value).toEqual({ ok: true })
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('getCached returns null on miss without calling set', async () => {
    const store: FakeStore = new Map()
    const redis = makeFakeRedis(store)
    mocks.getRedis.mockReturnValue(redis)

    const value = await getCached({
      scope: 'scope-a',
      scopeId: 'pro_1',
      version: 1,
    })

    expect(value).toBeNull()
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('setCached respects custom TTL', async () => {
    const store: FakeStore = new Map()
    const redis = makeFakeRedis(store)
    mocks.getRedis.mockReturnValue(redis)

    await setCached(
      { scope: 'scope-a', scopeId: 'pro_1', version: 1 },
      { ok: true },
      60,
    )

    expect(redis.set).toHaveBeenCalledWith(
      'vc:scope-a:pro_1:v1',
      { ok: true },
      { ex: 60 },
    )
  })
})
