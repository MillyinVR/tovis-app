// app/pro/calendar/_components/_grid/useDayEvents.ts
'use client'

import { useMemo } from 'react'

import type { CalendarEvent } from '../../_types'

import { ymdInTimeZone } from '../../_utils/date'

// ─── Types ────────────────────────────────────────────────────────────────────

type EventDayRange = {
  event: CalendarEvent
  startYmd: string
  endYmdInclusive: string
  startMs: number
  endMs: number
}

type GetDayEventsArgs = {
  day: Date
  timeZone: string
  events: CalendarEvent[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDDAY_MS = 12 * 60 * 60 * 1000
const END_INCLUSIVE_OFFSET_MS = 1

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function anchoredVisibleDay(day: Date): Date {
  return new Date(day.getTime() + MIDDAY_MS)
}

function stableYmdForVisibleDay(day: Date, timeZone: string): string {
  return ymdInTimeZone(anchoredVisibleDay(day), timeZone)
}

function validMsFromIso(value: string): number | null {
  const ms = new Date(value).getTime()

  return Number.isFinite(ms) ? ms : null
}

function buildEventDayRange(
  event: CalendarEvent,
  timeZone: string,
): EventDayRange | null {
  const startMs = validMsFromIso(event.startsAt)
  const endMs = validMsFromIso(event.endsAt)

  if (startMs === null || endMs === null) return null
  if (endMs <= startMs) return null

  return {
    event,
    startYmd: ymdInTimeZone(new Date(startMs), timeZone),
    endYmdInclusive: ymdInTimeZone(
      new Date(endMs - END_INCLUSIVE_OFFSET_MS),
      timeZone,
    ),
    startMs,
    endMs,
  }
}

function eventIntersectsDay(range: EventDayRange, dayYmd: string): boolean {
  return dayYmd >= range.startYmd && dayYmd <= range.endYmdInclusive
}

function sortEventsForDay(
  first: EventDayRange,
  second: EventDayRange,
): number {
  if (first.startMs !== second.startMs) {
    return first.startMs - second.startMs
  }

  if (first.endMs !== second.endMs) {
    return first.endMs - second.endMs
  }

  return first.event.id.localeCompare(second.event.id)
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export function getDayEvents(args: GetDayEventsArgs): CalendarEvent[] {
  const { day, timeZone, events } = args
  const dayYmd = stableYmdForVisibleDay(day, timeZone)
  const ranges: EventDayRange[] = []

  for (const event of events) {
    const range = buildEventDayRange(event, timeZone)

    if (range && eventIntersectsDay(range, dayYmd)) {
      ranges.push(range)
    }
  }

  ranges.sort(sortEventsForDay)

  return ranges.map((range) => range.event)
}

/**
 * Returns all events that intersect the given day in the provided timezone.
 *
 * End handling is inclusive by using end - 1ms, so an event ending exactly at
 * midnight belongs to the previous day, not the next day.
 */
export function useDayEvents(args: GetDayEventsArgs): CalendarEvent[] {
  const { day, timeZone, events } = args

  return useMemo(
    () =>
      getDayEvents({
        day,
        timeZone,
        events,
      }),
    [day, events, timeZone],
  )
}