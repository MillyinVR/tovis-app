// app/pro/calendar/_utils/parsers.serviceOptions.test.ts
//
// Contract test: the pro calendar's service picker parses what
// `GET /api/v1/pro/services?locationType=…` ACTUALLY returns.
//
// The fixture below is the route's response row verbatim — see the object
// literal returned at `app/api/v1/pro/services/route.ts` (the `return {
// id, name, offeringId, supportedLocationTypes, selectedLocationType,
// requiresLocationTypeSelection, selectedMode, salon, mobile }` block).
// Price + duration live NESTED under `selectedMode` / `salon` / `mobile`;
// the route emits no top-level `durationMinutes` or `priceStartingAt`.
//
// This is the shape iOS already decodes (TovisKit `ProSellableService`), so
// it is the wire contract of record. A parser that reads the fields flat
// yields options with no duration, which `buildDraftItemFromServiceOption`
// rejects — wiping the pro's service selection on every toggle.

import { describe, expect, it } from 'vitest'

import { parseServiceOptions } from './parsers'
import { buildDraftItemFromServiceOption } from './serviceItems'
import type { ServiceOption } from '../_types'

/** Parse one row and assert it survived, so the tests can read it directly. */
function parseOne(row: unknown): ServiceOption {
  const [option] = parseServiceOptions([row])

  if (!option) throw new Error('expected the row to parse into an option')

  return option
}

/** One row exactly as `app/api/v1/pro/services/route.ts` emits it. */
const ROUTE_ROW_SALON = {
  id: 'service-1',
  name: 'Silk Press',
  offeringId: 'offering-1',
  supportedLocationTypes: ['SALON'],
  selectedLocationType: 'SALON',
  requiresLocationTypeSelection: false,
  // Money is emitted by `moneyToString`, which strips trailing zeros — the
  // wire carries "85", not "85.00".
  selectedMode: {
    locationType: 'SALON',
    durationMinutes: 90,
    priceStartingAt: '85',
  },
  salon: { enabled: true, durationMinutes: 90, priceStartingAt: '85' },
  mobile: { enabled: false, durationMinutes: null, priceStartingAt: null },
}

describe('parseServiceOptions — real /api/v1/pro/services wire shape', () => {
  it('reads duration and price from the nested selectedMode', () => {
    const option = parseOne(ROUTE_ROW_SALON)

    expect(option.id).toBe('service-1')
    expect(option.offeringId).toBe('offering-1')
    expect(option.durationMinutes).toBe(90)
    expect(option.priceStartingAt).toBe('85')
  })

  it('yields an option that can actually become a draft service item', () => {
    // This is the exact chain the picker runs on every checkbox toggle:
    // parse the catalog → rebuild the draft. If the built item is null the
    // draft empties and the modal shows "Select at least one service
    // before saving." even though a service IS selected.
    const draftItem = buildDraftItemFromServiceOption(
      parseOne(ROUTE_ROW_SALON),
      0,
      15,
    )

    expect(draftItem).not.toBeNull()
    expect(draftItem?.serviceId).toBe('service-1')
    expect(draftItem?.offeringId).toBe('offering-1')
    expect(draftItem?.durationMinutesSnapshot).toBe(90)
  })

  it('falls back to the mode matching the requested location for a mobile row', () => {
    const mobileRow = {
      ...ROUTE_ROW_SALON,
      supportedLocationTypes: ['MOBILE'],
      selectedLocationType: 'MOBILE',
      selectedMode: {
        locationType: 'MOBILE',
        durationMinutes: 120,
        priceStartingAt: '110',
      },
      salon: { enabled: false, durationMinutes: null, priceStartingAt: null },
      mobile: { enabled: true, durationMinutes: 120, priceStartingAt: '110' },
    }

    const option = parseOne(mobileRow)

    expect(option.durationMinutes).toBe(120)
    expect(option.priceStartingAt).toBe('110')
  })

  it('still parses a row whose mode could not be resolved, without a duration', () => {
    // A multi-mode offering with no locationType requested resolves no mode.
    // It must not crash, and it must not masquerade as bookable.
    const unresolved = {
      ...ROUTE_ROW_SALON,
      supportedLocationTypes: ['SALON', 'MOBILE'],
      selectedLocationType: null,
      requiresLocationTypeSelection: true,
      selectedMode: null,
      mobile: { enabled: true, durationMinutes: 120, priceStartingAt: '110' },
    }

    const option = parseOne(unresolved)

    expect(option.id).toBe('service-1')
    expect(option.durationMinutes).toBeUndefined()
  })
})
