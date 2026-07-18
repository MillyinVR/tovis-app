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
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

import {
  BookingOverrideRequiredError,
  mergeBookingOverrideFlags,
  readBookingOverridePrompt,
  type BookingOverrideFlag,
  type BookingOverridePrompt,
} from '@/lib/booking/overridePrompts'

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
  allowShortNotice?: boolean
  allowFarFuture?: boolean
  allowOutsideWorkingHours?: boolean
  overrideReason?: string
}

type ManagementOverrideState = {
  bookingId: string
  prompt: BookingOverridePrompt
  flags: BookingOverrideFlag[]
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
  return `/api/v1/pro/bookings/${encodeURIComponent(bookingId)}`
}

async function patchBookingStatus(args: {
  bookingId: string
  payload: BookingPatchPayload
  fallbackErrorMessage: string
}): Promise<void> {
  // Deterministic per (booking, status, exact payload): a double-click
  // replays the first response; an override retry (added flags) changes the
  // body and so mints a fresh key.
  const idempotencyKey = buildClientIdempotencyKey({
    scope: 'pro-calendar-management',
    entityId: args.bookingId,
    action: args.payload.status,
    nonce: JSON.stringify(args.payload),
  })

  const response = await fetch(bookingPatchEndpoint(args.bookingId), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...idempotencyHeaders(idempotencyKey),
    },
    body: JSON.stringify(args.payload),
  })

  const data: unknown = await safeJson(response)

  if (!response.ok) {
    const message = apiMessage(data, args.fallbackErrorMessage)
    const overridePrompt = readBookingOverridePrompt(data)

    if (overridePrompt) {
      throw new BookingOverrideRequiredError(message, overridePrompt)
    }

    throw new Error(message)
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

  const [managementOverride, setManagementOverride] =
    useState<ManagementOverrideState | null>(null)

  const [managementOverrideReason, setManagementOverrideReason] = useState('')

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
          payload: {
            status: args.status,
            notifyClient: true,
          },
          fallbackErrorMessage: copy.failedUpdateMessage,
        })

        await refreshAfterAction()
      } catch (caught) {
        if (
          caught instanceof BookingOverrideRequiredError &&
          args.status === 'ACCEPTED'
        ) {
          setManagementOverride({
            bookingId,
            prompt: caught.prompt,
            flags: [caught.prompt.flag],
          })
          setManagementOverrideReason('')
          return
        }

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

  const cancelManagementOverride = useCallback((): void => {
    if (busyIdRef.current !== null) return

    setManagementOverride(null)
    setManagementOverrideReason('')
  }, [])

  const confirmManagementOverride = useCallback(async (): Promise<void> => {
    if (!managementOverride) return
    if (busyIdRef.current !== null) return

    const reason = managementOverrideReason.trim()

    setBusyId(managementOverride.bookingId)
    clearActionErrorTimer()
    setManagementActionError(null)

    try {
      const payload: BookingPatchPayload = {
        status: 'ACCEPTED',
        notifyClient: true,
        ...(reason ? { overrideReason: reason } : {}),
      }

      for (const flag of managementOverride.flags) {
        payload[flag] = true
      }

      await patchBookingStatus({
        bookingId: managementOverride.bookingId,
        payload,
        fallbackErrorMessage: copy.failedUpdateMessage,
      })

      setManagementOverride(null)
      setManagementOverrideReason('')
      await refreshAfterAction()
    } catch (caught) {
      if (caught instanceof BookingOverrideRequiredError) {
        // The retry can trip another override-gated rule. Keep the dialog
        // open and accumulate the new flag so the next confirm covers both.
        const prompt = caught.prompt

        setManagementOverride((previous) =>
          previous
            ? {
                ...previous,
                prompt,
                flags: mergeBookingOverrideFlags(previous.flags, prompt.flag),
              }
            : previous,
        )
      } else {
        setManagementOverride(null)
        setManagementOverrideReason('')
        showActionError(
          errorMessageFromUnknown(caught, copy.failedUpdateMessage),
        )
      }
    } finally {
      setBusyId(null)
    }
  }, [
    clearActionErrorTimer,
    copy.failedUpdateMessage,
    managementOverride,
    managementOverrideReason,
    refreshAfterAction,
    setBusyId,
    showActionError,
  ])

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

    managementOverridePrompt: managementOverride?.prompt ?? null,
    managementOverrideBusy: managementActionBusyId !== null,
    managementOverrideReason,
    setManagementOverrideReason,
    confirmManagementOverride,
    cancelManagementOverride,
  }
}

export type ManagementPanelState = ReturnType<typeof useManagementPanel>