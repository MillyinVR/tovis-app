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
  OVERLAP_FALLBACK_NAME,
  OVERLAP_HOLD_NAME,
} from '@/lib/calendar/constants'
import { hasOverlap } from '@/lib/calendar/overlap'
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
import {
  HoldOverlapDecisionRequiredError,
  readHoldOverlapDecision,
  type HeldSlotDecision,
} from '@/lib/booking/holdOverlapPrompt'

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
  /** The pro's answer to the live-hold decision — see holdOverlapPrompt.ts. */
  confirmHoldOverlap?: true
}

type BlockPatchPayload = {
  startsAt: string
  endsAt: string
}

type ChangeOverrideState = {
  prompt: BookingOverridePrompt
  flags: BookingOverrideFlag[]
}

/**
 * An open live-hold decision, plus WHICH attempt raised it. A change can meet
 * the hold on the plain confirm or on an override retry, and "book it anyway"
 * has to re-run the same one — re-running the plain confirm after an override
 * retry would drop the flags and simply ask the override question again.
 */
type PendingHoldOverlapDecision = {
  decision: HeldSlotDecision
  from: 'confirm' | 'override'
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
  /**
   * Only ever true on a retry the pro explicitly asked for. Folded into the
   * payload here (rather than added at one call site) so it also reaches the
   * idempotency key, which is hashed from the payload — the confirming retry
   * has to look like the different logical request it is.
   */
  confirmHoldOverlap?: boolean
}): BookingPatchPayload {
  const { change, context, outsideWorkingHours, overrideReason } = args

  const payload: BookingPatchPayload = {
    notifyClient: true,
  }

  if (args.confirmHoldOverlap) {
    payload.confirmHoldOverlap = true
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
  return `/api/v1/pro/bookings/${encodeURIComponent(bookingId)}`
}

/**
 * Deterministic per (booking, exact payload): a double-click of the confirm
 * button replays the first response, while any body change — a different
 * target time, or an override retry that adds flags — mints a fresh key
 * (same key ⇒ same body, or the ledger 409s).
 */
function buildProBookingPatchIdempotencyKey(
  bookingId: string,
  payload: BookingPatchPayload,
): string {
  return buildClientIdempotencyKey({
    scope: 'pro-calendar-change',
    entityId: bookingId,
    action: 'apply',
    nonce: JSON.stringify(payload),
  })
}

function blockEndpoint(blockId: string) {
  return `/api/v1/pro/calendar/blocked/${encodeURIComponent(blockId)}`
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
    Object.assign(headers, idempotencyHeaders(args.idempotencyKey))
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
      // Checked before the override prompt: the two are different KINDS of
      // answer, and only one of them is about somebody else's money.
      const heldSlot = readHoldOverlapDecision(data)

      if (heldSlot) {
        throw new HoldOverlapDecisionRequiredError(message, heldSlot)
      }

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

  // B5 follow-up: the pro dragged an appointment onto minutes a client is
  // paying for. `holdOverlapDecision` is the open question; `holdOverlapAnswer`
  // is the answer, kept separately so it survives the dialog closing and rides
  // an override retry that happens afterwards.
  const [holdOverlapDecision, setHoldOverlapDecision] =
    useState<PendingHoldOverlapDecision | null>(null)
  const [holdOverlapAnswer, setHoldOverlapAnswer] = useState(false)

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
    // The answer applied to ONE slot on ONE change. It must not survive into
    // the next drag, which would book over a checkout nobody was shown.
    setHoldOverlapDecision(null)
    setHoldOverlapAnswer(false)
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

  // Passive double-book note for the confirm: the client the proposed new time
  // overlaps, if any (the server still allows a pro overlap — this only surfaces
  // it). Blocks and the moved booking itself are skipped.
  const pendingOverlapName = useMemo(() => {
    if (!pendingChange || pendingChange.entityType !== 'booking' || !bookingContext) {
      return null
    }

    const startIso =
      pendingChange.kind === 'move'
        ? snappedMoveStartIso({ change: pendingChange, context: bookingContext }) ??
          pendingChange.nextStartIso
        : pendingChange.original.startsAt

    const durationMinutes =
      pendingChange.kind === 'resize'
        ? Number(pendingChange.nextTotalDurationMinutes)
        : eventDurationMinutes(pendingChange.original)

    const start = new Date(startIso)

    if (!Number.isFinite(start.getTime()) || !(durationMinutes > 0)) return null

    const end = new Date(start.getTime() + durationMinutes * 60_000)

    for (const candidate of eventsRef.current) {
      // Blocks are the pro's own time and stay skipped. HOLDS are NOT skipped:
      // a live client checkout is exactly the collision this note exists to
      // surface, and before B5 it could not appear here at all — the feed sent
      // no hold events, so this loop was structurally blind to them while the
      // server happily authorized the overlap. [[reserving-a-slot-needs-a-surface]]
      if (candidate.kind === 'BLOCK') continue
      if (candidate.id === pendingChange.eventId) continue

      if (
        hasOverlap(
          { startsAt: start, endsAt: end },
          { startsAt: candidate.startsAt, endsAt: candidate.endsAt },
        )
      ) {
        // A hold never names the client behind it, so it gets its own phrase
        // rather than leaking the fixed 'Held' label into the sentence (B5).
        if (candidate.kind === 'HOLD') return OVERLAP_HOLD_NAME

        return candidate.clientName?.trim() || OVERLAP_FALLBACK_NAME
      }
    }

    return null
  }, [bookingContext, eventsRef, pendingChange])

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

  const runConfirm = useCallback(
    async (options: { confirmHoldOverlap: boolean }) => {
      if (!pendingChange || applyingChange) return

      setApplyingChange(true)

      let mutationSucceeded = false

      try {
        if (pendingChange.entityType === 'booking') {
          if (!bookingContext) {
            throw new Error('Missing booking scheduling context.')
          }

          const reason = overrideReason.trim()

          const payload = buildBookingPatchPayload({
            change: pendingChange,
            context: bookingContext,
            outsideWorkingHours: pendingOutsideWorkingHours,
            overrideReason: reason,
            confirmHoldOverlap: options.confirmHoldOverlap,
          })

          await patchJson({
            idempotencyKey: buildProBookingPatchIdempotencyKey(
              pendingChange.apiId,
              payload,
            ),
            url: bookingEndpoint(pendingChange.apiId),
            payload,
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
        // A client is mid-checkout on the minutes this change lands on. Same
        // handling as an override: keep the pending change and its optimistic
        // event position, close the confirm, and ask.
        if (caught instanceof HoldOverlapDecisionRequiredError) {
          setConfirmOpen(false)
          setHoldOverlapDecision({ decision: caught.decision, from: 'confirm' })
          return
        }

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
    },
    [
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
    ],
  )

  /**
   * The confirm button's handler. Parameterless on purpose: it is wired
   * straight to `onClick`, which would otherwise hand a MouseEvent to the
   * options argument.
   */
  const applyConfirm = useCallback(
    () => runConfirm({ confirmHoldOverlap: holdOverlapAnswer }),
    [holdOverlapAnswer, runConfirm],
  )

  const cancelChangeOverride = useCallback(() => {
    if (applyingChange) return

    rollbackChange(pendingChange)
    clearConfirmState()
  }, [applyingChange, clearConfirmState, pendingChange, rollbackChange])

  const runChangeOverride = useCallback(
    async (options: { confirmHoldOverlap: boolean }) => {
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
          // An override retry must not silently drop an answer the pro already
          // gave: a change can trip BOTH rules, and re-asking about the same
          // checkout would be the popup appearing twice for one drag.
          confirmHoldOverlap: options.confirmHoldOverlap,
        })

        for (const flag of changeOverride.flags) {
          payload[flag] = true
        }

        if (reason) {
          payload.overrideReason = reason
        }

        await patchJson({
          idempotencyKey: buildProBookingPatchIdempotencyKey(
            pendingChange.apiId,
            payload,
          ),
          url: bookingEndpoint(pendingChange.apiId),
          payload,
          fallbackError: 'Failed to apply changes.',
          overrideGated: true,
        })

        clearConfirmState()

        await reloadCalendar()
        forceProFooterRefresh()
      } catch (caught) {
        // The override retry can be the attempt that first meets the hold — the
        // scheduling rules are checked before the overlap policy.
        if (caught instanceof HoldOverlapDecisionRequiredError) {
          setHoldOverlapDecision({ decision: caught.decision, from: 'override' })
          return
        }

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
    },
    [
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
    ],
  )

  const confirmChangeOverride = useCallback(
    () => runChangeOverride({ confirmHoldOverlap: holdOverlapAnswer }),
    [holdOverlapAnswer, runChangeOverride],
  )

  /**
   * The pro chose to take the slot. Remember the answer, close the dialog, and
   * re-run whichever attempt raised it — the override retry when one is in
   * flight, the plain confirm otherwise. The answer is set BEFORE the retry and
   * read from state by both, so the re-run carries it.
   */
  const proceedOverHold = useCallback(() => {
    if (applyingChange || !holdOverlapDecision) return

    const from = holdOverlapDecision.from

    setHoldOverlapAnswer(true)
    setHoldOverlapDecision(null)

    // Passed explicitly rather than read back off state: `setHoldOverlapAnswer`
    // above is not visible to this call, and the retry would ask the same
    // question forever. The state write is for any LATER retry in the same
    // change (an override prompt raised after this one).
    if (from === 'override') {
      void runChangeOverride({ confirmHoldOverlap: true })
      return
    }

    void runConfirm({ confirmHoldOverlap: true })
  }, [applyingChange, holdOverlapDecision, runChangeOverride, runConfirm])

  /**
   * The pro chose to leave the client to it. The change is abandoned and the
   * optimistic event snaps back — nothing to persist, exactly as if they had
   * dragged it back themselves.
   */
  const waitForHold = useCallback(() => {
    if (applyingChange) return

    rollbackChange(pendingChange)
    clearConfirmState()
  }, [applyingChange, clearConfirmState, pendingChange, rollbackChange])

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
    pendingOverlapName,
    overrideReason,
    setOverrideReason,

    changeOverridePrompt: changeOverride?.prompt ?? null,
    changeOverrideReason,
    setChangeOverrideReason,
    confirmChangeOverride,
    cancelChangeOverride,

    holdOverlapDecision: holdOverlapDecision?.decision ?? null,
    proceedOverHold,
    waitForHold,
  }
}

export type ConfirmChangeState = ReturnType<typeof useConfirmChange>