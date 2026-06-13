// app/pro/calendar/_components/PendingRequestSurface.test.tsx
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { PendingRequestSurface } from './PendingRequestSurface'

import type { BrandProCalendarPendingRequestCopy } from '@/lib/brand/types'

import type { BookingCalendarEvent } from '../_types'

const copy: BrandProCalendarPendingRequestCopy = {
  label: '◆ Pending request',
  clientFallback: 'Client',
  appointmentFallback: 'Appointment',
  moreSuffix: 'more',
  openAllLabel: 'Open all pending requests',
  openRequestsLabel: 'Open pending booking requests',
  approveLabel: 'Approve pending booking',
  denyLabel: 'Deny pending booking',
  dismissLabel: 'Hide pending requests bar',
}

const pendingBooking: BookingCalendarEvent = {
  id: 'booking_1',
  kind: 'BOOKING',
  status: 'PENDING',
  startsAt: '2026-06-12T15:00:00.000Z',
  endsAt: '2026-06-12T16:00:00.000Z',
  title: 'Silk press',
  clientName: 'Amara Lewis',
  locationId: 'loc_1',
  locationType: 'SALON',
  timeZone: 'America/New_York',
  timeZoneSource: 'BOOKING_SNAPSHOT',
  localDateKey: '2026-06-12',
  details: {
    serviceName: 'Silk press',
    bufferMinutes: 0,
    serviceItems: [],
  },
}

function renderSurface(
  overrides?: Partial<React.ComponentProps<typeof PendingRequestSurface>>,
) {
  return render(
    <PendingRequestSurface
      copy={copy}
      event={pendingBooking}
      pendingCount={1}
      busy={false}
      error={null}
      variant="mobile"
      onOpenAll={vi.fn()}
      onApprove={vi.fn()}
      onDeny={vi.fn()}
      {...overrides}
    />,
  )
}

describe('PendingRequestSurface', () => {
  it('renders nothing when there is no pending booking event', () => {
    const { container } = renderSurface({ event: undefined })

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the pending count is zero', () => {
    const { container } = renderSurface({ pendingCount: 0 })

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the top request with overflow count and fires approve/deny', () => {
    const onApprove = vi.fn()
    const onDeny = vi.fn()

    renderSurface({ pendingCount: 3, onApprove, onDeny })

    expect(screen.getByText('Amara Lewis — Silk press + 2 more')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: copy.approveLabel }))
    fireEvent.click(screen.getByRole('button', { name: copy.denyLabel }))

    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onDeny).toHaveBeenCalledTimes(1)
  })

  it('does not render a dismiss button without an onDismiss handler', () => {
    renderSurface()

    expect(
      screen.queryByRole('button', { name: copy.dismissLabel }),
    ).toBeNull()
  })

  it('fires onDismiss without opening the request list', () => {
    const onDismiss = vi.fn()
    const onOpenAll = vi.fn()

    renderSurface({ onDismiss, onOpenAll })

    fireEvent.click(screen.getByRole('button', { name: copy.dismissLabel }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onOpenAll).not.toHaveBeenCalled()
  })
})
