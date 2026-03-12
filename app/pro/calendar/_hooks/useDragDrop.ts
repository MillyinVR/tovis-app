// app/pro/calendar/_hooks/useDragDrop.ts
'use client'

import { useCallback, useEffect, useRef, type DragEvent } from 'react'
import type { CalendarEvent, EntityType, PendingChange } from '../_types'
import {
  PX_PER_MINUTE,
  roundDurationMinutes,
  snapMinutes,
  computeDurationMinutesFromIso,
  isBlockedEvent,
  extractBlockId,
} from '../_utils/calendarMath'
import { clamp } from '../_utils/date'
import { utcFromDayAndMinutesInTimeZone } from '@/lib/timeZone'

type DragDropDeps = {
  eventsRef: React.RefObject<CalendarEvent[]>
  setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>
  resolveEventSchedulingContext: (ev: CalendarEvent) => {
    timeZone: string
    stepMinutes: number
  }
  activeStepMinutes: number
  openConfirm: (change: PendingChange) => void
}

function eventDurationMinutes(ev: CalendarEvent) {
  return typeof ev.durationMinutes === 'number' &&
    Number.isFinite(ev.durationMinutes) &&
    ev.durationMinutes > 0
    ? ev.durationMinutes
    : computeDurationMinutesFromIso(ev.startsAt, ev.endsAt)
}

