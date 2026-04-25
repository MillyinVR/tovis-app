// app/pro/calendar/_hooks/useDragDrop.ts
'use client'

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type DragEvent,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { CalendarEvent, EntityType, PendingChange } from '../_types'

import {
  PX_PER_MINUTE,
  MAX_DURATION,
  computeDurationMinutesFromIso,
  extractBlockId,
  isBlockedEvent,
  normalizeStepMinutes,
  roundDurationMinutes,
  snapMinutes,
} from '../_utils/calendarMath'

import { clamp } from '../_utils/date'

import {
  DEFAULT_TIME_ZONE,
  sanitizeTimeZone,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'

type DragDropDeps = {
  eventsRef: RefObject<CalendarEvent[]>
  setEvents: Dispatch<SetStateAction<CalendarEvent[]>>
  resolveEventSchedulingContext: (event: CalendarEvent) => {
    timeZone: string
    stepMinutes: number
  }
  activeStepMinutes: number
  openConfirm: (change: PendingChange) => void
}

type ResizeState = {
  entityType: EntityType
  eventId: string
  apiId: string
  day: Date
  startMinutes: number
  originalDuration: number
  columnTop: number
  stepMinutes: number
  timeZone: string
  originalEvent: CalendarEvent
}

type EventSchedulingContext = {
  timeZone: string
  stepMinutes: number
}

const TOTAL_MINUTES_IN_DAY = 24 * 60
const SUPPRESS_CLICK_MS = 250

function useLatestRef<T>(value: T) {
  const ref = useRef(value)

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref
}

function eventEntityType(event: CalendarEvent): EntityType {
  return isBlockedEvent(event) ? 'block' : 'booking'
}

function eventApiId(event: CalendarEvent) {
  return isBlockedEvent(event) ? extractBlockId(event) : event.id
}

function rawEventDurationMinutes(event: CalendarEvent) {
  if (
    typeof event.durationMinutes === 'number' &&
    Number.isFinite(event.durationMinutes) &&
    event.durationMinutes > 0
  ) {
    return event.durationMinutes
  }

  return computeDurationMinutesFromIso(event.startsAt, event.endsAt)
}

function normalizeDurationMinutes(args: {
  rawDurationMinutes: number
  stepMinutes: number
  maxDurationMinutes?: number
}) {
  const stepMinutes = normalizeStepMinutes(args.stepMinutes)
  const roundedDuration = roundDurationMinutes(
    args.rawDurationMinutes,
    stepMinutes,
  )

  const maxDuration = args.maxDurationMinutes
    ? Math.max(stepMinutes, args.maxDurationMinutes)
    : MAX_DURATION

  return clamp(roundedDuration, stepMinutes, maxDuration)
}

function eventDurationMinutes(args: {
  event: CalendarEvent
  stepMinutes: number
}) {
  return normalizeDurationMinutes({
    rawDurationMinutes: rawEventDurationMinutes(args.event),
    stepMinutes: args.stepMinutes,
  })
}

function eventWithTiming(args: {
  event: CalendarEvent
  startsAt: string
  endsAt: string
  durationMinutes: number
}): CalendarEvent {
  return {
    ...args.event,
    startsAt: args.startsAt,
    endsAt: args.endsAt,
    durationMinutes: args.durationMinutes,
  }
}

function safeSchedulingContext(args: {
  event: CalendarEvent
  resolveEventSchedulingContext: (event: CalendarEvent) => EventSchedulingContext
  fallbackStepMinutes: number
}) {
  const context = args.resolveEventSchedulingContext(args.event)

  return {
    timeZone: sanitizeTimeZone(context.timeZone, DEFAULT_TIME_ZONE),
    stepMinutes: normalizeStepMinutes(
      context.stepMinutes ?? args.fallbackStepMinutes,
    ),
  }
}

function startMinutesFromPointer(args: {
  clientY: number
  columnTop: number
  grabOffsetMinutes: number
  stepMinutes: number
  durationMinutes: number
}) {
  const rawMinutes =
    (args.clientY - args.columnTop) / PX_PER_MINUTE - args.grabOffsetMinutes

  const snappedMinutes = snapMinutes(rawMinutes, args.stepMinutes)
  const maxStartMinutes = Math.max(
    0,
    TOTAL_MINUTES_IN_DAY - args.durationMinutes,
  )

  return clamp(snappedMinutes, 0, maxStartMinutes)
}

function resizeDurationFromPointer(args: {
  clientY: number
  columnTop: number
  startMinutes: number
  stepMinutes: number
}) {
  const rawEndMinutes = (args.clientY - args.columnTop) / PX_PER_MINUTE
  const snappedEndMinutes = snapMinutes(rawEndMinutes, args.stepMinutes)
  const rawDuration = snappedEndMinutes - args.startMinutes
  const maxDurationByDay = Math.max(
    args.stepMinutes,
    TOTAL_MINUTES_IN_DAY - args.startMinutes,
  )

  return normalizeDurationMinutes({
    rawDurationMinutes: rawDuration,
    stepMinutes: args.stepMinutes,
    maxDurationMinutes: Math.min(MAX_DURATION, maxDurationByDay),
  })
}

function clearTimer(timerRef: React.MutableRefObject<number | null>) {
  if (timerRef.current === null) return

  window.clearTimeout(timerRef.current)
  timerRef.current = null
}

export function useDragDrop(deps: DragDropDeps) {
  const eventsRefRef = useLatestRef(deps.eventsRef)
  const setEventsRef = useLatestRef(deps.setEvents)
  const resolveEventSchedulingContextRef = useLatestRef(
    deps.resolveEventSchedulingContext,
  )
  const activeStepMinutesRef = useLatestRef(deps.activeStepMinutes)
  const openConfirmRef = useLatestRef(deps.openConfirm)

  const dragEventIdRef = useRef<string | null>(null)
  const dragApiIdRef = useRef<string | null>(null)
  const dragEntityTypeRef = useRef<EntityType>('booking')
  const dragOriginalEventRef = useRef<CalendarEvent | null>(null)
  const dragGrabOffsetMinutesRef = useRef(0)

  const resizingRef = useRef<ResizeState | null>(null)

  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)

  const suppressClickBriefly = useCallback(() => {
    suppressClickRef.current = true
    clearTimer(suppressClickTimerRef)

    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false
      suppressClickTimerRef.current = null
    }, SUPPRESS_CLICK_MS)
  }, [])

  const clearDragState = useCallback(() => {
    dragEventIdRef.current = null
    dragApiIdRef.current = null
    dragOriginalEventRef.current = null
    dragGrabOffsetMinutesRef.current = 0
    dragEntityTypeRef.current = 'booking'
  }, [])

  const handleResizeMove = useCallback(
    (event: MouseEvent) => {
      const state = resizingRef.current
      if (!state) return

      const durationMinutes = resizeDurationFromPointer({
        clientY: event.clientY,
        columnTop: state.columnTop,
        startMinutes: state.startMinutes,
        stepMinutes: state.stepMinutes,
      })

      const startsAt = utcFromDayAndMinutesInTimeZone(
        state.day,
        state.startMinutes,
        state.timeZone,
      )

      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000)

      setEventsRef.current((previousEvents) =>
        previousEvents.map((calendarEvent) =>
          calendarEvent.id === state.eventId
            ? eventWithTiming({
                event: calendarEvent,
                startsAt: calendarEvent.startsAt,
                endsAt: endsAt.toISOString(),
                durationMinutes,
              })
            : calendarEvent,
        ),
      )
    },
    [setEventsRef],
  )

  const handleResizeEnd = useCallback(() => {
    const state = resizingRef.current
    resizingRef.current = null

    window.removeEventListener('mousemove', handleResizeMove)
    window.removeEventListener('mouseup', handleResizeEnd)

    if (!state) return

    suppressClickBriefly()

    const currentEvent = eventsRefRef.current.current.find(
      (event) => event.id === state.eventId,
    )

    if (!currentEvent) return

    const startsAtMs = new Date(currentEvent.startsAt).getTime()
    const endsAtMs = new Date(currentEvent.endsAt).getTime()

    if (
      !Number.isFinite(startsAtMs) ||
      !Number.isFinite(endsAtMs) ||
      endsAtMs <= startsAtMs
    ) {
      setEventsRef.current((previousEvents) =>
        previousEvents.map((event) =>
          event.id === state.eventId ? state.originalEvent : event,
        ),
      )
      return
    }

    const nextDuration = normalizeDurationMinutes({
      rawDurationMinutes: Math.round((endsAtMs - startsAtMs) / 60_000),
      stepMinutes: state.stepMinutes,
    })

    if (nextDuration === state.originalDuration) {
      setEventsRef.current((previousEvents) =>
        previousEvents.map((event) =>
          event.id === state.eventId ? state.originalEvent : event,
        ),
      )
      return
    }

    openConfirmRef.current({
      kind: 'resize',
      entityType: state.entityType,
      eventId: state.eventId,
      apiId: state.apiId,
      nextTotalDurationMinutes: nextDuration,
      original: state.originalEvent,
    })
  }, [
    eventsRefRef,
    handleResizeMove,
    openConfirmRef,
    setEventsRef,
    suppressClickBriefly,
  ])

  useEffect(() => {
    return () => {
      clearTimer(suppressClickTimerRef)
      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [handleResizeEnd, handleResizeMove])

  const onDragStart = useCallback(
    (event: CalendarEvent, dragEvent: DragEvent<HTMLDivElement>) => {
      suppressClickBriefly()

      const apiId = eventApiId(event)

      if (!apiId) {
        clearDragState()
        dragEvent.preventDefault()
        return
      }

      const context = safeSchedulingContext({
        event,
        resolveEventSchedulingContext:
          resolveEventSchedulingContextRef.current,
        fallbackStepMinutes: activeStepMinutesRef.current,
      })

      const durationMinutes = eventDurationMinutes({
        event,
        stepMinutes: context.stepMinutes,
      })

      const rect = dragEvent.currentTarget.getBoundingClientRect()
      const pointerOffsetPx = dragEvent.clientY - rect.top
      const pointerOffsetMinutes = pointerOffsetPx / PX_PER_MINUTE
      const maxGrabOffset = Math.max(0, durationMinutes - context.stepMinutes)

      dragEventIdRef.current = event.id
      dragApiIdRef.current = apiId
      dragEntityTypeRef.current = eventEntityType(event)
      dragOriginalEventRef.current = event
      dragGrabOffsetMinutesRef.current = clamp(
        pointerOffsetMinutes,
        0,
        maxGrabOffset,
      )

      try {
        dragEvent.dataTransfer.setData('text/plain', event.id)
      } catch {
        // Some browsers can reject dataTransfer writes. Drag state is stored in refs.
      }

      dragEvent.dataTransfer.effectAllowed = 'move'
    },
    [
      activeStepMinutesRef,
      clearDragState,
      resolveEventSchedulingContextRef,
      suppressClickBriefly,
    ],
  )

  const onDropOnDayColumn = useCallback(
    (day: Date, clientY: number, columnTop: number) => {
      const eventId = dragEventIdRef.current
      const apiId = dragApiIdRef.current
      const entityType = dragEntityTypeRef.current
      const originalEvent = dragOriginalEventRef.current

      clearDragState()

      if (!eventId || !apiId || !originalEvent) return

      suppressClickBriefly()

      const context = safeSchedulingContext({
        event: originalEvent,
        resolveEventSchedulingContext:
          resolveEventSchedulingContextRef.current,
        fallbackStepMinutes: activeStepMinutesRef.current,
      })

      const durationMinutes = eventDurationMinutes({
        event: originalEvent,
        stepMinutes: context.stepMinutes,
      })

      const nextStartMinutes = startMinutesFromPointer({
        clientY,
        columnTop,
        grabOffsetMinutes: dragGrabOffsetMinutesRef.current,
        stepMinutes: context.stepMinutes,
        durationMinutes,
      })

      const nextStart = utcFromDayAndMinutesInTimeZone(
        day,
        nextStartMinutes,
        context.timeZone,
      )

      const nextEnd = new Date(nextStart.getTime() + durationMinutes * 60_000)
      const nextStartIso = nextStart.toISOString()

      if (nextStartIso === originalEvent.startsAt) return

      setEventsRef.current((previousEvents) =>
        previousEvents.map((event) =>
          event.id === eventId
            ? eventWithTiming({
                event,
                startsAt: nextStartIso,
                endsAt: nextEnd.toISOString(),
                durationMinutes,
              })
            : event,
        ),
      )

      openConfirmRef.current({
        kind: 'move',
        entityType,
        eventId,
        apiId,
        nextStartIso,
        original: {
          ...originalEvent,
          durationMinutes,
        },
      })
    },
    [
      activeStepMinutesRef,
      clearDragState,
      openConfirmRef,
      resolveEventSchedulingContextRef,
      setEventsRef,
      suppressClickBriefly,
    ],
  )

  const beginResize = useCallback(
    (args: {
      entityType: EntityType
      eventId: string
      apiId: string
      day: Date
      startMinutes: number
      originalDuration: number
      columnTop: number
    }) => {
      const originalEvent = eventsRefRef.current.current.find(
        (event) => event.id === args.eventId,
      )

      if (!originalEvent) return

      suppressClickBriefly()

      const context = safeSchedulingContext({
        event: originalEvent,
        resolveEventSchedulingContext:
          resolveEventSchedulingContextRef.current,
        fallbackStepMinutes: activeStepMinutesRef.current,
      })

      resizingRef.current = {
        ...args,
        originalDuration: normalizeDurationMinutes({
          rawDurationMinutes: args.originalDuration,
          stepMinutes: context.stepMinutes,
        }),
        stepMinutes: context.stepMinutes,
        timeZone: context.timeZone,
        originalEvent,
      }

      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)

      window.addEventListener('mousemove', handleResizeMove)
      window.addEventListener('mouseup', handleResizeEnd)
    },
    [
      activeStepMinutesRef,
      eventsRefRef,
      handleResizeEnd,
      handleResizeMove,
      resolveEventSchedulingContextRef,
      suppressClickBriefly,
    ],
  )

  return {
    drag: {
      onDragStart,
      onDropOnDayColumn,
    },

    resize: {
      beginResize,
    },

    ui: {
      suppressClickRef,
      suppressClickBriefly,
    },
  }
}

export type DragDropState = ReturnType<typeof useDragDrop>