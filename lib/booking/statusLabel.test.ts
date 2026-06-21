import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'
import { labelForBookingStatus } from './statusLabel'

describe('labelForBookingStatus', () => {
  it('renders every status in sentence case', () => {
    expect(labelForBookingStatus(BookingStatus.PENDING)).toBe('Pending')
    expect(labelForBookingStatus(BookingStatus.ACCEPTED)).toBe('Accepted')
    expect(labelForBookingStatus(BookingStatus.IN_PROGRESS)).toBe('In progress')
    expect(labelForBookingStatus(BookingStatus.COMPLETED)).toBe('Completed')
    expect(labelForBookingStatus(BookingStatus.CANCELLED)).toBe('Cancelled')
  })

  it('falls back to the raw value for unknown input', () => {
    expect(labelForBookingStatus('SOMETHING_ELSE')).toBe('SOMETHING_ELSE')
  })
})
