// lib/calendar/eventColor.test.ts
import { describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_SWATCHES } from '@/lib/brand/defaults'
import {
  CALENDAR_SWATCH_IDS,
  parseCalendarSwatch,
  resolveCalendarSwatch,
} from './eventColor'

describe('parseCalendarSwatch', () => {
  it('accepts every id the palette defines', () => {
    for (const id of CALENDAR_SWATCH_IDS) {
      expect(parseCalendarSwatch(id)).toBe(id)
    }
  })

  it('trims surrounding whitespace', () => {
    expect(parseCalendarSwatch('  07 ')).toBe('07')
  })

  it.each([
    ['an id outside the palette', '13'],
    ['an unpadded id', '7'],
    ['a raw hex a migration smuggled in', '#ff0000'],
    ['a tailwind class', 'bg-red-500'],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('refuses %s', (_label, value) => {
    expect(parseCalendarSwatch(value)).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['an object', { id: '07' }],
  ])('refuses %s', (_label, value) => {
    expect(parseCalendarSwatch(value)).toBeNull()
  })

  it('every id it accepts is a colour the palette can actually paint', () => {
    for (const id of CALENDAR_SWATCH_IDS) {
      expect(DEFAULT_CALENDAR_SWATCHES.dark[id]).toBeTruthy()
      expect(DEFAULT_CALENDAR_SWATCHES.light[id]).toBeTruthy()
    }
  })
})

describe('resolveCalendarSwatch', () => {
  it('returns null for a booking with nothing to colour by', () => {
    expect(resolveCalendarSwatch({})).toBeNull()
    expect(
      resolveCalendarSwatch({ serviceItems: [], bookingOfferingSwatch: null }),
    ).toBeNull()
  })

  it('takes the BASE item’s offering swatch first', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [
          { isBase: false, sortOrder: 0, offeringSwatch: '11' },
          { isBase: true, sortOrder: 1, offeringSwatch: '04' },
        ],
        bookingOfferingSwatch: '08',
        categorySwatch: '02',
      }),
    ).toBe('04')
  })

  it('ignores ADD_ON items entirely — a gloss must not repaint the colour service', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [{ isBase: false, sortOrder: 0, offeringSwatch: '11' }],
        bookingOfferingSwatch: '08',
      }),
    ).toBe('08')
  })

  it('picks the lowest sortOrder when a booking holds several BASE items', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [
          { isBase: true, sortOrder: 5, offeringSwatch: '09' },
          { isBase: true, sortOrder: 2, offeringSwatch: '03' },
          { isBase: true, sortOrder: 9, offeringSwatch: '12' },
        ],
      }),
    ).toBe('03')
  })

  it('does not mutate the caller’s array while ordering it', () => {
    const serviceItems = [
      { isBase: true, sortOrder: 5, offeringSwatch: '09' },
      { isBase: true, sortOrder: 2, offeringSwatch: '03' },
    ]

    resolveCalendarSwatch({ serviceItems })

    expect(serviceItems.map((item) => item.sortOrder)).toEqual([5, 2])
  })

  it('skips a BASE item with no swatch and keeps looking down the base items', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [
          { isBase: true, sortOrder: 0, offeringSwatch: null },
          { isBase: true, sortOrder: 1, offeringSwatch: '06' },
        ],
      }),
    ).toBe('06')
  })

  it('falls through to the booking offering when no item carries one', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [{ isBase: true, sortOrder: 0 }],
        bookingOfferingSwatch: '08',
        categorySwatch: '02',
      }),
    ).toBe('08')
  })

  it('falls through to the category default last', () => {
    expect(
      resolveCalendarSwatch({
        bookingOfferingSwatch: null,
        categorySwatch: '02',
      }),
    ).toBe('02')
  })

  // Booking.offeringId is nullable, so a booking legitimately reaches here with
  // no offering at all — it must resolve, not throw.
  it('resolves a booking with a null offering through its items', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [{ isBase: true, sortOrder: 0, offeringSwatch: '05' }],
        bookingOfferingSwatch: null,
      }),
    ).toBe('05')
  })

  it('falls THROUGH a stale value at one level instead of blanking the chain', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [{ isBase: true, sortOrder: 0, offeringSwatch: '99' }],
        bookingOfferingSwatch: '#ff0000',
        categorySwatch: '10',
      }),
    ).toBe('10')
  })

  it('returns null when every level holds an unparseable value', () => {
    expect(
      resolveCalendarSwatch({
        serviceItems: [{ isBase: true, sortOrder: 0, offeringSwatch: 'teal' }],
        bookingOfferingSwatch: 'rgb(0 0 0)',
        categorySwatch: '',
      }),
    ).toBeNull()
  })
})
