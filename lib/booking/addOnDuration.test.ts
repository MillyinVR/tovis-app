// lib/booking/addOnDuration.test.ts
//
// B11(c). This module shipped with B1-A as the fix for dup-register entry
// B-D2 — the two add-on duration resolvers that disagreed — and had NO test
// naming either export. The gap mattered: the whole point of the module is that
// the OFFER and the COMMIT resolve a link's minutes identically, and nothing
// pinned that they still do ([[a-suites-name-is-not-its-coverage]]).
import { ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  buildOfferingAddOnWhere,
  resolveAddOnDurationMinutes,
} from './addOnDuration'

function resolve(
  overrides?: Partial<Parameters<typeof resolveAddOnDurationMinutes>[0]>,
): number | null {
  return resolveAddOnDurationMinutes({
    durationOverrideMinutes: null,
    proOffering: null,
    defaultDurationMinutes: null,
    locationType: ServiceLocationType.SALON,
    ...overrides,
  })
}

describe('resolveAddOnDurationMinutes', () => {
  it('prefers the link override over both fallbacks', () => {
    expect(
      resolve({
        durationOverrideMinutes: 45,
        proOffering: { salonDurationMinutes: 90, mobileDurationMinutes: 90 },
        defaultDurationMinutes: 30,
      }),
    ).toBe(45)
  })

  it('reads the mode that matches the booking, not the other one', () => {
    const proOffering = {
      salonDurationMinutes: 60,
      mobileDurationMinutes: 90,
    }

    expect(
      resolve({ proOffering, locationType: ServiceLocationType.SALON }),
    ).toBe(60)

    expect(
      resolve({ proOffering, locationType: ServiceLocationType.MOBILE }),
    ).toBe(90)
  })

  it('falls through to the catalog default when the pro prices only the other mode', () => {
    expect(
      resolve({
        proOffering: { salonDurationMinutes: 60, mobileDurationMinutes: null },
        defaultDurationMinutes: 30,
        locationType: ServiceLocationType.MOBILE,
      }),
    ).toBe(30)
  })

  it('falls through to the catalog default when there is no pro offering at all', () => {
    expect(resolve({ proOffering: null, defaultDurationMinutes: 30 })).toBe(30)
  })

  /**
   * B-D2, the reason this module exists. The write path applied a 15-minute
   * floor per add-on and availability summed the raw minutes, so a 5-minute
   * add-on sized the OFFER +5 and the COMMIT +15 — a window the client was
   * offered and then refused at the confirm. One resolver now, read aligned UP
   * to the write: 5 minutes is 15 on BOTH ends.
   */
  it('applies the 15-minute floor, so a short add-on cannot size the offer under the commit', () => {
    expect(resolve({ durationOverrideMinutes: 5 })).toBe(15)
    expect(resolve({ defaultDurationMinutes: 1 })).toBe(15)
    expect(
      resolve({
        proOffering: { salonDurationMinutes: 5, mobileDurationMinutes: null },
      }),
    ).toBe(15)
  })

  /**
   * A non-positive stored duration used to be silently 0 minutes on the
   * availability side and a thrown refusal on the write side. `null` is the
   * contract for anything the chain cannot price at all — negative, NaN, or
   * genuinely missing. Callers must refuse, never substitute a zero.
   */
  it('answers null for a duration it cannot price at all', () => {
    expect(resolve({ defaultDurationMinutes: -30 })).toBeNull()
    expect(resolve({ defaultDurationMinutes: Number.NaN })).toBeNull()
    expect(resolve({})).toBeNull()
  })

  /**
   * The add-on-specific exception: a chain that resolves to an EXACT zero is
   * legal — an instant/retail add-on (e.g. a take-home product) that adds no
   * time to the appointment. `??` only skips null/undefined, so landing on 0
   * anywhere in the chain was deliberate, not a fall-through waiting to
   * happen — it must return 0 outright, never silently promote to a later,
   * larger fallback.
   */
  it('treats an exact zero as a legal, intentional add-on duration', () => {
    expect(resolve({ defaultDurationMinutes: 0 })).toBe(0)

    expect(
      resolve({
        durationOverrideMinutes: 0,
        proOffering: { salonDurationMinutes: 60, mobileDurationMinutes: 60 },
        defaultDurationMinutes: 30,
      }),
    ).toBe(0)

    expect(
      resolve({
        proOffering: { salonDurationMinutes: 0, mobileDurationMinutes: 60 },
        defaultDurationMinutes: 30,
        locationType: ServiceLocationType.SALON,
      }),
    ).toBe(0)
  })

  it('truncates a fractional duration rather than rounding it up', () => {
    expect(resolve({ defaultDurationMinutes: 45.9 })).toBe(45)
  })
})

describe('buildOfferingAddOnWhere', () => {
  const args = {
    addOnIds: ['addon_1', 'addon_2'],
    offeringId: 'offering_1',
    locationType: ServiceLocationType.MOBILE,
  }

  it('scopes the selection to active links on THIS offering', () => {
    const where = buildOfferingAddOnWhere(args)

    expect(where.id).toEqual({ in: ['addon_1', 'addon_2'] })
    expect(where.offeringId).toBe('offering_1')
    expect(where.isActive).toBe(true)
  })

  it('accepts a mode-agnostic link or one matching the booking mode, and no other', () => {
    expect(buildOfferingAddOnWhere(args).OR).toEqual([
      { locationType: null },
      { locationType: ServiceLocationType.MOBILE },
    ])

    expect(
      buildOfferingAddOnWhere({
        ...args,
        locationType: ServiceLocationType.SALON,
      }).OR,
    ).toEqual([
      { locationType: null },
      { locationType: ServiceLocationType.SALON },
    ])
  })

  it('requires the add-on service to be active AND add-on eligible', () => {
    expect(buildOfferingAddOnWhere(args).addOnService).toEqual({
      isActive: true,
      isAddOnEligible: true,
    })
  })
})
