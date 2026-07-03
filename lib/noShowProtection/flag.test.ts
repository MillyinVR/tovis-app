import { afterEach, describe, expect, it } from 'vitest'

import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

const ORIGINAL = process.env.ENABLE_NO_SHOW_PROTECTION

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ENABLE_NO_SHOW_PROTECTION
  else process.env.ENABLE_NO_SHOW_PROTECTION = ORIGINAL
})

describe('noShowProtectionEnabled', () => {
  it('defaults to off when unset', () => {
    delete process.env.ENABLE_NO_SHOW_PROTECTION
    expect(noShowProtectionEnabled()).toBe(false)
  })

  it.each(['1', 'true', 'TRUE', 'yes', ' Yes '])('is on for %s', (raw) => {
    process.env.ENABLE_NO_SHOW_PROTECTION = raw
    expect(noShowProtectionEnabled()).toBe(true)
  })

  it.each(['0', 'false', 'no', 'off', ''])('stays off for %s', (raw) => {
    process.env.ENABLE_NO_SHOW_PROTECTION = raw
    expect(noShowProtectionEnabled()).toBe(false)
  })
})
