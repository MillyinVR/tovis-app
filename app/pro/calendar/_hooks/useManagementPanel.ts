// app/pro/calendar/_hooks/useManagementPanel.ts
'use client'

import { useRef, useState } from 'react'
import type { CalendarEvent, ManagementKey, ManagementLists } from '../_types'
import { apiMessage } from '../_utils/parsers'
import { safeJson, errorMessageFromUnknown } from '@/lib/http'

type ManagementPanelDeps = {
  eventsRef: React.RefObject<CalendarEvent[]>
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void
}

export function useManagementPanel(deps: ManagementPanelDeps) {
  const [management, setManagement] = useState<ManagementLists>({
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  })
  const [managementOpen, setManagementOpen] = useState(false)
  const [managementKey, setManagementKey] = useState<ManagementKey>('todaysBookings')

  const [managementActionBusyId, setManagementActionBusyId] = useState<string | null>(null)
  const [managementActionError, setManagementActionError] = useState<string | null>(null)

  function openManagement(key: ManagementKey) {
    setManagementKey(key)
    setManagementOpen(true)
  }

  function closeManagement() {
    setManagementOpen(false)
  }

  async function setBookingStatusById(args: {
    bookingId: string
    status: 'ACCEPTED' | 'CANCELLED'
  }) {
    const { bookingId, status } = args
    if (!bookingId) return
    if (managementActionBusyId) return

    setManagementActionBusyId(bookingId)
    setManagementActionError(null)

    const current = deps.eventsRef.current.find((x) => x.id === bookingId)
    const currentStatus = current ? String(current.status || '').toUpperCase() : ''
    if (currentStatus && currentStatus === status) {
      setManagementActionBusyId(null)
      return
    }

    try {
      const res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notifyClient: true }),
      })

      const data: unknown = await safeJson(res)

      if (!res.ok) {
        const msg = apiMessage(data, 'Failed to update booking.')

        if (msg.toLowerCase().includes('no changes provided')) {
          await deps.reloadCalendar()
          deps.forceProFooterRefresh()
          return
        }

        throw new Error(msg)
      }

      await deps.reloadCalendar()
      deps.forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      setManagementActionError(errorMessageFromUnknown(e))
      window.setTimeout(() => setManagementActionError(null), 3500)
    } finally {
      setManagementActionBusyId(null)
    }
  }

  async function approveBookingById(bookingId: string) {
    return setBookingStatusById({ bookingId, status: 'ACCEPTED' })
  }

  async function denyBookingById(bookingId: string) {
    return setBookingStatusById({ bookingId, status: 'CANCELLED' })
  }

  return {
    management,
    setManagement,
    managementOpen,
    managementKey,
    setManagementKey,
    openManagement,
    closeManagement,
    managementActionBusyId,
    managementActionError,
    approveBookingById,
    denyBookingById,
  }
}

export type ManagementPanelState = ReturnType<typeof useManagementPanel>