export function useDragDrop(deps: DragDropDeps) {
  const dragEventIdRef = useRef<string | null>(null)
  const dragApiIdRef = useRef<string | null>(null)
  const dragEntityTypeRef = useRef<EntityType>('booking')
  const dragOriginalEventRef = useRef<CalendarEvent | null>(null)
  const dragGrabOffsetMinutesRef = useRef<number>(0)

  const resizingRef = useRef<{
    entityType: EntityType
    eventId: string
    apiId: string
    day: Date
    startMinutes: number
    originalDuration: number
    columnTop: number
    stepMinutes: number
    timeZone: string
  } | null>(null)

  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)

  // Stable dependency refs for DOM listeners / async callbacks.
  const setEventsRef = useRef(deps.setEvents)
  const resolveEventSchedulingContextRef = useRef(deps.resolveEventSchedulingContext)
  const activeStepMinutesRef = useRef(deps.activeStepMinutes)
  const openConfirmRef = useRef(deps.openConfirm)

  useEffect(() => {
    setEventsRef.current = deps.setEvents
    resolveEventSchedulingContextRef.current = deps.resolveEventSchedulingContext
    activeStepMinutesRef.current = deps.activeStepMinutes
    openConfirmRef.current = deps.openConfirm
  }, [
    deps.setEvents,
    deps.resolveEventSchedulingContext,
    deps.activeStepMinutes,
    deps.openConfirm,
  ])

  function suppressClickBriefly() {
    suppressClickRef.current = true

    if (suppressClickTimerRef.current) {
      window.clearTimeout(suppressClickTimerRef.current)
    }

    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false
      suppressClickTimerRef.current = null
    }, 250)
  }

  const onResizeMoveImplRef = useRef<(e: MouseEvent) => void>(() => {})
  const onResizeEndImplRef = useRef<() => void>(() => {})

  const onResizeMove = useCallback((e: MouseEvent) => {
    onResizeMoveImplRef.current(e)
  }, [])

  const onResizeEnd = useCallback(() => {
    onResizeEndImplRef.current()
  }, [])

  useEffect(() => {
    onResizeMoveImplRef.current = (e: MouseEvent) => {
      const s = resizingRef.current
      if (!s) return

      const y = e.clientY - s.columnTop
      const endMinutes = snapMinutes(y / PX_PER_MINUTE, s.stepMinutes)
      const rawDur = endMinutes - s.startMinutes
      const dur = roundDurationMinutes(rawDur, s.stepMinutes)

      const start = utcFromDayAndMinutesInTimeZone(
        s.day,
        s.startMinutes,
        s.timeZone,
      )
      const end = new Date(start.getTime() + dur * 60_000)

      setEventsRef.current((prev) =>
        prev.map((ev) =>
          ev.id === s.eventId
            ? { ...ev, endsAt: end.toISOString(), durationMinutes: dur }
            : ev,
        ),
      )
    }
  }, [])

  useEffect(() => {
    onResizeEndImplRef.current = () => {
      const s = resizingRef.current
      resizingRef.current = null

      window.removeEventListener('mousemove', onResizeMove)
      window.removeEventListener('mouseup', onResizeEnd)

      if (!s) return

      suppressClickBriefly()

      const ev = deps.eventsRef.current.find((x) => x.id === s.eventId)
      if (!ev) return

      const start = new Date(ev.startsAt)
      const end = new Date(ev.endsAt)
      const raw = Math.round((end.getTime() - start.getTime()) / 60_000)
      const dur = roundDurationMinutes(raw, s.stepMinutes)

      if (dur === s.originalDuration) {
        const rollbackEnd = new Date(
          start.getTime() + s.originalDuration * 60_000,
        )

        setEventsRef.current((prev) =>
          prev.map((x) =>
            x.id === s.eventId
              ? {
                  ...x,
                  endsAt: rollbackEnd.toISOString(),
                  durationMinutes: s.originalDuration,
                }
              : x,
          ),
        )
        return
      }

      const originalForRollback: CalendarEvent = {
        ...ev,
        endsAt: new Date(
          start.getTime() + s.originalDuration * 60_000,
        ).toISOString(),
        durationMinutes: s.originalDuration,
      }

      openConfirmRef.current({
        kind: 'resize',
        entityType: s.entityType,
        eventId: s.eventId,
        apiId: s.apiId,
        nextTotalDurationMinutes: dur,
        original: originalForRollback,
      })
    }
  }, [deps.eventsRef, onResizeMove, onResizeEnd])

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current) {
        window.clearTimeout(suppressClickTimerRef.current)
      }
      window.removeEventListener('mousemove', onResizeMove)
      window.removeEventListener('mouseup', onResizeEnd)
    }
  }, [onResizeMove, onResizeEnd])

  function onDragStart(ev: CalendarEvent, e: DragEvent<HTMLDivElement>) {
    suppressClickBriefly()

    const isBlock = isBlockedEvent(ev)
    const entityType: EntityType = isBlock ? 'block' : 'booking'
    const apiId = isBlock ? extractBlockId(ev) : ev.id
    if (!apiId) return

    dragEventIdRef.current = ev.id
    dragApiIdRef.current = apiId
    dragEntityTypeRef.current = entityType
    dragOriginalEventRef.current = ev

    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    const pxFromTop = e.clientY - rect.top
    const minutesFromTop = pxFromTop / PX_PER_MINUTE
    const dur = eventDurationMinutes(ev)
    const stepMinutes = resolveEventSchedulingContextRef.current(ev).stepMinutes

    dragGrabOffsetMinutesRef.current = clamp(
      minutesFromTop,
      0,
      Math.max(0, dur - stepMinutes),
    )

    try {
      e.dataTransfer.setData('text/plain', ev.id)
    } catch {
      // ignore
    }

    e.dataTransfer.effectAllowed = 'move'
  }

  async function onDropOnDayColumn(
    day: Date,
    clientY: number,
    columnTop: number,
  ) {
    const eventId = dragEventIdRef.current
    const apiId = dragApiIdRef.current
    const entityType = dragEntityTypeRef.current
    const original = dragOriginalEventRef.current

    dragEventIdRef.current = null
    dragApiIdRef.current = null
    dragOriginalEventRef.current = null

    if (!eventId || !apiId || !original) return

    suppressClickBriefly()

    const y = clientY - columnTop
    const rawMinutes = y / PX_PER_MINUTE
    const context = resolveEventSchedulingContextRef.current(original)
    const topMinutes = snapMinutes(
      rawMinutes - dragGrabOffsetMinutesRef.current,
      context.stepMinutes,
    )

    const nextStart = utcFromDayAndMinutesInTimeZone(
      day,
      topMinutes,
      context.timeZone,
    )

    if (nextStart.toISOString() === original.startsAt) return

    const dur = eventDurationMinutes(original)
    const nextEnd = new Date(nextStart.getTime() + dur * 60_000)

    setEventsRef.current((prev) =>
      prev.map((event) =>
        event.id === eventId
          ? {
              ...event,
              startsAt: nextStart.toISOString(),
              endsAt: nextEnd.toISOString(),
              durationMinutes: dur,
            }
          : event,
      ),
    )

    openConfirmRef.current({
      kind: 'move',
      entityType,
      eventId,
      apiId,
      nextStartIso: nextStart.toISOString(),
      original: { ...original, durationMinutes: dur },
    })
  }

  function beginResize(args: {
    entityType: EntityType
    eventId: string
    apiId: string
    day: Date
    startMinutes: number
    originalDuration: number
    columnTop: number
  }) {
    suppressClickBriefly()

    const ev = deps.eventsRef.current.find((item) => item.id === args.eventId)
    const context = ev ? resolveEventSchedulingContextRef.current(ev) : null

    resizingRef.current = {
      ...args,
      stepMinutes: context?.stepMinutes ?? activeStepMinutesRef.current,
      timeZone: context?.timeZone ?? 'UTC',
    }

    window.addEventListener('mousemove', onResizeMove)
    window.addEventListener('mouseup', onResizeEnd)
  }

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