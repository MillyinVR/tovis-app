import { describe, expect, it } from 'vitest'
import { BookingStatus } from '@prisma/client'

import { COPY } from '@/lib/copy'

import {
  clientStatusMessage,
  clientStatusPillLabel,
  clientStatusPillVariant,
} from './statusPresentation'

// New module (lifted out of a 1,700-line RSC), so "prove it red" is MUTATION
// testing: each decision it encodes is inverted in turn and its own case here
// is the one that fails. The three decisions are the three defects it fixes —
// the pill label, the pill tone, and the message for a state with no arm.

const ALL_STATUSES = Object.values(BookingStatus)

describe('clientStatusPillLabel', () => {
  it('never shows the client a database enum', () => {
    // All three status spots on this page rendered
    // `String(booking.status).toUpperCase()`. Prod had two live IN_PROGRESS
    // bookings when this was written, so two clients were reading
    // "IN_PROGRESS" on their own appointment.
    for (const status of ALL_STATUSES) {
      const label = clientStatusPillLabel(status)
      expect(label).not.toBe(status)
      expect(label).not.toContain('_')
      expect(label).not.toBe(label.toUpperCase())
    }
  })

  it('uses the canonical word for each state', () => {
    expect(clientStatusPillLabel(BookingStatus.PENDING)).toBe('Pending')
    expect(clientStatusPillLabel(BookingStatus.ACCEPTED)).toBe('Confirmed')
    expect(clientStatusPillLabel(BookingStatus.IN_PROGRESS)).toBe('In progress')
    expect(clientStatusPillLabel(BookingStatus.COMPLETED)).toBe('Completed')
    expect(clientStatusPillLabel(BookingStatus.CANCELLED)).toBe('Cancelled')
    expect(clientStatusPillLabel(BookingStatus.NO_SHOW)).toBe('No-show')
  })

  it('falls back to the copy contract when a booking has no status', () => {
    expect(clientStatusPillLabel(null)).toBe(COPY.bookings.status.pillUnknown)
    expect(clientStatusPillLabel('   ')).toBe(COPY.bookings.status.pillUnknown)
  })
})

describe('clientStatusPillVariant', () => {
  it('tints a missed appointment as a loss, not an FYI', () => {
    expect(clientStatusPillVariant(BookingStatus.NO_SHOW)).toBe('danger')
    expect(clientStatusPillVariant(BookingStatus.CANCELLED)).toBe('danger')
    expect(clientStatusPillVariant(BookingStatus.COMPLETED)).toBe('success')
    expect(clientStatusPillVariant(BookingStatus.PENDING)).toBe('warn')
    expect(clientStatusPillVariant(BookingStatus.ACCEPTED)).toBe('info')
    expect(clientStatusPillVariant(BookingStatus.IN_PROGRESS)).toBe('info')
  })
})

describe('clientStatusMessage', () => {
  it('gives every lifecycle state its own words', () => {
    // The old map stopped at CANCELLED, so IN_PROGRESS and NO_SHOW both got
    // the fallback. Asserting "not the fallback" is the real claim; the exact
    // copy is asserted through COPY so a reword doesn't fail the test.
    for (const status of ALL_STATUSES) {
      expect(clientStatusMessage(status).title).not.toBe(
        COPY.bookings.status.messages.fallback.title,
      )
    }
  })

  it('does not promise a no-show that updates are still coming', () => {
    const message = clientStatusMessage(BookingStatus.NO_SHOW)

    expect(message.title).toBe(COPY.bookings.status.messages.noShow.title)
    expect(message.variant).toBe('danger')
    // The fallback body is "We're tracking this booking. Status updates will
    // show here." — on a TERMINAL state that is simply untrue.
    expect(message.body).not.toContain('tracking')
  })

  it('tells a client with a live session what is happening', () => {
    const message = clientStatusMessage(BookingStatus.IN_PROGRESS)

    expect(message.title).toBe(COPY.bookings.status.messages.inProgress.title)
    expect(message.variant).toBe('info')
  })

  it('still falls back for an unrecognized value', () => {
    expect(clientStatusMessage('SOMETHING_ELSE').title).toBe(
      COPY.bookings.status.messages.fallback.title,
    )
    expect(clientStatusMessage(null).variant).toBe('neutral')
  })
})
