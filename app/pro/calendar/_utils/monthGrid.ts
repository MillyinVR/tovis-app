// app/pro/calendar/_utils/monthGrid.ts

import type { CalendarEvent } from '../_types'

import { ymdInTimeZone } from './date'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MonthDayCell = {
  day: Date
  dayYmd: string
  dayNumber: string
  isToday: boolean
  isInCurrentMonth: boolean
  events: CalendarEvent[]
}

type EventRange = {
  event: CalendarEvent
  startYmd: string
  endYmd: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIDDAY_MS = 12 * 60 * 60 * 1000

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function anchoredVisibleDay(day: Date): Date {
  return new Date(day.getTime() + MIDDAY_MS)
}

export function visibleDayKey(day: Date, timeZone: string): string {
  return ymdInTimeZone(anchoredVisibleDay(day), timeZone)
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime())
}

function isEventRange(value: EventRange | null): value is EventRange {
  return value !== null
}

function buildEventRange(
  event: CalendarEvent,
  timeZone: string,
): EventRange | null {
  const startsAt = new Date(event.startsAt)
  const endsAt = new Date(event.endsAt)

  if (!isValidDate(startsAt) || !isValidDate(endsAt)) return null
  if (endsAt.getTime() <= startsAt.getTime()) return null

  return {
    event,
    startYmd: ymdInTimeZone(startsAt, timeZone),
    endYmd: ymdInTimeZone(new Date(endsAt.getTime() - 1), timeZone),
  }
}

export function buildEventsByVisibleDay(args: {
  events: CalendarEvent[]
  visibleDayKeys: string[]
  timeZone: string
}): Map<string, CalendarEvent[]> {
  const { events, visibleDayKeys, timeZone } = args
  const grouped = new Map<string, CalendarEvent[]>()

  for (const dayKey of visibleDayKeys) {
    grouped.set(dayKey, [])
  }

  const eventRanges = events
    .map((event) => buildEventRange(event, timeZone))
    .filter(isEventRange)

  for (const range of eventRanges) {
    for (const dayKey of visibleDayKeys) {
      if (dayKey >= range.startYmd && dayKey <= range.endYmd) {
        grouped.get(dayKey)?.push(range.event)
      }
    }
  }

  return grouped
}

export function buildMonthDayCells(args: {
  visibleDays: Date[]
  currentDate: Date
  events: CalendarEvent[]
  timeZone: string
}): MonthDayCell[] {
  const { visibleDays, currentDate, events, timeZone } = args

  const monthYearFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'numeric',
    year: 'numeric',
  })

  const dayNumberFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
  })

  const currentMonthKey = monthYearFormatter.format(currentDate)
  const todayYmd = ymdInTimeZone(new Date(), timeZone)
  const visibleDayKeys = visibleDays.map((day) => visibleDayKey(day, timeZone))

  const eventsByVisibleDay = buildEventsByVisibleDay({
    events,
    visibleDayKeys,
    timeZone,
  })

  return visibleDays.map((day, index) => {
    const dayYmd = visibleDayKeys[index]
    const anchoredDay = anchoredVisibleDay(day)

    return {
      day,
      dayYmd,
      dayNumber: dayNumberFormatter.format(anchoredDay),
      isToday: dayYmd === todayYmd,
      isInCurrentMonth:
        monthYearFormatter.format(anchoredDay) === currentMonthKey,
      events: eventsByVisibleDay.get(dayYmd) ?? [],
    }
  })
}