// lib/clientActions/resolveAllowUnverifiedDestination.test.ts
import { describe, expect, it } from 'vitest'

import { resolveAllowUnverifiedDestination } from './enqueueClientActionDispatch'
import type { ClientActionType } from './types'

function planFor(type: ClientActionType) {
  return { definition: { type } } as Parameters<
    typeof resolveAllowUnverifiedDestination
  >[0]['plan']
}

describe('resolveAllowUnverifiedDestination', () => {
  it('honors an explicit true override regardless of action type', () => {
    expect(
      resolveAllowUnverifiedDestination({
        allowUnverifiedDestination: true,
        plan: planFor('CONSULTATION_ACTION'),
      }),
    ).toBe(true)
  })

  it('honors an explicit false override regardless of action type', () => {
    expect(
      resolveAllowUnverifiedDestination({
        allowUnverifiedDestination: false,
        plan: planFor('CLIENT_CLAIM_INVITE'),
      }),
    ).toBe(false)
  })

  it.each<ClientActionType>([
    'CLIENT_CLAIM_INVITE',
    'CONSULTATION_ACTION',
    'AFTERCARE_ACCESS',
  ])(
    'defaults to true for the snapshot-based magic-link action %s',
    (type) => {
      expect(
        resolveAllowUnverifiedDestination({
          allowUnverifiedDestination: undefined,
          plan: planFor(type),
        }),
      ).toBe(true)
    },
  )
})
