// app/pro/calendar/_hooks/useConfirmChange.ts
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

import type {
  CalendarEvent,
  PendingChange,
  WorkingHoursJson,
} from '../_types'

import {
  computeDurationMinutesFromIso,
  isOutsideWorkingHours,
  roundDurationMinutes,
  snapMinutes,
} from '../_utils/calendarMath'

import {
  apiMessage,
  locationTypeFromBookingValue,
  type LocationType,
} from '../_utils/parsers'

import { anchorDayLocalNoon } from '../_utils/calendarRange'

import {
  DEFAULT_TIME_ZONE,
  getZonedParts,
  sanitizeTimeZone,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'

import { errorMessageFromUnknown, safeJson } from '@/lib/http'

import {
  BookingOverrideRequiredError,
  mergeBookingOverrideFlags,
  readBookingOverridePrompt,
  type BookingOverrideFlag,
  type BookingOverridePrompt,
} from '@/lib/booking/overridePrompts'

type ConfirmChangeDeps = {
  eventsRef: RefObject<CalendarEvent[]>
  setEvents: Dispatch<SetStateAction<CalendarEvent[]>>
  resolveBookingSchedulingContext: (args: {
    locationId: string | null
    locationType: LocationType
    fallbackTimeZone: string
  }) => {
    timeZone: string
    workingHours: WorkingHoursJson
    stepMinutes: number
  }
  timeZoneRef: RefObject<string>
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void
  setError: (error: string | null) => void
}

type BookingSchedulingContext = {
  timeZone: string
  workingHours: WorkingHoursJson
  stepMinutes: number
}

type BookingPatchPayload = {
  notifyClient: true
  durationMinutes?: number
  scheduledFor?: string
  allowShortNotice?: boolean
  allowFarFuture?: boolean
  allowOutsideWorkingHours?: boolean
  overrideReason?: string
}

type BlockPatchPayload = {
  startsAt: string
  endsAt: string
}

type ChangeOverrideState = {
  prompt: BookingOverridePrompt
  flags: BookingOverrideFlag[]
}

const TEMPORARY_ERROR_MS = 3500

function eventDurationMinutes(event: CalendarEvent) {
  if (
    typeof event.durationMinutes === 'number' &&
    Number.isFinite(event.durationMinutes) &&
    event.durationMinutes > 0
  ) {
    return event.durationMinutes
  }

  return computeDurationMinutesFromIso(event.startsAt, event.endsAt)
}

function validDateFromIso(iso: string, errorMessage: string) {
  const date = new Date(iso)

  if (!Number.isFinite(date.getTime())) {
    throw new Error(errorMessage)
  }

  return date
}

function bookingContextForChange(args: {
  change: PendingChange
  fallbackTimeZone: string
  resolveBookingSchedulingContext: ConfirmChangeDeps['resolveBookingSchedulingContext']
}): BookingSchedulingContext | null {
  const { change, fallbackTimeZone, resolveBookingSchedulingContext } = args

  if (change.entityType !== 'booking') return null
  if (change.original.kind !== 'BOOKING') return null

  return resolveBookingSchedulingContext({
    locationId: change.original.locationId ?? null,
    locationType: locationTypeFromBookingValue(change.original.locationType),
    fallbackTimeZone: sanitizeTimeZone(fallbackTimeZone, DEFAULT_TIME_ZONE),
  })
}

function snappedMoveStartIso(args: {
  change: PendingChange
  context: BookingSchedulingContext
}) {
  const { change, context } = args

  if (change.kind !== 'move') return null

  const nextStartUtc = validDateFromIso(
    change.nextStartIso,
    'Invalid start time.',
  )

  const parts = getZonedParts(nextStartUtc, context.timeZone)
  const rawStartMinutes = parts.hour * 60 + parts.minute
  const snappedStartMinutes = snapMinutes(
    rawStartMinutes,
    context.stepMinutes,
  )

  const dayAnchor = anchorDayLocalNoon(parts.year, parts.month, parts.day)

  return utcFromDayAndMinutesInTimeZone(
    dayAnchor,
    snappedStartMinutes,
    context.timeZone,
  ).toISOString()
}

function bookingChangeOutsideWorkingHours(args: {
  change: PendingChange
  context: BookingSchedulingContext
}) {
  const { change, context } = args

  const originalDuration = eventDurationMinutes(change.original)

  const nextStartIso =
    change.kind === 'move'
      ? snappedMoveStartIso({ change, context }) ?? change.nextStartIso
      : change.original.startsAt

  const nextDuration =
    change.kind === 'resize'
      ? Number(change.nextTotalDurationMinutes || originalDuration)
      : Number(originalDuration)

  const startUtc = validDateFromIso(nextStartIso, 'Invalid start time.')
  const zonedParts = getZonedParts(startUtc, context.timeZone)
  const startMinutes = zonedParts.hour * 60 + zonedParts.minute
  const durationMinutes = roundDurationMinutes(
    nextDuration,
    context.stepMinutes,
  )
  const endMinutes = startMinutes + durationMinutes

  const dayAnchor = anchorDayLocalNoon(
    zonedParts.year,
    zonedParts.month,
    zonedParts.day,
  )

  return isOutsideWorkingHours({
    day: dayAnchor,
    startMinutes,
    endMinutes,
    workingHours: context.workingHours,
    timeZone: context.timeZone,
  })
}

function buildBookingPatchPayload(args: {
  change: PendingChange
  context: BookingSchedulingContext
  outsideWorkingHours: boolean
  overrideReason: string
}): BookingPatchPayload {
  const { change, context, outsideWorkingHours, overrideReason } = args

  const payload: BookingPatchPayload = {
    notifyClient: true,
  }

  if (change.kind === 'resize') {
    payload.durationMinutes = roundDurationMinutes(
      Number(change.nextTotalDurationMinutes),
      context.stepMinutes,
    )
  } else {
    payload.scheduledFor =
      snappedMoveStartIso({ change, context }) ?? change.nextStartIso
  }

  if (outsideWorkingHours) {
    payload.allowOutsideWorkingHours = true

    const trimmedOverrideReason = overrideReason.trim()
    if (trimmedOverrideReason) {
      payload.overrideReason = trimmedOverrideReason
    }
  }

  return payload
}

function buildBlockPatchPayload(args: {
  change: PendingChange
  currentEvent: CalendarEvent | undefined
}) {
  const { change, currentEvent } = args

  const startIso =
    change.kind === 'move'
      ? change.nextStartIso
      : currentEvent?.startsAt ?? change.original.startsAt

  const durationMinutes =
    change.kind === 'resize'
      ? Number(change.nextTotalDurationMinutes)
      : eventDurationMinutes(change.original)

  const start = validDateFromIso(startIso, 'Invalid block start time.')
  const end = new Date(start.getTime() + durationMinutes * 60_000)

  if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    throw new Error('Invalid block end time.')
  }

  const payload: BlockPatchPayload = {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  }

  return payload
}

