import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BookingModal } from './BookingModal'
import type { BookingDetails } from '../_types'

// R4: the reschedule day grid must count OPEN SLOTS for the booking being
// moved, which means the modal has to hand the shared AvailabilityCalendar a
// slot context built from the booking — its BASE service, its location, and its
// own id as `rescheduleBookingId`. This drives the real component and asserts
// the request the calendar actually issues, because that request is the whole
// contract: a wrong/absent param silently degrades to the busy-only overlay
// with no error anywhere ([[green-tests-wrong-artifact]]).

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const BOOKING: BookingDetails = {
  id: 'bk_42',
  status: 'ACCEPTED',
  scheduledFor: '2099-09-10T18:00:00.000Z',
  endsAt: '2099-09-10T21:00:00.000Z',
  locationId: 'loc_7',
  locationType: 'SALON',
  totalDurationMinutes: 180,
  client: { fullName: 'Test Client', email: null, phone: null },
  timeZone: 'America/Los_Angeles',
  serviceItems: [
    {
      id: 'si_1',
      serviceId: 'svc_base',
      offeringId: 'off_1',
      itemType: 'BASE',
      serviceName: 'Balayage',
      priceSnapshot: '180.00',
      durationMinutesSnapshot: 180,
      sortOrder: 0,
    },
    {
      id: 'si_2',
      serviceId: 'svc_addon',
      offeringId: 'off_2',
      itemType: 'ADD_ON',
      serviceName: 'Toner',
      priceSnapshot: '20.00',
      durationMinutesSnapshot: 20,
      sortOrder: 1,
    },
  ],
}

function renderModal(booking: BookingDetails | null) {
  return render(
    <BookingModal
      open
      loading={false}
      error={null}
      booking={booking}
      services={[]}
      appointmentTimeZone="America/Los_Angeles"
      selectedDraftServiceIds={[]}
      reschedDate="2099-09-10"
      reschedTime="11:00"
      durationMinutes={180}
      notifyClient={false}
      allowOutsideHours={false}
      editOutside={false}
      saving={false}
      onClose={vi.fn()}
      onChangeReschedDate={vi.fn()}
      onChangeReschedTime={vi.fn()}
      onChangeSelectedDraftServiceIds={vi.fn()}
      onToggleNotifyClient={vi.fn()}
      onToggleAllowOutsideHours={vi.fn()}
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onDeny={vi.fn()}
    />,
  )
}

describe('BookingModal — R4 reschedule slot context', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('counts open slots for the booking being moved', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          tz: 'America/Los_Angeles',
          days: { '2099-09-11': { bookings: 0, blocked: false, openSlots: 5 } },
          openSlots: { computed: true, durationMinutes: 180, reason: null },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderModal(BOOKING)

    await waitFor(() => {
      const called = fetchMock.mock.calls.map((c) => String(c[0]))
      expect(called.some((u) => u.includes('busy-days'))).toBe(true)
    })

    const url = decodeURIComponent(
      String(
        fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('busy-days')),
      ),
    )

    // The BASE service — not the add-on, and not an unsaved draft.
    expect(url).toContain('serviceId=svc_base')
    expect(url).not.toContain('svc_addon')
    expect(url).toContain('locationType=SALON')
    expect(url).toContain('locationId=loc_7')
    // Without this the booking blocks its OWN day and the grid under-reports.
    expect(url).toContain('rescheduleBookingId=bk_42')

    await waitFor(() =>
      expect(screen.getByText('11').closest('button')).toHaveAttribute(
        'title',
        '5 open times',
      ),
    )
  })

  it('asks for no counts when the booking has not loaded yet', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(jsonResponse({ ok: true, tz: 'UTC', days: {}, openSlots: null })),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderModal(null)

    // No booking → no calendar at all, so nothing may be requested for it.
    await new Promise((r) => setTimeout(r, 50))
    const called = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(called.filter((u) => u.includes('serviceId='))).toHaveLength(0)
  })
})
