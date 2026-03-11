// lib/booking/conflictLogging.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  logBookingConflict,
  type BookingConflictLogArgs,
} from './conflictLogging'

describe('logBookingConflict', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs a stable structured JSON payload', () => {
    const args: BookingConflictLogArgs = {
      action: 'BLOCK_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      locationType: 'SALON',
      requestedStart: new Date('2026-03-11T17:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T18:00:00.000Z'),
      conflictType: 'BOOKING',
      bookingId: 'booking_1',
      holdId: null,
      blockId: 'block_1',
      note: 'Lunch break',
      meta: {
        source: 'test',
        conflictingBookingId: 'booking_conflict_1',
      },
    }

    logBookingConflict(args)

    expect(warnSpy).toHaveBeenCalledTimes(1)

    const firstArg = warnSpy.mock.calls[0]?.[0]
    expect(typeof firstArg).toBe('string')

    const parsed: unknown = JSON.parse(String(firstArg))
    expect(parsed).toEqual(
      expect.objectContaining({
        event: 'booking_conflict',
        action: 'BLOCK_CREATE',
        professionalId: 'pro_123',
        locationId: 'loc_1',
        locationType: 'SALON',
        requestedStart: '2026-03-11T17:00:00.000Z',
        requestedEnd: '2026-03-11T18:00:00.000Z',
        conflictType: 'BOOKING',
        bookingId: 'booking_1',
        holdId: null,
        blockId: 'block_1',
        note: 'Lunch break',
        meta: {
          source: 'test',
          conflictingBookingId: 'booking_conflict_1',
        },
      }),
    )

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'loggedAt' in parsed &&
      typeof parsed.loggedAt === 'string'
    ) {
      expect(Number.isNaN(Date.parse(parsed.loggedAt))).toBe(false)
    } else {
      throw new Error('Expected loggedAt to be a string')
    }
  })

  it('normalizes optional fields to null', () => {
    const args: BookingConflictLogArgs = {
      action: 'BLOCK_UPDATE',
      professionalId: 'pro_456',
      locationId: null,
      requestedStart: new Date('2026-03-12T10:00:00.000Z'),
      requestedEnd: new Date('2026-03-12T11:00:00.000Z'),
      conflictType: 'HOLD',
    }

    logBookingConflict(args)

    expect(warnSpy).toHaveBeenCalledTimes(1)

    const firstArg = warnSpy.mock.calls[0]?.[0]
    const parsed: unknown = JSON.parse(String(firstArg))

    expect(parsed).toEqual(
      expect.objectContaining({
        event: 'booking_conflict',
        action: 'BLOCK_UPDATE',
        professionalId: 'pro_456',
        locationId: null,
        locationType: null,
        requestedStart: '2026-03-12T10:00:00.000Z',
        requestedEnd: '2026-03-12T11:00:00.000Z',
        conflictType: 'HOLD',
        bookingId: null,
        holdId: null,
        blockId: null,
        note: null,
        meta: null,
      }),
    )
  })

  it('writes null request timestamps when invalid Date objects are passed', () => {
    const args: BookingConflictLogArgs = {
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_789',
      locationId: 'loc_9',
      requestedStart: new Date('invalid'),
      requestedEnd: new Date('invalid'),
      conflictType: 'UNKNOWN',
    }

    logBookingConflict(args)

    expect(warnSpy).toHaveBeenCalledTimes(1)

    const firstArg = warnSpy.mock.calls[0]?.[0]
    const parsed: unknown = JSON.parse(String(firstArg))

    expect(parsed).toEqual(
      expect.objectContaining({
        requestedStart: null,
        requestedEnd: null,
        conflictType: 'UNKNOWN',
      }),
    )
  })
})