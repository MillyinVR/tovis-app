import { describe, expect, it } from 'vitest'
import { BookingServiceItemType } from '@prisma/client'
import { formatBookingServicesLabel } from './serviceLabel'

describe('formatBookingServicesLabel', () => {
  it('joins multiple co-equal BASE services with " + "', () => {
    expect(
      formatBookingServicesLabel([
        { name: 'Haircut', itemType: BookingServiceItemType.BASE },
        { name: 'Color', itemType: BookingServiceItemType.BASE },
      ]),
    ).toBe('Haircut + Color')
  })

  it('lists BASE services before ADD_ONs', () => {
    expect(
      formatBookingServicesLabel([
        { name: 'Haircut', itemType: BookingServiceItemType.BASE },
        { name: 'Toner', itemType: BookingServiceItemType.ADD_ON },
        { name: 'Color', itemType: BookingServiceItemType.BASE },
      ]),
    ).toBe('Haircut + Color + Toner')
  })

  it('treats string item types the same as the enum', () => {
    expect(
      formatBookingServicesLabel([
        { name: 'Haircut', itemType: 'BASE' },
        { name: 'Color', itemType: 'add_on' },
      ]),
    ).toBe('Haircut + Color')
  })

  it('returns a single service name unchanged', () => {
    expect(
      formatBookingServicesLabel([
        { name: 'Haircut', itemType: BookingServiceItemType.BASE },
      ]),
    ).toBe('Haircut')
  })

  it('skips blank names and trims', () => {
    expect(
      formatBookingServicesLabel([
        { name: '  Haircut ', itemType: BookingServiceItemType.BASE },
        { name: '   ', itemType: BookingServiceItemType.BASE },
        { name: null, itemType: BookingServiceItemType.BASE },
      ]),
    ).toBe('Haircut')
  })

  it('falls back to the provided primary name when no items are named', () => {
    expect(formatBookingServicesLabel([], 'Appointment with Pro')).toBe(
      'Appointment with Pro',
    )
    expect(
      formatBookingServicesLabel(
        [{ name: null, itemType: BookingServiceItemType.BASE }],
        'your appointment',
      ),
    ).toBe('your appointment')
  })

  it('falls back to a generic label when nothing else is available', () => {
    expect(formatBookingServicesLabel([])).toBe('Appointment')
    expect(formatBookingServicesLabel([], '   ')).toBe('Appointment')
  })
})
