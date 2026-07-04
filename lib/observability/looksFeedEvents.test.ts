// lib/observability/looksFeedEvents.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { hashViewerId, logLooksFeedServe } from './looksFeedEvents'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hashViewerId', () => {
  it('is deterministic and never returns the raw id', () => {
    const a = hashViewerId('user_abc')
    const b = hashViewerId('user_abc')
    expect(a).toBe(b)
    expect(a).not.toBeNull()
    expect(a).not.toContain('user_abc')
    expect(a).toHaveLength(16)
  })

  it('returns null for missing / blank ids', () => {
    expect(hashViewerId(null)).toBeNull()
    expect(hashViewerId(undefined)).toBeNull()
    expect(hashViewerId('   ')).toBeNull()
  })
})

describe('logLooksFeedServe', () => {
  it('emits a single structured line carrying the cohort and hashed viewer', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logLooksFeedServe({
      cohort: 'for_you',
      authed: true,
      page: 'entry',
      itemCount: 7,
      userId: 'user_abc',
      backboneCount: 6,
      injectedCount: 1,
      seenCount: 0,
      followedCount: 3,
      affinityCategoryCount: 2,
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(spy.mock.calls[0]?.[0] as string)
    expect(payload).toMatchObject({
      namespace: 'looks_feed',
      event: 'looks_feed_serve',
      cohort: 'for_you',
      authed: true,
      page: 'entry',
      itemCount: 7,
      backboneCount: 6,
      injectedCount: 1,
    })
    expect(payload.viewerHash).toHaveLength(16)
    expect(JSON.stringify(payload)).not.toContain('user_abc')
  })
})
