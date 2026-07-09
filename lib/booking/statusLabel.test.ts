import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'
import {
  badgeToneForBookingStatus,
  labelForBookingStatus,
} from './statusLabel'

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

describe('badgeToneForBookingStatus', () => {
  it('maps each status to its canonical Badge tone', () => {
    expect(badgeToneForBookingStatus(BookingStatus.ACCEPTED)).toBe('accent')
    expect(badgeToneForBookingStatus(BookingStatus.IN_PROGRESS)).toBe('accent')
    expect(badgeToneForBookingStatus(BookingStatus.COMPLETED)).toBe('success')
    expect(badgeToneForBookingStatus(BookingStatus.CANCELLED)).toBe('danger')
    expect(badgeToneForBookingStatus(BookingStatus.NO_SHOW)).toBe('danger')
    expect(badgeToneForBookingStatus(BookingStatus.PENDING)).toBe('pending')
  })

  it('falls back to neutral for unknown input', () => {
    expect(badgeToneForBookingStatus('SOMETHING_ELSE')).toBe('neutral')
  })
})
