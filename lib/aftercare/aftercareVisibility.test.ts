import { describe, expect, it } from 'vitest'

import { isClientAftercareVisible } from './aftercareVisibility'

describe('isClientAftercareVisible', () => {
  it('is visible for a COMPLETED booking even without a sent summary', () => {
    expect(
      isClientAftercareVisible({ status: 'COMPLETED', hasSentAftercare: false }),
    ).toBe(true)
  })

  it('is case-insensitive on status', () => {
    expect(
      isClientAftercareVisible({ status: 'completed', hasSentAftercare: false }),
    ).toBe(true)
  })

  it('is visible when a summary is sent regardless of status', () => {
    expect(
      isClientAftercareVisible({ status: 'ACCEPTED', hasSentAftercare: true }),
    ).toBe(true)
  })

  it('is hidden when not completed and no summary is sent', () => {
    expect(
      isClientAftercareVisible({ status: 'ACCEPTED', hasSentAftercare: false }),
    ).toBe(false)
  })

  it('tolerates a null/undefined status', () => {
    expect(
      isClientAftercareVisible({ status: null, hasSentAftercare: false }),
    ).toBe(false)
    expect(
      isClientAftercareVisible({ status: undefined, hasSentAftercare: true }),
    ).toBe(true)
  })
})
