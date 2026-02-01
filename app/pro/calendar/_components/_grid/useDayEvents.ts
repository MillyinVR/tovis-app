// app/pro/calendar/_components/_grid/useDayEvents.ts
'use client'

import { useMemo } from 'react'
import type { CalendarEvent } from '../../_types'
import { ymdInTimeZone } from '../../_utils/date'

const MIDDAY_MS = 12 * 60 * 60 * 1000

function stableYmdForVisibleDay(d: Date, timeZone: string) {
  return ymdInTimeZone(new Date(d.getTime() + MIDDAY_MS), timeZone)
}

/**
 * Returns all events that intersect the given day (in the provided timeZone).
 * Inclusive end handling: uses (end - 1ms) so events ending exactly at midnight
 * count toward the previous day.
 */
export function useDayEvents(args: { day: Date; timeZone: string; events: CalendarEvent[] }) {
  const { day, timeZone, events } = args

  return useMemo(() => {
    const dayYmd = stableYmdForVisibleDay(day, timeZone)

    return events.filter((ev) => {
      const s = new Date(ev.startsAt).getTime()
      const e = new Date(ev.endsAt).getTime()
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false

      const startYmd = ymdInTimeZone(new Date(s), timeZone)
      const endYmdInclusive = ymdInTimeZone(new Date(e - 1), timeZone) // inclusive day

      return dayYmd >= startYmd && dayYmd <= endYmdInclusive
    })
  }, [day, timeZone, events])
}
