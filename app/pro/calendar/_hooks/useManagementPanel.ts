// app/pro/calendar/_hooks/useManagementPanel.ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import type {
  BookingCalendarStatus,
  CalendarEvent,
  ManagementKey,
  ManagementLists,
} from '../_types'

import { apiMessage } from '../_utils/parsers'
import { safeJson, errorMessageFromUnknown } from '@/lib/http'

// ─── Types ────────────────────────────────────────────────────────────────────

type ManagementPanelDeps = {
  eventsRef: RefObject<CalendarEvent[]>
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void

  /**
   * Bridge until management action copy moves fully into BrandProCalendarCopy.
   */
  copy?: Partial<ManagementPanelCopy>
}

type ManagementPanelCopy = {
  failedUpdateMessage: string
}

type BookingStatusUpdate = Extract<
  BookingCalendarStatus,
  'ACCEPTED' | 'CANCELLED'
>

type SetBookingStatusArgs = {
  bookingId: string
  status: BookingStatusUpdate
}

type BookingPatchPayload = {
  status: BookingStatusUpdate
  notifyClient: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_ERROR_VISIBLE_MS = 3500

const DEFAULT_COPY: ManagementPanelCopy = {
  failedUpdateMessage: 'Failed to update booking.',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function emptyManagementLists(): ManagementLists {
  return {
    todaysBookings: [],
    pendingRequests: [],
    waitlistToday: [],
    blockedToday: [],
  }
}

function resolveCopy(
  copy: Partial<ManagementPanelCopy> | undefined,
): ManagementPanelCopy {
  return {
    ...DEFAULT_COPY,
    ...copy,
  }
}

function normalizeStatus(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function bookingAlreadyHasStatus(args: {
  events: CalendarEvent[]
  bookingId: string
  status: BookingStatusUpdate
}): boolean {
  const event = args.events.find((entry) => entry.id === args.bookingId)

  if (!event) return false

  return normalizeStatus(event.status) === args.status
}

function isNoChangesMessage(message: string): boolean {
  return message.toLowerCase().includes('no changes provided')
}

function bookingPatchEndpoint(bookingId: string): string {
  return `/api/pro/bookings/${encodeURIComponent(bookingId)}`
}

function bookingStatusPayload(status: BookingStatusUpdate): BookingPatchPayload {
  return {
    status,
    notifyClient: true,
  }
}

async function patchBookingStatus(args: {
  bookingId: string
  status: BookingStatusUpdate
  fallbackErrorMessage: string
}): Promise<void> {
  const idempotencyKey =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pro-booking-status-${args.bookingId}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`

  const response = await fetch(bookingPatchEndpoint(args.bookingId), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(bookingStatusPayload(args.status)),
  })

  const data: unknown = await safeJson(response)

  if (!response.ok) {
    throw new Error(apiMessage(data, args.fallbackErrorMessage))
  }
}

// ─── Exported hook ────────────────────────────────────────────────────────────

export function useManagementPanel(deps: ManagementPanelDeps) {
  const {
    eventsRef,
    reloadCalendar,
    forceProFooterRefresh,
    copy: copyOverride,
  } = deps

  const copy = resolveCopy(copyOverride)

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

  const clearActionErrorTimer = useCallback((): void => {
    if (errorTimeoutRef.current === null) return

    window.clearTimeout(errorTimeoutRef.current)
    errorTimeoutRef.current = null
  }, [])

  const showActionError = useCallback(
    (message: string): void => {
      clearActionErrorTimer()
      setManagementActionError(message)

      errorTimeoutRef.current = window.setTimeout(() => {
        setManagementActionError(null)
        errorTimeoutRef.current = null
      }, ACTION_ERROR_VISIBLE_MS)
    },
    [clearActionErrorTimer],
  )

  const setBusyId = useCallback((bookingId: string | null): void => {
    busyIdRef.current = bookingId
    setManagementActionBusyId(bookingId)
  }, [])

  const refreshAfterAction = useCallback(async (): Promise<void> => {
    await reloadCalendar()
    forceProFooterRefresh()
  }, [forceProFooterRefresh, reloadCalendar])

  const openManagement = useCallback((key: ManagementKey): void => {
    setManagementKey(key)
    setManagementOpen(true)
  }, [])

  const closeManagement = useCallback((): void => {
    setManagementOpen(false)
  }, [])

  const setBookingStatusById = useCallback(
    async (args: SetBookingStatusArgs): Promise<void> => {
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
          fallbackErrorMessage: copy.failedUpdateMessage,
        })

        await refreshAfterAction()
      } catch (caught) {
        const message = errorMessageFromUnknown(
          caught,
          copy.failedUpdateMessage,
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
      copy.failedUpdateMessage,
      eventsRef,
      refreshAfterAction,
      setBusyId,
      showActionError,
    ],
  )

  const approveBookingById = useCallback(
    async (bookingId: string): Promise<void> => {
      await setBookingStatusById({
        bookingId,
        status: 'ACCEPTED',
      })
    },
    [setBookingStatusById],
  )

  const denyBookingById = useCallback(
    async (bookingId: string): Promise<void> => {
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