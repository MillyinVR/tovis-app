// app/pro/calendar/_hooks/useBlockActions.ts
'use client'

import { useState } from 'react'
import type { CalendarEvent } from '../_types'
import { extractBlockId, snapMinutes } from '../_utils/calendarMath'
import { apiMessage } from '../_utils/parsers'
import {
  startOfDayUtcInTimeZone,
  utcFromDayAndMinutesInTimeZone,
  getZonedParts,
} from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import { safeJson, errorMessageFromUnknown } from '@/lib/http'

type BlockActionsDeps = {
  activeLocationId: string | null
  activeStepMinutes: number
  resolveActiveCalendarTimeZone: (fallback?: string) => string
  reloadCalendar: () => Promise<void>
  forceProFooterRefresh: () => void
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
}

export function useBlockActions(deps: BlockActionsDeps) {
  const [blockCreateOpen, setBlockCreateOpen] = useState(false)
  const [blockCreateInitialStart, setBlockCreateInitialStart] = useState<Date>(
    new Date(),
  )

  const [editBlockOpen, setEditBlockOpen] = useState(false)
  const [editBlockId, setEditBlockId] = useState<string | null>(null)

  async function createBlock(
    startsAtIso: string,
    endsAtIso: string,
    note?: string,
  ) {
    if (!deps.activeLocationId) throw new Error('Select a location first.')

    const res = await fetch('/api/pro/calendar/blocked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        note: note ?? null,
        locationId: deps.activeLocationId,
      }),
    })

    const data: unknown = await safeJson(res)
    if (!res.ok) throw new Error(apiMessage(data, 'Failed to create block.'))

    if (isRecord(data) && isRecord(data.block)) {
      const id = pickString(data.block.id) ?? ''
      const startsAt = pickString(data.block.startsAt) ?? startsAtIso
      const endsAt = pickString(data.block.endsAt) ?? endsAtIso
      const noteOut = data.block.note === null ? null : pickString(data.block.note)

      return {
        id,
        startsAt,
        endsAt,
        note: noteOut ?? null,
      }
    }

    return {
      id: '',
      startsAt: startsAtIso,
      endsAt: endsAtIso,
      note: note ?? null,
    }
  }

  async function oneClickBlockFullDay(day: Date) {
    try {
      if (!deps.activeLocationId) throw new Error('Select a location first.')

      deps.setLoading(true)
      deps.setError(null)

      const tz = deps.resolveActiveCalendarTimeZone()
      const startUtc = startOfDayUtcInTimeZone(day, tz)
      const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60_000)

      await createBlock(
        startUtc.toISOString(),
        endUtc.toISOString(),
        'Full day off',
      )
      await deps.reloadCalendar()
      deps.forceProFooterRefresh()
    } catch (e: unknown) {
      console.error(e)
      deps.setError(errorMessageFromUnknown(e))
      window.setTimeout(() => deps.setError(null), 3500)
    } finally {
      deps.setLoading(false)
    }
  }

  function openCreateBlockNow() {
    if (!deps.activeLocationId) {
      deps.setError('Select a location first.')
      window.setTimeout(() => deps.setError(null), 3000)
      return
    }

    const tz = deps.resolveActiveCalendarTimeZone()
    const nowUtc = new Date()
    const p = getZonedParts(nowUtc, tz)
    const minutesNow = p.hour * 60 + p.minute
    const roundedUp =
      Math.ceil(minutesNow / deps.activeStepMinutes) * deps.activeStepMinutes
    const rounded = snapMinutes(roundedUp, deps.activeStepMinutes)
    const startUtc = utcFromDayAndMinutesInTimeZone(nowUtc, rounded, tz)

    setBlockCreateInitialStart(startUtc)
    setBlockCreateOpen(true)
  }

  function openEditBlockFromEvent(ev: CalendarEvent) {
    const bid = extractBlockId(ev)
    if (!bid) return

    setEditBlockId(bid)
    setEditBlockOpen(true)

    return ev.locationId ?? null
  }

  return {
    blockCreateOpen,
    setBlockCreateOpen,
    blockCreateInitialStart,
    setBlockCreateInitialStart,
    editBlockOpen,
    setEditBlockOpen,
    editBlockId,
    setEditBlockId,
    createBlock,
    oneClickBlockFullDay,
    openCreateBlockNow,
    openEditBlockFromEvent,
  }
}

export type BlockActionsState = ReturnType<typeof useBlockActions>