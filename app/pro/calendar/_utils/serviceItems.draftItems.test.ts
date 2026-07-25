// app/pro/calendar/_utils/serviceItems.draftItems.test.ts
//
// The pro calendar's service picker owns only service *ids*, so every
// checkbox toggle re-derives the whole draft from the sellable catalog.
// These pin the two ways that rebuild can go wrong:
//   1. it must actually build an item for a catalog service (a null here
//      empties the draft and blocks Save on "Select at least one service");
//   2. it must not drop a service that is already on the booking but is no
//      longer in the catalog — the save replaces the whole set, so a drop
//      deletes that service from the appointment.

import { describe, expect, it } from 'vitest'

import { draftItemsFromServiceIds } from './serviceItems'
import type { BookingServiceItem, ServiceOption } from '../_types'

const STEP_MINUTES = 15

const SILK_PRESS: ServiceOption = {
  id: 'service-silk',
  name: 'Silk Press',
  offeringId: 'offering-silk',
  durationMinutes: 90,
  priceStartingAt: '85.00',
}

const TRIM: ServiceOption = {
  id: 'service-trim',
  name: 'Trim',
  offeringId: 'offering-trim',
  durationMinutes: 30,
  priceStartingAt: '25.00',
}

/** A service item as it comes back on the booking itself. */
function bookedItem(
  overrides: Partial<BookingServiceItem> = {},
): BookingServiceItem {
  return {
    id: 'item-1',
    serviceId: 'service-retired',
    offeringId: 'offering-retired',
    itemType: 'BASE',
    serviceName: 'Retired Service',
    priceSnapshot: '60.00',
    durationMinutesSnapshot: 45,
    sortOrder: 0,
    ...overrides,
  }
}

describe('draftItemsFromServiceIds', () => {
  it('builds an item for each checked catalog service', () => {
    const items = draftItemsFromServiceIds({
      serviceIds: [SILK_PRESS.id, TRIM.id],
      services: [SILK_PRESS, TRIM],
      existingItems: [],
      stepMinutes: STEP_MINUTES,
    })

    expect(items.map((item) => item.serviceId)).toEqual([
      'service-silk',
      'service-trim',
    ])
    expect(items.map((item) => item.offeringId)).toEqual([
      'offering-silk',
      'offering-trim',
    ])
  })

  it('makes the first checked service the base and the rest add-ons', () => {
    const items = draftItemsFromServiceIds({
      serviceIds: [TRIM.id, SILK_PRESS.id],
      services: [SILK_PRESS, TRIM],
      existingItems: [],
      stepMinutes: STEP_MINUTES,
    })

    expect(items.map((item) => item.itemType)).toEqual(['BASE', 'ADD_ON'])
    expect(items.map((item) => item.serviceId)).toEqual([
      'service-trim',
      'service-silk',
    ])
  })

  it('keeps a booked service the catalog can no longer rebuild', () => {
    // The pro adds a second service to a booking whose original service has
    // since been retired from the catalog. The retired one must survive.
    const existing = bookedItem()

    const items = draftItemsFromServiceIds({
      serviceIds: [existing.serviceId, SILK_PRESS.id],
      services: [SILK_PRESS],
      existingItems: [existing],
      stepMinutes: STEP_MINUTES,
    })

    expect(items.map((item) => item.serviceId)).toEqual([
      'service-retired',
      'service-silk',
    ])

    const retired = items.find((item) => item.serviceId === 'service-retired')

    expect(retired).toBeDefined()
    expect(retired?.serviceName).toBe('Retired Service')
    expect(retired?.offeringId).toBe('offering-retired')
    expect(retired?.durationMinutesSnapshot).toBe(45)
  })

  it('drops an unknown service that is not on the booking either', () => {
    const items = draftItemsFromServiceIds({
      serviceIds: ['service-ghost', SILK_PRESS.id],
      services: [SILK_PRESS],
      existingItems: [],
      stepMinutes: STEP_MINUTES,
    })

    expect(items.map((item) => item.serviceId)).toEqual(['service-silk'])
  })

  it('does not build an item for a catalog service with no duration', () => {
    // A service whose offering resolved no mode is not bookable; it must not
    // masquerade as a valid draft item with an invented duration.
    const noDuration: ServiceOption = {
      id: 'service-unresolved',
      name: 'Unresolved',
      offeringId: 'offering-unresolved',
    }

    const items = draftItemsFromServiceIds({
      serviceIds: [noDuration.id],
      services: [noDuration],
      existingItems: [],
      stepMinutes: STEP_MINUTES,
    })

    expect(items).toHaveLength(0)
  })
})
