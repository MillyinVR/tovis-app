// app/pro/profile/public-profile/_data/pickProProfileManagementTab.test.ts
import { describe, expect, it } from 'vitest'

import { pickProProfileManagementTab } from './loadProProfileManagementPage'

describe('pickProProfileManagementTab', () => {
  /**
   * 🔴 The default. A bare `/pro/profile/public-profile` has to land a pro on
   * their own work — the library was briefly a separate screen nothing linked
   * to, which is exactly the failure this default prevents recurring.
   */
  it('defaults to the library', () => {
    expect(pickProProfileManagementTab(undefined)).toBe('portfolio')
    expect(pickProProfileManagementTab(null)).toBe('portfolio')
    expect(pickProProfileManagementTab({})).toBe('portfolio')
  })

  it('resolves the two named tabs', () => {
    expect(pickProProfileManagementTab({ tab: 'services' })).toBe('services')
    expect(pickProProfileManagementTab({ tab: 'reviews' })).toBe('reviews')
  })

  it('still resolves portfolio explicitly, so old links keep working', () => {
    expect(pickProProfileManagementTab({ tab: 'portfolio' })).toBe('portfolio')
  })

  it('falls back to the library for anything unrecognised', () => {
    expect(pickProProfileManagementTab({ tab: 'nonsense' })).toBe('portfolio')
    expect(pickProProfileManagementTab({ tab: ['reviews', 'services'] })).toBe(
      'reviews',
    )
  })
})
