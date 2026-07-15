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
      cohort: 'personalized',
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
      cohort: 'personalized',
      authed: true,
      page: 'entry',
      itemCount: 7,
      backboneCount: 6,
      injectedCount: 1,
    })
    expect(payload.viewerHash).toHaveLength(16)
    expect(JSON.stringify(payload)).not.toContain('user_abc')
  })

  it('carries the §4.3 composition fields when present, null otherwise', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logLooksFeedServe({
      cohort: 'personalized',
      authed: true,
      page: 'entry',
      itemCount: 13,
      userId: 'user_abc',
      sessionIntent: 'book',
      availabilityWeightMultiplier: 1.75,
      explorationInjectedCount: 2,
      bookableCount: 5,
      inspirationCount: 8,
      relationshipProCount: 3,
      relationshipBoostedCount: 2,
      underbookedBoostedCount: 4,
      conversionBoostedCount: 6,
      reliabilityBoostedCount: 7,
    })

    const withComposition = JSON.parse(spy.mock.calls[0]?.[0] as string)
    expect(withComposition).toMatchObject({
      sessionIntent: 'book',
      availabilityWeightMultiplier: 1.75,
      explorationInjectedCount: 2,
      bookableCount: 5,
      inspirationCount: 8,
      relationshipProCount: 3,
      relationshipBoostedCount: 2,
      underbookedBoostedCount: 4,
      conversionBoostedCount: 6,
      reliabilityBoostedCount: 7,
    })

    // A serve that omits them logs explicit nulls (a chronological serve).
    logLooksFeedServe({
      cohort: 'recent',
      authed: false,
      page: 'entry',
      itemCount: 4,
    })
    const withoutComposition = JSON.parse(spy.mock.calls[1]?.[0] as string)
    expect(withoutComposition.sessionIntent).toBeNull()
    expect(withoutComposition.explorationInjectedCount).toBeNull()
    expect(withoutComposition.relationshipProCount).toBeNull()
    expect(withoutComposition.relationshipBoostedCount).toBeNull()
    expect(withoutComposition.conversionBoostedCount).toBeNull()
    expect(withoutComposition.reliabilityBoostedCount).toBeNull()
  })
})
