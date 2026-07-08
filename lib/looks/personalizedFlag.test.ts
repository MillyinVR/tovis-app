// lib/looks/personalizedFlag.test.ts
import { afterEach, describe, expect, it } from 'vitest'

import { personalizedFeedEnabled } from './personalizedFlag'

const ORIGINAL = process.env.ENABLE_PERSONALIZED_FEED

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.ENABLE_PERSONALIZED_FEED
  } else {
    process.env.ENABLE_PERSONALIZED_FEED = ORIGINAL
  }
})

describe('personalizedFeedEnabled', () => {
  it('defaults OFF when unset', () => {
    delete process.env.ENABLE_PERSONALIZED_FEED
    expect(personalizedFeedEnabled()).toBe(false)
  })

  it('accepts truthy tokens (case / whitespace tolerant)', () => {
    for (const value of ['1', 'true', 'YES', '  true  ']) {
      process.env.ENABLE_PERSONALIZED_FEED = value
      expect(personalizedFeedEnabled()).toBe(true)
    }
  })

  it('treats anything else as OFF', () => {
    for (const value of ['0', 'false', 'no', 'off', '']) {
      process.env.ENABLE_PERSONALIZED_FEED = value
      expect(personalizedFeedEnabled()).toBe(false)
    }
  })
})
