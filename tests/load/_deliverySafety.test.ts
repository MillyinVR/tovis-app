import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { assertLoadTestDeliverySafe } from './_deliverySafety'

const FLAG = 'LOAD_TEST_DELIVERY_SAFE'

beforeEach(() => {
  delete process.env[FLAG]
})

afterEach(() => {
  delete process.env[FLAG]
})

describe('assertLoadTestDeliverySafe', () => {
  it('throws when the confirmation flag is unset', () => {
    expect(() => assertLoadTestDeliverySafe()).toThrow(
      /not confirmed delivery-safe/,
    )
  })

  it.each(['1', 'true', 'yes', 'TRUE'])(
    'passes when confirmed with %s',
    (value) => {
      process.env[FLAG] = value
      expect(() => assertLoadTestDeliverySafe()).not.toThrow()
    },
  )

  it.each(['0', 'false', 'no', '', 'maybe'])(
    'still throws for non-confirming value %s',
    (value) => {
      process.env[FLAG] = value
      expect(() => assertLoadTestDeliverySafe()).toThrow()
    },
  )
})
