// app/client/bookings/[id]/ClientBookingActionsCard.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import BookingActions from './BookingActions'
import AvailabilityDrawer from '@/app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer'
import { safeJson } from '@/lib/http'

import type {
  BookingSource,
  DrawerContext,
  ServiceLocationType,
} from '@/app/(main)/booking/AvailabilityDrawer/types'

type BookingLocationType = 'SALON' | 'MOBILE' | null

type HoldSelection = {
  holdId: string
  offeringId: string
  locationType: ServiceLocationType
  slotISO: string
  bookingSource: BookingSource
  mediaId: string | null
}

type Props = {
  bookingId: string
  status: unknown
  scheduledFor: string
  durationMinutesSnapshot?: number | null
  appointmentTz?: string | null
  locationType?: BookingLocationType
  drawerContext: DrawerContext
}

function errorFromResponse(res: Response, data: unknown) {
  const rec =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : null

  if (typeof rec?.error === 'string' && rec.error.trim()) return rec.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You do not have access to do that.'
  if (res.status === 404) return 'That booking could not be found.'
  if (res.status === 409) {
    return typeof rec?.error === 'string'
      ? rec.error
      : 'That time is no longer available.'
  }
  return `Request failed (${res.status}).`
}

export default function ClientBookingActionsCard({
  bookingId,
  status,
  scheduledFor,
  durationMinutesSnapshot,
  appointmentTz,
  locationType,
  drawerContext,
}: Props) {
  const router = useRouter()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedHold, setSelectedHold] = useState<HoldSelection | null>(null)

  async function handleConfirmHold(selection: HoldSelection) {
    setSelectedHold(selection)
    setDrawerOpen(false)
  }

  async function handleConfirmReschedule() {
    if (!selectedHold?.holdId) {
      throw new Error(
        'Choose a new available time before rescheduling this booking.',
      )
    }

    if (!selectedHold.locationType) {
      throw new Error('Missing booking location type for reschedule.')
    }

    const res = await fetch(
      `/api/bookings/${encodeURIComponent(bookingId)}/reschedule`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          holdId: selectedHold.holdId,
          locationType: selectedHold.locationType,
        }),
      },
    )

    const data = await safeJson(res)
    if (!res.ok) {
      throw new Error(errorFromResponse(res, data))
    }

    setSelectedHold(null)
    router.refresh()
  }

  return (
    <>
      <BookingActions
        bookingId={bookingId}
        status={status}
        scheduledFor={scheduledFor}
        durationMinutesSnapshot={durationMinutesSnapshot}
        appointmentTz={appointmentTz}
        locationType={selectedHold?.locationType ?? locationType ?? null}
        rescheduleHoldId={selectedHold?.holdId ?? null}
        onRequestReschedule={() => {
          setSelectedHold(null)
          setDrawerOpen(true)
        }}
        onConfirmReschedule={handleConfirmReschedule}
      />

      <AvailabilityDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false)
        }}
        context={drawerContext}
        onConfirmHold={handleConfirmHold}
      />
    </>
  )
}