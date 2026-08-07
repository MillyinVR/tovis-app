import { describe, expect, it } from 'vitest'

import { addElapsedDays } from './instant'

describe('addElapsedDays', () => {
  it('adds fixed 24-hour periods without mutating the input instant', () => {
    const input = new Date('2026-03-08T09:30:00.000Z')

    expect(addElapsedDays(input, 2)).toEqual(
      new Date('2026-03-10T09:30:00.000Z'),
    )
    expect(input).toEqual(new Date('2026-03-08T09:30:00.000Z'))
  })
})
