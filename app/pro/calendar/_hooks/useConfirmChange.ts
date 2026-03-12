// app/pro/calendar/_hooks/useConfirmChange.ts
'use client'

import { useState } from 'react'
import type { CalendarEvent, PendingChange } from '../_types'
import {
  roundDurationMinutes,
  computeDurationMinutesFromIso,
  isOutsideWorkingHours,
} from '../_utils/calendarMath'
import { apiMessage, locationTypeFromBookingValue, type LocationType } from '../_utils/parsers'
import { anchorDayLocalNoon } from '../_utils/calendarRange'
import { getZonedParts } from '@/lib/timeZone'
import { safeJson, errorMessageFromUnknown } from '@/lib/http'

type ConfirmChangeDeps = {
  eventsRef: React.RefObject<CalendarEvent[]>
  setEvents: React.Dispatch<React.SetStateAction<CalendarEvent[]>>
  resolveBookingSchedulingContext: (args: {
    locationId: string | null
    locationType: LocationType
    fallbackTimeZone: string
  }) => {
    timeZone: string
    workingHours: import('../_types').WorkingHoursJson
    stepMinutes: number
  }
  timeZoneRef: React.RefObject<string>
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void
  setError: (error: string | null) => void
}

function eventDurationMinutes(ev: CalendarEvent) {
  return typeof ev.durationMinutes === 'number' &&
    Number.isFinite(ev.durationMinutes) &&
    ev.durationMinutes > 0
    ? ev.durationMinutes
    : computeDurationMinutesFromIso(ev.startsAt, ev.endsAt)
}

export function useConfirmChange(deps: ConfirmChangeDeps) {
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applyingChange, setApplyingChange] = useState(false)

  function openConfirm(change: PendingChange) {
    setPendingChange(change)
    setConfirmOpen(true)
  }

  function rollbackPending() {
    if (!pendingChange) return

    deps.setEvents((prev) =>
      prev.map((ev) =>
        ev.id === pendingChange.eventId
          ? {
              ...ev,
              startsAt: pendingChange.original.startsAt,
              endsAt: pendingChange.original.endsAt,
              durationMinutes: pendingChange.original.durationMinutes,
            }
          : ev,
      ),
    )
  }

  function cancelConfirm() {
    rollbackPending()
    setConfirmOpen(false)
    setPendingChange(null)
  }

  function isPendingChangeOutsideWorkingHours(change: PendingChange): boolean {
    if (change.entityType !== 'booking') return false
    if (change.original.kind !== 'BOOKING') return false

    const originalLocationType = locationTypeFromBookingValue(change.original.locationType)
    const context = deps.resolveBookingSchedulingContext({
      locationId: change.original.locationId ?? null,
      locationType: originalLocationType,
      fallbackTimeZone: deps.timeZoneRef.current,
    })

    const originalDur = eventDurationMinutes(change.original)
    const nextStartIso =
      change.kind === 'move' ? change.nextStartIso : change.original.startsAt
    const nextDurMinutes =
      change.kind === 'resize'
        ? Number(change.nextTotalDurationMinutes || originalDur)
        : Number(originalDur)

    const startUtc = new Date(nextStartIso)
    if (!Number.isFinite(startUtc.getTime())) return false

    const p = getZonedParts(startUtc, context.timeZone)
    const startMinutes = p.hour * 60 + p.minute
    const dur = roundDurationMinutes(nextDurMinutes, context.stepMinutes)
    const endMinutes = startMinutes + dur
    const dayAnchor = anchorDayLocalNoon(p.year, p.month, p.day)

    return isOutsideWorkingHours({
      day: dayAnchor,
      startMinutes,
      endMinutes,
      workingHours: context.workingHours,
      timeZone: context.timeZone,
    })
  }

  async function applyConfirm() {
    if (!pendingChange || applyingChange) return
    setApplyingChange(true)

    try {
      if (pendingChange.entityType === 'booking') {
        const payload: {
          notifyClient: true
          durationMinutes?: number
          scheduledFor?: string
          allowOutsideWorkingHours?: boolean
        } = { notifyClient: true }

        if (pendingChange.kind === 'resize') {
          payload.durationMinutes = pendingChange.nextTotalDurationMinutes
        } else {
          payload.scheduledFor = pendingChange.nextStartIso
        }

        if (isPendingChangeOutsideWorkingHours(pendingChange)) {
          payload.allowOutsideWorkingHours = true
        }

        const res = await fetch(`/api/pro/bookings/${encodeURIComponent(pendingChange.apiId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data: unknown = await safeJson(res)
        if (!res.ok) throw new Error(apiMessage(data, 'Failed to apply changes.'))
      } else {
        const current = deps.eventsRef.current.find((x) => x.id === pendingChange.eventId)
        const startIso =
          pendingChange.kind === 'move'
            ? pendingChange.nextStartIso
            : current?.startsAt ?? pendingChange.original.startsAt

        const dur =
          pendingChange.kind === 'resize'
            ? pendingChange.nextTotalDurationMinutes
            : eventDurationMinutes(pendingChange.original)

        const endIso = new Date(
          new Date(startIso).getTime() + dur * 60_000,
        ).toISOString()

        const res = await fetch(
          `/api/pro/calendar/blocked/${encodeURIComponent(pendingChange.apiId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startsAt: startIso, endsAt: endIso }),
          },
        )

        const data: unknown = await safeJson(res)
        if (!res.ok) throw new Error(apiMessage(data, 'Failed to apply changes.'))
      }

      setConfirmOpen(false)
      setPendingChange(null)
      await deps.reloadCalendar()
      deps.forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      rollbackPending()
      setConfirmOpen(false)
      setPendingChange(null)
      deps.setError(errorMessageFromUnknown(e))
      window.setTimeout(() => deps.setError(null), 3500)
    } finally {
      setApplyingChange(false)
    }
  }

  const pendingOutsideWorkingHours = pendingChange
    ? isPendingChangeOutsideWorkingHours(pendingChange)
    : false

  return {
    pendingChange,
    confirmOpen,
    applyingChange,
    openConfirm,
    cancelConfirm,
    applyConfirm,
    pendingOutsideWorkingHours,
  }
}

export type ConfirmChangeState = ReturnType<typeof useConfirmChange>
