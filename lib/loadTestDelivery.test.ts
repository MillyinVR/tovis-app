import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { realDeliverySuppressed } from './loadTestDelivery'

const FLAG = 'LOAD_TEST_DISABLE_REAL_DELIVERY'
const LOGGED_KEY = '__tovisLoadTestDeliveryFlagInProdLogged'

function clearEnv() {
  delete process.env[FLAG]
  delete process.env.VERCEL_ENV
}

beforeEach(() => {
  clearEnv()
  // reset the once-per-process "logged on deploy" latch between cases
  delete (globalThis as Record<string, unknown>)[LOGGED_KEY]
})

afterEach(() => {
  clearEnv()
  vi.restoreAllMocks()
})

describe('realDeliverySuppressed', () => {
  it('is OFF by default when the flag is unset', () => {
    expect(realDeliverySuppressed()).toBe(false)
  })

  it('suppresses when opted in on local dev / CI (VERCEL_ENV unset)', () => {
    process.env[FLAG] = 'true'
    expect(realDeliverySuppressed()).toBe(true)
  })

  it('suppresses when opted in on a PREVIEW/staging deploy', () => {
    process.env[FLAG] = 'true'
    process.env.VERCEL_ENV = 'preview'
    expect(realDeliverySuppressed()).toBe(true)
  })

  it.each(['1', 'true', 'yes', 'TRUE', 'Yes'])(
    'accepts truthy flag value %s (local)',
    (value) => {
      process.env[FLAG] = value
      expect(realDeliverySuppressed()).toBe(true)
    },
  )

  it.each(['0', 'false', 'no', '', 'off'])(
    'treats %s as not opted in',
    (value) => {
      process.env[FLAG] = value
      expect(realDeliverySuppressed()).toBe(false)
    },
  )

  it('NEVER suppresses in PRODUCTION even with the flag set', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env[FLAG] = 'true'
    process.env.VERCEL_ENV = 'production'

    expect(realDeliverySuppressed()).toBe(false)
    // surfaces the leaked flag rather than silently disabling delivery
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('does not suppress in production even when the flag is unset', () => {
    process.env.VERCEL_ENV = 'production'
    expect(realDeliverySuppressed()).toBe(false)
  })
})
