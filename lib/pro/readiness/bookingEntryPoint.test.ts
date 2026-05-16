import { describe, expect, it } from 'vitest'
import { BookingSource } from '@prisma/client'

import {
  bookingEntryPointFromBookingSource,
  bookingEntryPointFromSource,
  parseBookingEntryPointSource,
} from './bookingEntryPoint'

describe('bookingEntryPoint', () => {
  describe('parseBookingEntryPointSource', () => {
    it('parses known entry point source values', () => {
      expect(parseBookingEntryPointSource('BROAD_DISCOVERY')).toBe(
        'BROAD_DISCOVERY',
      )
      expect(parseBookingEntryPointSource('SPECIFIC_SEARCH')).toBe(
        'SPECIFIC_SEARCH',
      )
      expect(parseBookingEntryPointSource('DIRECT_PROFILE')).toBe(
        'DIRECT_PROFILE',
      )
      expect(parseBookingEntryPointSource('NFC_CARD')).toBe('NFC_CARD')
      expect(parseBookingEntryPointSource('SHORT_CODE')).toBe('SHORT_CODE')
      expect(parseBookingEntryPointSource('QR_CODE')).toBe('QR_CODE')
      expect(parseBookingEntryPointSource('AFTERCARE_REBOOK')).toBe(
        'AFTERCARE_REBOOK',
      )
      expect(parseBookingEntryPointSource('SALON_WHITE_LABEL')).toBe(
        'SALON_WHITE_LABEL',
      )
      expect(parseBookingEntryPointSource('PRO_CREATED')).toBe('PRO_CREATED')
    })

    it('normalizes casing and whitespace', () => {
      expect(parseBookingEntryPointSource(' direct_profile ')).toBe(
        'DIRECT_PROFILE',
      )
    })

    it('returns null for unknown values', () => {
      expect(parseBookingEntryPointSource('banana')).toBeNull()
      expect(parseBookingEntryPointSource(null)).toBeNull()
      expect(parseBookingEntryPointSource(undefined)).toBeNull()
      expect(parseBookingEntryPointSource(123)).toBeNull()
    })
  })

  describe('bookingEntryPointFromSource', () => {
    it('passes through ProBookingEntryPoint-compatible values', () => {
      expect(bookingEntryPointFromSource('BROAD_DISCOVERY')).toBe(
        'BROAD_DISCOVERY',
      )
      expect(bookingEntryPointFromSource('SPECIFIC_SEARCH')).toBe(
        'SPECIFIC_SEARCH',
      )
      expect(bookingEntryPointFromSource('DIRECT_PROFILE')).toBe(
        'DIRECT_PROFILE',
      )
      expect(bookingEntryPointFromSource('NFC_CARD')).toBe('NFC_CARD')
      expect(bookingEntryPointFromSource('SHORT_CODE')).toBe('SHORT_CODE')
      expect(bookingEntryPointFromSource('QR_CODE')).toBe('QR_CODE')
      expect(bookingEntryPointFromSource('PRO_CREATED')).toBe('PRO_CREATED')
    })

    it('maps intentional non-discovery paths to direct profile readiness', () => {
      expect(bookingEntryPointFromSource('AFTERCARE_REBOOK')).toBe(
        'DIRECT_PROFILE',
      )
      expect(bookingEntryPointFromSource('SALON_WHITE_LABEL')).toBe(
        'DIRECT_PROFILE',
      )
    })

    it('defaults missing source to broad discovery', () => {
      expect(bookingEntryPointFromSource(null)).toBe('BROAD_DISCOVERY')
      expect(bookingEntryPointFromSource(undefined)).toBe('BROAD_DISCOVERY')
    })
  })

  describe('bookingEntryPointFromBookingSource', () => {
    it('maps discovery bookings to broad discovery readiness', () => {
      expect(bookingEntryPointFromBookingSource(BookingSource.DISCOVERY)).toBe(
        'BROAD_DISCOVERY',
      )
    })

    it('maps requested bookings to direct profile readiness', () => {
      expect(bookingEntryPointFromBookingSource(BookingSource.REQUESTED)).toBe(
        'DIRECT_PROFILE',
      )
    })

    it('maps aftercare bookings to intentional direct readiness', () => {
      expect(bookingEntryPointFromBookingSource(BookingSource.AFTERCARE)).toBe(
        'DIRECT_PROFILE',
      )
    })
  })
})