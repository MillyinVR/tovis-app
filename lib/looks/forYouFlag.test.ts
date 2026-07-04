// lib/looks/forYouFlag.test.ts
import { afterEach, describe, expect, it } from 'vitest'

import { forYouFeedEnabled } from './forYouFlag'

const ORIGINAL = process.env.ENABLE_FOR_YOU_FEED

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.ENABLE_FOR_YOU_FEED
  } else {
    process.env.ENABLE_FOR_YOU_FEED = ORIGINAL
  }
})

describe('forYouFeedEnabled', () => {
  it('defaults OFF when unset', () => {
    delete process.env.ENABLE_FOR_YOU_FEED
    expect(forYouFeedEnabled()).toBe(false)
  })

  it('accepts truthy tokens (case / whitespace tolerant)', () => {
    for (const value of ['1', 'true', 'YES', '  true  ']) {
      process.env.ENABLE_FOR_YOU_FEED = value
      expect(forYouFeedEnabled()).toBe(true)
    }
  })

  it('treats anything else as OFF', () => {
    for (const value of ['0', 'false', 'no', 'off', '']) {
      process.env.ENABLE_FOR_YOU_FEED = value
      expect(forYouFeedEnabled()).toBe(false)
    }
  })
})
