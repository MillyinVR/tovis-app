// app/client/bookings/[id]/ClientBookingActionsCard.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import BookingActions from './BookingActions'
import AvailabilityDrawer from '@/app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer'
import { errorFromResponse, safeJson } from '@/lib/http'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

import type {
  ClientBookingSource,
  DrawerContext,
  ServiceLocationType,
} from '@/app/(main)/booking/AvailabilityDrawer/types'

const STATUS_COPY = {
  401: 'Please log in again.',
  403: 'You do not have access to do that.',
  404: 'That booking could not be found.',
  409: 'That time is no longer available.',
}

type BookingLocationType = 'SALON' | 'MOBILE' | null

type HoldSelection = {
  holdId: string
  offeringId: string
  locationType: ServiceLocationType
  slotISO: string
  bookingSource: ClientBookingSource
  mediaId: string | null
}

type Props = {
  bookingId: string
  status: unknown
  sessionStep?: string | null
  scheduledFor: string
  durationMinutesSnapshot?: number | null
  appointmentTz?: string | null
  locationType?: BookingLocationType
  hasAftercareLink?: boolean
  drawerContext: DrawerContext
}

export default function ClientBookingActionsCard({
  bookingId,
  status,
  sessionStep,
  scheduledFor,
  durationMinutesSnapshot,
  appointmentTz,
  locationType,
  hasAftercareLink,
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

    const bodyJson = JSON.stringify({
      holdId: selectedHold.holdId,
      locationType: selectedHold.locationType,
    })

    // The reschedule route runs through withRouteIdempotency and 400s without
    // a key — this call sent none, so client reschedule was dead. Keyed to the
    // chosen hold: a double-click replays, picking a different time re-keys.
    const idempotencyKey = buildClientIdempotencyKey({
      scope: 'booking-lifecycle',
      entityId: bookingId,
      action: 'CLIENT_RESCHEDULE',
      nonce: bodyJson,
    })

    const res = await fetch(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}/reschedule`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...idempotencyHeaders(idempotencyKey),
        },
        body: bodyJson,
      },
    )

    const data = await safeJson(res)
    if (!res.ok) {
      throw new Error(errorFromResponse(res, data, { byStatus: STATUS_COPY }))
    }

    setSelectedHold(null)
    router.refresh()
  }

  return (
    <>
      <BookingActions
        bookingId={bookingId}
        status={status}
        sessionStep={sessionStep ?? null}
        scheduledFor={scheduledFor}
        durationMinutesSnapshot={durationMinutesSnapshot}
        appointmentTz={appointmentTz}
        locationType={selectedHold?.locationType ?? locationType ?? null}
        rescheduleHoldId={selectedHold?.holdId ?? null}
        hasAftercareLink={hasAftercareLink}
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