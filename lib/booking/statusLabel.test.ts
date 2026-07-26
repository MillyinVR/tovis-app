import { describe, expect, it } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'
import {
  badgeToneForBookingStatus,
  labelForBookingStatus,
} from './statusLabel'
import { buildLifecycleActionViewModel } from './lifecycleActionViewModel'
import { statusLabel as calendarStatusLabel } from '@/app/pro/calendar/_utils/statusStyles'

const ALL_STATUSES = Object.values(BookingStatus)

/**
 * The canonical words, written out HERE rather than imported, so this file can
 * be run verbatim against the pre-fix tree: importing the table would make the
 * whole suite fail to collect, which proves only that a new export is new
 * ([[ab-proof-needs-an-unchanged-seam]]). Every assertion below goes through a
 * function that already existed.
 */
const EXPECTED: Record<BookingStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
}

describe('labelForBookingStatus', () => {
  it('renders every status in sentence case', () => {
    expect(labelForBookingStatus(BookingStatus.PENDING)).toBe('Pending')
    // Tori's call 2026-07-26 (B10): ACCEPTED reads "Confirmed" everywhere. It
    // used to read "Accepted" here and "Confirmed" in the lifecycle view-model,
    // so one booking had two words depending on which card you looked at.
    expect(labelForBookingStatus(BookingStatus.ACCEPTED)).toBe('Confirmed')
    expect(labelForBookingStatus(BookingStatus.IN_PROGRESS)).toBe('In progress')
    expect(labelForBookingStatus(BookingStatus.COMPLETED)).toBe('Completed')
    expect(labelForBookingStatus(BookingStatus.CANCELLED)).toBe('Cancelled')
    expect(labelForBookingStatus(BookingStatus.NO_SHOW)).toBe('No-show')
  })

  it('never returns a raw SCREAMING_SNAKE value', () => {
    // The old default arm was `return status`, which is exactly how the client
    // booking page came to print "IN_PROGRESS" at a client (B10).
    expect(labelForBookingStatus('SOMETHING_ELSE')).toBe('Something else')
    for (const status of ALL_STATUSES) {
      expect(labelForBookingStatus(status)).not.toContain('_')
      expect(labelForBookingStatus(status)).not.toBe(status)
    }
  })

  it('normalizes casing and whitespace from the wire', () => {
    expect(labelForBookingStatus(' accepted ')).toBe('Confirmed')
    expect(labelForBookingStatus('')).toBe('')
  })
})

describe('the canonical table', () => {
  // Imported dynamically, INSIDE the test: a top-level import of an export the
  // pre-fix tree doesn't have makes the whole file fail to collect, and a suite
  // that cannot collect proves nothing about any individual assertion. This way
  // the same file runs verbatim on both trees and these two simply fail.
  it('covers every BookingStatus the schema defines', async () => {
    const { BOOKING_STATUS_LABELS } = await import('./statusLabel')

    // The Record<BookingStatus, string> type makes a missing status a compile
    // error; this pins it at runtime too, so a status added to the enum can't
    // reach a screen as a raw value while tsc is happy about a stale build.
    expect(Object.keys(BOOKING_STATUS_LABELS ?? {}).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    )
    expect(BOOKING_STATUS_LABELS).toEqual(EXPECTED)
  })

  it('tints a terminal miss like a terminal miss', async () => {
    const { variantForBookingStatus } = await import('./statusLabel')

    // The client booking page's own map had no NO_SHOW arm and returned its
    // `info` fallback, so the one screen a client reads a no-show on tinted it
    // exactly like a confirmed booking.
    expect(variantForBookingStatus?.(BookingStatus.NO_SHOW)).toBe('danger')
    expect(variantForBookingStatus?.(BookingStatus.CANCELLED)).toBe('danger')
    expect(variantForBookingStatus?.(BookingStatus.COMPLETED)).toBe('success')
    expect(variantForBookingStatus?.(BookingStatus.PENDING)).toBe('warn')
    expect(variantForBookingStatus?.(BookingStatus.ACCEPTED)).toBe('info')
    expect(variantForBookingStatus?.(BookingStatus.IN_PROGRESS)).toBe('info')
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

// ─── One spelling, every surface ─────────────────────────────────────────────
//
// The B10 finding was not one wrong word — it was SIX tables. This block asks
// each surviving label producer the same question and requires the same answer.

describe('every surface spells a status the same way', () => {
  for (const status of ALL_STATUSES) {
    it(`${status} reads "${EXPECTED[status]}" on the shared helper, the calendar meta and the lifecycle card`, () => {
      const expected = EXPECTED[status]

      expect(labelForBookingStatus(status)).toBe(expected)

      // The calendar's own meta helper (month grid, booking modal, management
      // modal) — it said "Accepted" and "No show" before this card.
      expect(calendarStatusLabel(status)).toBe(expected)

      // The client/pro booking action card. IN_PROGRESS is deliberately richer
      // there (it names the session step), so it is asserted separately below.
      if (status !== BookingStatus.IN_PROGRESS) {
        const vm = buildLifecycleActionViewModel({
          bookingId: 'bk_1',
          status,
          sessionStep: SessionStep.NONE,
          role: 'CLIENT',
        })
        expect(vm.displayLabel).toBe(expected)
      }
    })
  }

  it('keeps the lifecycle card’s session-step detail for IN_PROGRESS', () => {
    const vm = buildLifecycleActionViewModel({
      bookingId: 'bk_1',
      status: BookingStatus.IN_PROGRESS,
      sessionStep: SessionStep.SERVICE_IN_PROGRESS,
      role: 'PRO',
    })
    expect(vm.displayLabel).toBe('Service in progress')
  })
})
