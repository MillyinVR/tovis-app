import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetRedis = vi.hoisted(() => vi.fn())
const mockRequireRedis = vi.hoisted(() => vi.fn())
const mockRedisHgetall = vi.hoisted(() => vi.fn())
const mockRedisHset = vi.hoisted(() => vi.fn())

vi.mock('@/lib/redis', () => ({
  getRedis: mockGetRedis,
  requireRedis: mockRequireRedis,
}))

async function loadSubject() {
  vi.resetModules()
  return await import('./runtimeFlags')
}

describe('lib/runtimeFlags', () => {
  beforeEach(() => {
    mockGetRedis.mockReset()
    mockRequireRedis.mockReset()
    mockRedisHgetall.mockReset()
    mockRedisHset.mockReset()

    mockRequireRedis.mockReturnValue({
      hset: mockRedisHset,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns default flags with backendAvailable=false when Redis is not configured', async () => {
    mockGetRedis.mockReturnValue(null)

    const { getRuntimeFlags } = await loadSubject()

    const result = await getRuntimeFlags()

    expect(result).toEqual({
      signup_disabled: false,
      sms_disabled: false,
      backendAvailable: false,
    })
    expect(mockGetRedis).toHaveBeenCalledTimes(1)
  })

  it('reads stored flags from Redis and marks backendAvailable=true', async () => {
    mockGetRedis.mockReturnValue({
      hgetall: mockRedisHgetall,
    })
    mockRedisHgetall.mockResolvedValue({
      signup_disabled: '1',
      sms_disabled: 'true',
    })

    const { getRuntimeFlags } = await loadSubject()

    const result = await getRuntimeFlags()

    expect(mockRedisHgetall).toHaveBeenCalledWith('runtime_flags:v1')
    expect(result).toEqual({
      signup_disabled: true,
      sms_disabled: true,
      backendAvailable: true,
    })
  })

  it('treats missing or falsey stored values as false', async () => {
    mockGetRedis.mockReturnValue({
      hgetall: mockRedisHgetall,
    })
    mockRedisHgetall.mockResolvedValue({
      signup_disabled: '0',
      sms_disabled: false,
    })

    const { getRuntimeFlags } = await loadSubject()

    const result = await getRuntimeFlags()

    expect(result).toEqual({
      signup_disabled: false,
      sms_disabled: false,
      backendAvailable: true,
    })
  })

  it('falls back to default flags with backendAvailable=false when Redis read throws', async () => {
    mockGetRedis.mockReturnValue({
      hgetall: mockRedisHgetall,
    })
    mockRedisHgetall.mockRejectedValue(new Error('redis read failed'))

    const { getRuntimeFlags } = await loadSubject()

    const result = await getRuntimeFlags()

    expect(result).toEqual({
      signup_disabled: false,
      sms_disabled: false,
      backendAvailable: false,
    })
  })

  it('checks a single flag through isRuntimeFlagEnabled', async () => {
    mockGetRedis.mockReturnValue({
      hgetall: mockRedisHgetall,
    })
    mockRedisHgetall.mockResolvedValue({
      signup_disabled: 'true',
      sms_disabled: '0',
    })

    const { isRuntimeFlagEnabled } = await loadSubject()

    await expect(isRuntimeFlagEnabled('signup_disabled')).resolves.toBe(true)
    await expect(isRuntimeFlagEnabled('sms_disabled')).resolves.toBe(false)
  })

  it('writes enabled flags as 1', async () => {
    const { setRuntimeFlag } = await loadSubject()

    await setRuntimeFlag('signup_disabled', true)

    expect(mockRequireRedis).toHaveBeenCalledTimes(1)
    expect(mockRedisHset).toHaveBeenCalledWith('runtime_flags:v1', {
      signup_disabled: '1',
    })
  })

  it('writes disabled flags as 0', async () => {
    const { setRuntimeFlag } = await loadSubject()

    await setRuntimeFlag('sms_disabled', false)

    expect(mockRequireRedis).toHaveBeenCalledTimes(1)
    expect(mockRedisHset).toHaveBeenCalledWith('runtime_flags:v1', {
      sms_disabled: '0',
    })
  })
})