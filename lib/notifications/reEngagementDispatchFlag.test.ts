// lib/notifications/reEngagementDispatchFlag.test.ts
import { afterEach, describe, expect, it } from 'vitest'

import { unifiedReEngagementDispatchEnabled } from './reEngagementDispatchFlag'

const ORIGINAL = process.env.ENABLE_UNIFIED_REENGAGEMENT_DISPATCH

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.ENABLE_UNIFIED_REENGAGEMENT_DISPATCH
  } else {
    process.env.ENABLE_UNIFIED_REENGAGEMENT_DISPATCH = ORIGINAL
  }
})

describe('unifiedReEngagementDispatchEnabled', () => {
  it('defaults OFF when unset (byte-identical prod default)', () => {
    delete process.env.ENABLE_UNIFIED_REENGAGEMENT_DISPATCH
    expect(unifiedReEngagementDispatchEnabled()).toBe(false)
  })

  it('accepts truthy tokens (case / whitespace tolerant)', () => {
    for (const value of ['1', 'true', 'YES', '  true  ']) {
      process.env.ENABLE_UNIFIED_REENGAGEMENT_DISPATCH = value
      expect(unifiedReEngagementDispatchEnabled()).toBe(true)
    }
  })

  it('treats anything else as OFF', () => {
    for (const value of ['0', 'false', 'no', 'off', '']) {
      process.env.ENABLE_UNIFIED_REENGAGEMENT_DISPATCH = value
      expect(unifiedReEngagementDispatchEnabled()).toBe(false)
    }
  })
})
