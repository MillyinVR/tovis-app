import { describe, expect, it } from 'vitest'

import { requestedVisibilityFromFlags } from './visibilityFromFlags'
import { MediaVisibility } from '@/lib/prismaEnums'

describe('requestedVisibilityFromFlags', () => {
  it('is PUBLIC when the pro is showing the asset', () => {
    expect(
      requestedVisibilityFromFlags({
        isFeaturedInPortfolio: true,
        isEligibleForLooks: false,
      }),
    ).toBe(MediaVisibility.PUBLIC)

    expect(
      requestedVisibilityFromFlags({
        isFeaturedInPortfolio: false,
        isEligibleForLooks: true,
      }),
    ).toBe(MediaVisibility.PUBLIC)
  })

  it('is PRO_CLIENT when neither flag is set', () => {
    expect(
      requestedVisibilityFromFlags({
        isFeaturedInPortfolio: false,
        isEligibleForLooks: false,
      }),
    ).toBe(MediaVisibility.PRO_CLIENT)
  })

  it('is symmetric in its two flags', () => {
    // 🔴 The reason this takes a named object. The three copies it replaces had
    // the SAME NAME and their two boolean parameters in the OPPOSITE order, so
    // calling the wrong one still compiled and still type checked. Only an
    // asymmetric result could ever have exposed that, and there isn't one — the
    // argument names are the only thing that can carry the meaning.
    const a = requestedVisibilityFromFlags({
      isFeaturedInPortfolio: true,
      isEligibleForLooks: false,
    })
    const b = requestedVisibilityFromFlags({
      isFeaturedInPortfolio: false,
      isEligibleForLooks: true,
    })
    expect(a).toBe(b)
  })
})
