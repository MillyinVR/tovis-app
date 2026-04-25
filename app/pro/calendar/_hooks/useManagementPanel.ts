// app/pro/calendar/_hooks/useManagementPanel.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import type { CalendarEvent, ManagementKey, ManagementLists } from '../_types'

import { apiMessage } from '../_utils/parsers'
import { safeJson, errorMessageFromUnknown } from '@/lib/http'

type ManagementPanelDeps = {
  eventsRef: RefObject<CalendarEvent[]>
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void
}

type BookingStatusUpdate = 'ACCEPTED' | 'CANCELLED'

type SetBookingStatusArgs = {
  bookingId: string
  status: BookingStatusUpdate
}

const ACTION_ERROR_VISIBLE_MS = 3500

function emptyManagementLists(): ManagementLists {
  return {
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  }
}

function normalizeStatus(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function bookingAlreadyHasStatus(args: {
  events: CalendarEvent[]
  bookingId: string
  status: BookingStatusUpdate
}) {
  const event = args.events.find((entry) => entry.id === args.bookingId)
  if (!event) return false

  return normalizeStatus(event.status) === args.status
}

function isNoChangesMessage(message: string) {
  return message.toLowerCase().includes('no changes provided')
}

function bookingPatchEndpoint(bookingId: string) {
  return `/api/pro/bookings/${encodeURIComponent(bookingId)}`
}

async function patchBookingStatus(args: SetBookingStatusArgs) {
  const response = await fetch(bookingPatchEndpoint(args.bookingId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: args.status,
      notifyClient: true,
    }),
  })

  const data: unknown = await safeJson(response)

  if (!response.ok) {
    throw new Error(apiMessage(data, 'Failed to update booking.'))
  }
}

export function useManagementPanel(deps: ManagementPanelDeps) {
  const { eventsRef, reloadCalendar, forceProFooterRefresh } = deps

  const [management, setManagement] = useState<ManagementLists>(
    emptyManagementLists,
  )
  const [managementOpen, setManagementOpen] = useState(false)
  const [managementKey, setManagementKey] =
    useState<ManagementKey>('todaysBookings')

  const [managementActionBusyId, setManagementActionBusyId] =
    useState<string | null>(null)
  const [managementActionError, setManagementActionError] =
    useState<string | null>(null)

  const busyIdRef = useRef<string | null>(null)
  const errorTimeoutRef = useRef<number | null>(null)

  const clearActionErrorTimer = useCallback(() => {
    if (errorTimeoutRef.current === null) return

    window.clearTimeout(errorTimeoutRef.current)
    errorTimeoutRef.current = null
  }, [])

  const showActionError = useCallback(
    (message: string) => {
      clearActionErrorTimer()
      setManagementActionError(message)

      errorTimeoutRef.current = window.setTimeout(() => {
        setManagementActionError(null)
        errorTimeoutRef.current = null
      }, ACTION_ERROR_VISIBLE_MS)
    },
    [clearActionErrorTimer],
  )

  const setBusyId = useCallback((bookingId: string | null) => {
    busyIdRef.current = bookingId
    setManagementActionBusyId(bookingId)
  }, [])

  const refreshAfterAction = useCallback(async () => {
    await reloadCalendar()
    forceProFooterRefresh()
  }, [forceProFooterRefresh, reloadCalendar])

  const openManagement = useCallback((key: ManagementKey) => {
    setManagementKey(key)
    setManagementOpen(true)
  }, [])

  const closeManagement = useCallback(() => {
    setManagementOpen(false)
  }, [])

  const setBookingStatusById = useCallback(
    async (args: SetBookingStatusArgs) => {
      const bookingId = args.bookingId.trim()
      if (!bookingId) return

      if (busyIdRef.current !== null) return

      if (
        bookingAlreadyHasStatus({
          events: eventsRef.current,
          bookingId,
          status: args.status,
        })
      ) {
        await refreshAfterAction()
        return
      }

      setBusyId(bookingId)
      clearActionErrorTimer()
      setManagementActionError(null)

      try {
        await patchBookingStatus({
          bookingId,
          status: args.status,
        })

        await refreshAfterAction()
      } catch (caught) {
        const message = errorMessageFromUnknown(
          caught,
          'Failed to update booking.',
        )

        if (isNoChangesMessage(message)) {
          await refreshAfterAction()
          return
        }

        showActionError(message)
      } finally {
        setBusyId(null)
      }
    },
    [
      clearActionErrorTimer,
      eventsRef,
      refreshAfterAction,
      setBusyId,
      showActionError,
    ],
  )

  const approveBookingById = useCallback(
    async (bookingId: string) => {
      await setBookingStatusById({
        bookingId,
        status: 'ACCEPTED',
      })
    },
    [setBookingStatusById],
  )

  const denyBookingById = useCallback(
    async (bookingId: string) => {
      await setBookingStatusById({
        bookingId,
        status: 'CANCELLED',
      })
    },
    [setBookingStatusById],
  )

  useEffect(() => {
    return () => clearActionErrorTimer()
  }, [clearActionErrorTimer])

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