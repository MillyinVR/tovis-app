import { afterEach, describe, expect, it } from 'vitest'
import { globalRegistry } from './globalRegistry'

type TestRegistry = {
  __typedTestSingleton: { id: number }
}

afterEach(() => {
  delete globalRegistry<TestRegistry>().__typedTestSingleton
})

describe('globalRegistry', () => {
  it('returns undefined for keys that were never set', () => {
    expect(globalRegistry<TestRegistry>().__typedTestSingleton).toBeUndefined()
  })

  it('persists values across separate registry views', () => {
    const writer = globalRegistry<TestRegistry>()
    writer.__typedTestSingleton = { id: 7 }

    expect(globalRegistry<TestRegistry>().__typedTestSingleton).toEqual({ id: 7 })
  })
})