function bookingEndpoint(bookingId: string) {
  return `/api/pro/bookings/${encodeURIComponent(bookingId)}`
}

function buildProBookingPatchIdempotencyKey(bookingId: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pro-booking-patch-${bookingId}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`
}

function blockEndpoint(blockId: string) {
  return `/api/pro/calendar/blocked/${encodeURIComponent(blockId)}`
}

async function patchJson(args: {
  idempotencyKey?: string
  url: string
  payload: BookingPatchPayload | BlockPatchPayload
  fallbackError: string
  overrideGated?: boolean
}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (args.idempotencyKey) {
    headers['Idempotency-Key'] = args.idempotencyKey
    headers['x-idempotency-key'] = args.idempotencyKey
  }

  const response = await fetch(args.url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(args.payload),
  })

  const data: unknown = await safeJson(response)

  if (!response.ok) {
    const message = apiMessage(data, args.fallbackError)

    if (args.overrideGated) {
      const overridePrompt = readBookingOverridePrompt(data, 'edit')

      if (overridePrompt) {
        throw new BookingOverrideRequiredError(message, overridePrompt)
      }
    }

    throw new Error(message)
  }
}

export function useConfirmChange(deps: ConfirmChangeDeps) {
  const {
    eventsRef,
    setEvents,
    resolveBookingSchedulingContext,
    timeZoneRef,
    reloadCalendar,
    forceProFooterRefresh,
    setError,
  } = deps

  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applyingChange, setApplyingChange] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')

  const [changeOverride, setChangeOverride] =
    useState<ChangeOverrideState | null>(null)
  const [changeOverrideReason, setChangeOverrideReason] = useState('')

  const errorTokenRef = useRef(0)
  const errorTimeoutRef = useRef<number | null>(null)

  const clearTemporaryErrorTimer = useCallback(() => {
    if (errorTimeoutRef.current === null) return

    window.clearTimeout(errorTimeoutRef.current)
    errorTimeoutRef.current = null
  }, [])

  const showTemporaryError = useCallback(
    (message: string) => {
      errorTokenRef.current += 1
      const token = errorTokenRef.current

      clearTemporaryErrorTimer()
      setError(message)

      errorTimeoutRef.current = window.setTimeout(() => {
        if (errorTokenRef.current !== token) return

        setError(null)
        errorTimeoutRef.current = null
      }, TEMPORARY_ERROR_MS)
    },
    [clearTemporaryErrorTimer, setError],
  )

  const clearConfirmState = useCallback(() => {
    setConfirmOpen(false)
    setPendingChange(null)
    setOverrideReason('')
    setChangeOverride(null)
    setChangeOverrideReason('')
  }, [])

  const rollbackChange = useCallback(
    (change: PendingChange | null) => {
      if (!change) return

      setEvents((previousEvents) =>
        previousEvents.map((event) =>
          event.id === change.eventId ? change.original : event,
        ),
      )
    },
    [setEvents],
  )

  const bookingContext = useMemo(() => {
    if (!pendingChange) return null

    return bookingContextForChange({
      change: pendingChange,
      fallbackTimeZone: timeZoneRef.current,
      resolveBookingSchedulingContext,
    })
  }, [pendingChange, resolveBookingSchedulingContext, timeZoneRef])

  const pendingOutsideWorkingHours = useMemo(() => {
    if (!pendingChange || !bookingContext) return false

    try {
      return bookingChangeOutsideWorkingHours({
        change: pendingChange,
        context: bookingContext,
      })
    } catch {
      return false
    }
  }, [bookingContext, pendingChange])

  const openConfirm = useCallback((change: PendingChange) => {
    setOverrideReason('')
    setPendingChange(change)
    setConfirmOpen(true)
  }, [])

  const cancelConfirm = useCallback(() => {
    if (applyingChange) return

    rollbackChange(pendingChange)
    clearConfirmState()
  }, [applyingChange, clearConfirmState, pendingChange, rollbackChange])

  const applyConfirm = useCallback(async () => {
    if (!pendingChange || applyingChange) return

    setApplyingChange(true)

    let mutationSucceeded = false

    try {
      if (pendingChange.entityType === 'booking') {
        if (!bookingContext) {
          throw new Error('Missing booking scheduling context.')
        }

        const reason = overrideReason.trim()

        await patchJson({
          idempotencyKey: buildProBookingPatchIdempotencyKey(pendingChange.apiId),
          url: bookingEndpoint(pendingChange.apiId),
          payload: buildBookingPatchPayload({
            change: pendingChange,
            context: bookingContext,
            outsideWorkingHours: pendingOutsideWorkingHours,
            overrideReason: reason,
          }),
          fallbackError: 'Failed to apply changes.',
          overrideGated: true,
        })
      } else {
        const currentEvent = eventsRef.current.find(
          (event) => event.id === pendingChange.eventId,
        )

        await patchJson({
          url: blockEndpoint(pendingChange.apiId),
          payload: buildBlockPatchPayload({
            change: pendingChange,
            currentEvent,
          }),
          fallbackError: 'Failed to apply changes.',
        })
      }

      mutationSucceeded = true
      clearConfirmState()

      await reloadCalendar()
      forceProFooterRefresh()
    } catch (caught) {
      if (caught instanceof BookingOverrideRequiredError) {
        // Keep the pending change (and its optimistic event position) so the
        // override confirm can retry the same mutation with explicit flags.
        setConfirmOpen(false)
        setChangeOverride({
          prompt: caught.prompt,
          flags: [caught.prompt.flag],
        })
        setChangeOverrideReason('')
        return
      }

      if (!mutationSucceeded) {
        rollbackChange(pendingChange)
        clearConfirmState()
      }

      showTemporaryError(errorMessageFromUnknown(caught))
    } finally {
      setApplyingChange(false)
    }
  }, [
    applyingChange,
    bookingContext,
    clearConfirmState,
    eventsRef,
    forceProFooterRefresh,
    overrideReason,
    pendingChange,
    pendingOutsideWorkingHours,
    reloadCalendar,
    rollbackChange,
    showTemporaryError,
  ])

  const cancelChangeOverride = useCallback(() => {
    if (applyingChange) return

    rollbackChange(pendingChange)
    clearConfirmState()
  }, [applyingChange, clearConfirmState, pendingChange, rollbackChange])

  const confirmChangeOverride = useCallback(async () => {
    if (!pendingChange || !changeOverride || applyingChange) return

    const reason = changeOverrideReason.trim()

    setApplyingChange(true)

    try {
      if (!bookingContext) {
        throw new Error('Missing booking scheduling context.')
      }

      const payload = buildBookingPatchPayload({
        change: pendingChange,
        context: bookingContext,
        outsideWorkingHours: pendingOutsideWorkingHours,
        overrideReason: reason,
      })

      for (const flag of changeOverride.flags) {
        payload[flag] = true
      }

      if (reason) {
        payload.overrideReason = reason
      }

      await patchJson({
        idempotencyKey: buildProBookingPatchIdempotencyKey(pendingChange.apiId),
        url: bookingEndpoint(pendingChange.apiId),
        payload,
        fallbackError: 'Failed to apply changes.',
        overrideGated: true,
      })

      clearConfirmState()

      await reloadCalendar()
      forceProFooterRefresh()
    } catch (caught) {
      if (caught instanceof BookingOverrideRequiredError) {
        // The retry can trip another override-gated rule. Keep the dialog
        // open and accumulate the new flag so the next confirm covers both.
        const prompt = caught.prompt

        setChangeOverride((previous) => ({
          prompt,
          flags: mergeBookingOverrideFlags(previous?.flags ?? [], prompt.flag),
        }))
      } else {
        rollbackChange(pendingChange)
        clearConfirmState()
        showTemporaryError(errorMessageFromUnknown(caught))
      }
    } finally {
      setApplyingChange(false)
    }
  }, [
    applyingChange,
    bookingContext,
    changeOverride,
    changeOverrideReason,
    clearConfirmState,
    forceProFooterRefresh,
    pendingChange,
    pendingOutsideWorkingHours,
    reloadCalendar,
    rollbackChange,
    showTemporaryError,
  ])

  useEffect(() => {
    return () => clearTemporaryErrorTimer()
  }, [clearTemporaryErrorTimer])

  return {
    pendingChange,
    confirmOpen,
    applyingChange,

    openConfirm,
    cancelConfirm,
    applyConfirm,

    pendingOutsideWorkingHours,
    overrideReason,
    setOverrideReason,

    changeOverridePrompt: changeOverride?.prompt ?? null,
    changeOverrideReason,
    setChangeOverrideReason,
    confirmChangeOverride,
    cancelChangeOverride,
  }
}

export type ConfirmChangeState = ReturnType<typeof useConfirmChange>