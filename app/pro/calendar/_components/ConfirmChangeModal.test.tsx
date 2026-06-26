// app/pro/calendar/_components/ConfirmChangeModal.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ConfirmChangeModal } from './ConfirmChangeModal'

import type {
  BookingCalendarEvent,
  PendingMoveChange,
} from '../_types'

const bookingEvent: BookingCalendarEvent = {
  id: 'booking_1',
  kind: 'BOOKING',
  status: 'CONFIRMED',
  startsAt: '2026-06-13T01:00:00.000Z',
  endsAt: '2026-06-13T02:00:00.000Z',
  title: 'Silk press',
  clientName: 'Amara Lewis',
  locationId: 'loc_1',
  locationType: 'SALON',
  // The appointment takes place in Pacific time.
  timeZone: 'America/Los_Angeles',
  timeZoneSource: 'BOOKING_SNAPSHOT',
  localDateKey: '2026-06-12',
  details: {
    serviceName: 'Silk press',
    bufferMinutes: 0,
    serviceItems: [],
  },
}

function moveChange(): PendingMoveChange {
  return {
    kind: 'move',
    entityType: 'booking',
    eventId: bookingEvent.id,
    apiId: 'b1',
    // 02:30 UTC = 19:30 (7:30 PM) on Jun 12 in America/Los_Angeles (PDT, UTC-7).
    // In UTC this instant is 02:30 AM on Jun 13 — the wrong day.
    nextStartIso: '2026-06-13T02:30:00.000Z',
    original: bookingEvent,
  }
}

describe('ConfirmChangeModal', () => {
  it('renders the new start time in the booking appointment timezone, not UTC', () => {
    render(
      <ConfirmChangeModal
        open
        change={moveChange()}
        applying={false}
        overrideReason=""
        onChangeOverrideReason={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    // Pacific-time render: evening of Jun 12, not 2:30 AM Jun 13 (UTC).
    expect(screen.getByText(/Jun 12, 2026/)).toBeTruthy()
    expect(screen.getByText(/7:30\s?PM/)).toBeTruthy()
    expect(screen.queryByText(/Jun 13/)).toBeNull()
    expect(screen.queryByText(/2:30\s?AM/)).toBeNull()
  })
})
