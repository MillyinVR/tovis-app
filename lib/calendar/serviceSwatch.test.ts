// lib/calendar/serviceSwatch.test.ts
//
// K8: the DB-shaped half of the service-colour channel. K7's
// `resolveCalendarSwatch` is already pinned by eventColor.test.ts, so what is
// under test here is the adaptation — which column feeds which step of the
// chain, and which rows the fallback query is even asked about.

import { describe, expect, it, vi } from 'vitest'
import { BookingServiceItemType } from '@prisma/client'

import {
  loadOfferingSwatchesByServiceId,
  resolveBookingServiceSwatch,
  type SwatchBookingRow,
} from '@/lib/calendar/serviceSwatch'

function item(overrides: {
  itemType?: BookingServiceItemType
  sortOrder?: number | null
  swatch?: string | null
}) {
  return {
    itemType: overrides.itemType ?? BookingServiceItemType.BASE,
    sortOrder: overrides.sortOrder === undefined ? 0 : overrides.sortOrder,
    offering:
      overrides.swatch === undefined
        ? null
        : { calendarSwatch: overrides.swatch },
  }
}

function booking(overrides: Partial<SwatchBookingRow> = {}): SwatchBookingRow {
  return {
    serviceId: overrides.serviceId ?? 'service_1',
    offering: overrides.offering === undefined ? null : overrides.offering,
    serviceItems: overrides.serviceItems ?? [],
  }
}

describe('resolveBookingServiceSwatch', () => {
  it('takes the BASE item’s offering colour first', () => {
    const swatch = resolveBookingServiceSwatch(
      booking({
        offering: { calendarSwatch: '01' },
        serviceItems: [item({ swatch: '09' })],
      }),
      new Map([['service_1', '05']]),
    )

    expect(swatch).toBe('09')
  })

  it('ignores an ADD_ON’s colour — a gloss must not repaint the appointment', () => {
    const swatch = resolveBookingServiceSwatch(
      booking({
        serviceItems: [
          item({
            itemType: BookingServiceItemType.ADD_ON,
            sortOrder: 0,
            swatch: '11',
          }),
          item({
            itemType: BookingServiceItemType.BASE,
            sortOrder: 1,
            swatch: '04',
          }),
        ],
      }),
      new Map(),
    )

    expect(swatch).toBe('04')
  })

  // A visit can hold two BASE services. The card titles them in sortOrder, so
  // the stripe has to agree with the title rather than pick the other one.
  it('takes the lowest-sortOrder BASE item when a booking holds several', () => {
    const swatch = resolveBookingServiceSwatch(
      booking({
        serviceItems: [
          item({ sortOrder: 3, swatch: '12' }),
          item({ sortOrder: 1, swatch: '02' }),
          item({ sortOrder: 2, swatch: '08' }),
        ],
      }),
      new Map(),
    )

    expect(swatch).toBe('02')
  })

  it('falls through to the booking’s own offering when no item carries a colour', () => {
    const swatch = resolveBookingServiceSwatch(
      booking({
        offering: { calendarSwatch: '06' },
        serviceItems: [
          item({ swatch: null }),
          item({ itemType: BookingServiceItemType.ADD_ON, swatch: '11' }),
        ],
      }),
      new Map([['service_1', '05']]),
    )

    expect(swatch).toBe('06')
  })

  // `Booking.offeringId` is nullable — this is the row shape the DoD names.
  it('falls through to the pro’s offering for the booking’s service when offeringId is null', () => {
    const swatch = resolveBookingServiceSwatch(
      booking({ serviceId: 'service_42', offering: null }),
      new Map([['service_42', '03']]),
    )

    expect(swatch).toBe('03')
  })

  it('resolves to null when nothing in the chain has a colour', () => {
    expect(
      resolveBookingServiceSwatch(
        booking({ serviceItems: [item({ swatch: null })] }),
        new Map(),
      ),
    ).toBeNull()
  })

  // The fall-THROUGH rule from K7: a stale value at one level must not blank
  // the chain, or retiring a palette id would erase colours further down it.
  it('steps past an out-of-palette value instead of stopping on it', () => {
    expect(
      resolveBookingServiceSwatch(
        booking({
          offering: { calendarSwatch: '#ff0000' },
          serviceItems: [item({ swatch: 'legacy-teal' })],
        }),
        new Map([['service_1', '07']]),
      ),
    ).toBe('07')
  })

  it('resolves to null when every level is out of palette', () => {
    expect(
      resolveBookingServiceSwatch(
        booking({
          offering: { calendarSwatch: 'rgb(1,2,3)' },
          serviceItems: [item({ swatch: '13' })],
        }),
        new Map([['service_1', '00']]),
      ),
    ).toBeNull()
  })

  it('treats a null sortOrder as 0 rather than dropping the item', () => {
    expect(
      resolveBookingServiceSwatch(
        booking({ serviceItems: [item({ sortOrder: null, swatch: '10' })] }),
        new Map(),
      ),
    ).toBe('10')
  })
})

describe('loadOfferingSwatchesByServiceId', () => {
  function fakeDb(rows: { serviceId: string; calendarSwatch: string | null }[]) {
    const findMany = vi.fn().mockResolvedValue(rows)

    return {
      db: { professionalServiceOffering: { findMany } },
      findMany,
    }
  }

  // Keyed on the pro alone — no dependency on which bookings are in view. That
  // independence is what lets the calendar route run it inside its existing
  // Promise.all instead of adding a hop to the waterfall.
  it('asks only for this pro’s coloured offerings, in one query', async () => {
    const { db, findMany } = fakeDb([{ serviceId: 'a', calendarSwatch: '05' }])

    await loadOfferingSwatchesByServiceId({ db, professionalId: 'pro_1' })

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_1',
        calendarSwatch: { not: null },
      },
      select: { serviceId: true, calendarSwatch: true },
    })
  })

  it('keys the result by serviceId and drops colourless rows', async () => {
    const { db } = fakeDb([
      { serviceId: 'a', calendarSwatch: '05' },
      { serviceId: 'b', calendarSwatch: null },
    ])

    const map = await loadOfferingSwatchesByServiceId({
      db,
      professionalId: 'pro_1',
    })

    expect(map.get('a')).toBe('05')
    expect(map.has('b')).toBe(false)
  })

  it('returns an empty map when the pro has coloured nothing', async () => {
    const { db } = fakeDb([])

    const map = await loadOfferingSwatchesByServiceId({
      db,
      professionalId: 'pro_1',
    })

    expect(map.size).toBe(0)
  })
})
