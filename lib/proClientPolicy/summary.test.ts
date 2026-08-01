// lib/proClientPolicy/summary.test.ts

import { describe, expect, it } from 'vitest'

import {
  summarizeProClientPolicy,
  type StoredProClientPolicy,
} from '@/lib/proClientPolicy/summary'

const NONE: StoredProClientPolicy = {
  requireDeposit: false,
  prepayScope: null,
  requireCardOnFile: false,
  blockSelfServeBooking: false,
}

describe('summarizeProClientPolicy', () => {
  it('reports nothing for a client with no policy row', () => {
    expect(
      summarizeProClientPolicy({ policy: null, cardOnFileRailEnabled: true }),
    ).toEqual([])
  })

  it('reports nothing for a row whose switches are all off', () => {
    // The write route deletes instead of storing this, but a summary that
    // called four falses "requirements set" would put a client on the roster
    // with no requirement to show.
    expect(
      summarizeProClientPolicy({ policy: NONE, cardOnFileRailEnabled: true }),
    ).toEqual([])
  })

  it('names each switch the pro turned on, in display order', () => {
    const requirements = summarizeProClientPolicy({
      policy: {
        requireDeposit: true,
        prepayScope: 'ENTIRE_BOOKING',
        requireCardOnFile: true,
        blockSelfServeBooking: true,
      },
      cardOnFileRailEnabled: true,
    })

    expect(requirements.map((r) => r.key)).toEqual([
      'deposit',
      'prepay',
      'cardOnFile',
      'noOnlineBooking',
    ])
    expect(requirements.every((r) => !r.inactive)).toBe(true)
  })

  it('distinguishes the two prepay scopes in the label', () => {
    const serviceOnly = summarizeProClientPolicy({
      policy: { ...NONE, prepayScope: 'SERVICE_ONLY' },
      cardOnFileRailEnabled: true,
    })
    const wholeBooking = summarizeProClientPolicy({
      policy: { ...NONE, prepayScope: 'ENTIRE_BOOKING' },
      cardOnFileRailEnabled: true,
    })

    expect(serviceOnly[0]?.label).toBe('Prepay (service)')
    expect(wholeBooking[0]?.label).toBe('Prepay (whole booking)')
  })

  it('still reports card-on-file when the rail is dark, marked INACTIVE', () => {
    // The failure this pins: reading through the resolver instead of the stored
    // row would drop this requirement entirely, and the roster would show a
    // restricted client as unrestricted.
    const requirements = summarizeProClientPolicy({
      policy: { ...NONE, requireCardOnFile: true },
      cardOnFileRailEnabled: false,
    })

    expect(requirements).toHaveLength(1)
    expect(requirements[0]).toMatchObject({
      key: 'cardOnFile',
      inactive: true,
    })
  })

  it('does not mark the other switches inactive when the rail is dark', () => {
    const requirements = summarizeProClientPolicy({
      policy: {
        requireDeposit: true,
        prepayScope: 'ENTIRE_BOOKING',
        requireCardOnFile: false,
        blockSelfServeBooking: true,
      },
      cardOnFileRailEnabled: false,
    })

    expect(requirements.map((r) => r.inactive)).toEqual([false, false, false])
  })
})
