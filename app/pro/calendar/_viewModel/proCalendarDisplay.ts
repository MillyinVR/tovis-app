// app/pro/calendar/_viewModel/proCalendarDisplay.ts

import type {
  BookingCalendarEvent,
  CalendarEvent,
  ViewMode,
} from '../_types'
import type { BrandProCalendarCopy } from '@/lib/brand/types'

import {
  addDaysAnchorNoonInTimeZone,
  anchorNoonInTimeZone,
  formatDayLabelInTimeZone,
  formatMonthRangeInTimeZone,
  formatWeekRangeInTimeZone,
  startOfMonthAnchorNoonInTimeZone,
  startOfWeekAnchorNoonInTimeZone,
} from '../_utils/date'

import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  startOfDayUtcInTimeZone,
} from '@/lib/timeZone'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarLocationDisplayOption = {
  id: string
  name?: string | null
  formattedAddress?: string | null
  type?: string | null
}

type VisibleDaysForViewArgs = {
  view: ViewMode
  anchoredCurrentDate: Date
  timeZone: string
}

type MobileSubtitleArgs = {
  date: Date
  timeZone: string
  activeLocationLabel: string | null
}

type CalendarLocationDisplayLabelArgs = {
  activeLocationId: string | null
  activeLocationLabel: string | null
  scopedLocations: CalendarLocationDisplayOption[]
  fallbackLabel: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_CALENDAR_VIEW: ViewMode = 'day'

const WEEK_DAY_COUNT = 7
const MONTH_GRID_DAY_COUNT = 42

// ─── Timezone helpers ─────────────────────────────────────────────────────────

export function safeCalendarTimeZone(value: unknown): string {
  return sanitizeTimeZone(
    typeof value === 'string' ? value : '',
    DEFAULT_TIME_ZONE,
  )
}

export function validTimeZoneOrFallback(
  value: unknown,
  fallback: string,
): string {
  if (typeof value !== 'string') return fallback

  const candidate = value.trim()

  if (!candidate || !isValidIanaTimeZone(candidate)) {
    return fallback
  }

  return sanitizeTimeZone(candidate, fallback)
}

export function anchoredCalendarDate(date: Date, timeZone: string): Date {
  return anchorNoonInTimeZone(date, timeZone)
}

// ─── View labels / dates ──────────────────────────────────────────────────────

export function calendarTitleForView(
  view: ViewMode,
  titles: BrandProCalendarCopy['titles'],
): string {
  return titles[view]
}

export function calendarHeaderLabelForView(
  view: ViewMode,
  anchorUtc: Date,
  timeZone: string,
): string {
  if (view === 'day') {
    return formatDayLabelInTimeZone(anchorUtc, timeZone)
  }

  if (view === 'week') {
    return formatWeekRangeInTimeZone(anchorUtc, timeZone)
  }

  return formatMonthRangeInTimeZone(anchorUtc, timeZone)
}

export function visibleDaysForCalendarView(
  args: VisibleDaysForViewArgs,
): Date[] {
  const { view, anchoredCurrentDate, timeZone } = args

  if (view === 'day') {
    return [startOfDayUtcInTimeZone(anchoredCurrentDate, timeZone)]
  }

  if (view === 'week') {
    const weekStartNoon = startOfWeekAnchorNoonInTimeZone(
      anchoredCurrentDate,
      timeZone,
    )

    return Array.from({ length: WEEK_DAY_COUNT }, (_, index) => {
      const dayNoon = addDaysAnchorNoonInTimeZone(
        weekStartNoon,
        index,
        timeZone,
      )

      return startOfDayUtcInTimeZone(dayNoon, timeZone)
    })
  }

  const monthStartNoon = startOfMonthAnchorNoonInTimeZone(
    anchoredCurrentDate,
    timeZone,
  )

  const firstGridDayNoon = startOfWeekAnchorNoonInTimeZone(
    monthStartNoon,
    timeZone,
  )

  return Array.from({ length: MONTH_GRID_DAY_COUNT }, (_, index) => {
    const dayNoon = addDaysAnchorNoonInTimeZone(
      firstGridDayNoon,
      index,
      timeZone,
    )

    return startOfDayUtcInTimeZone(dayNoon, timeZone)
  })
}

export function todayWeekdayLabel(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
  }).format(now)
}

export function mobileCalendarSubtitleFor(args: MobileSubtitleArgs): string {
  const { date, timeZone, activeLocationLabel } = args

  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, { timeZone, ...options })
      .format(date)
      .toUpperCase()

  const parts = [
    format({ weekday: 'short' }),
    format({ month: 'short', day: 'numeric' }),
  ]

  const locationName = activeLocationLabel?.split(' — ')[0]?.trim()

  if (locationName) {
    parts.push(locationName.toUpperCase())
  }

  return parts.join(' · ')
}

// ─── Event selection helpers ──────────────────────────────────────────────────

export function isBookingCalendarEvent(
  event: CalendarEvent,
): event is BookingCalendarEvent {
  return event.kind === 'BOOKING'
}

export function bookingActionId(
  event: CalendarEvent | undefined,
): string | null {
  if (!event || !isBookingCalendarEvent(event)) return null

  return event.id
}

export function firstPendingBooking(
  events: CalendarEvent[],
): BookingCalendarEvent | undefined {
  return events.find(isBookingCalendarEvent)
}

// ─── Location display helpers ─────────────────────────────────────────────────

export function calendarLocationDisplayLabel(
  args: CalendarLocationDisplayLabelArgs,
): string {
  const {
    activeLocationId,
    activeLocationLabel,
    scopedLocations,
    fallbackLabel,
  } = args

  const trimmedActiveLabel = activeLocationLabel?.trim()

  if (trimmedActiveLabel) return trimmedActiveLabel

  const activeLocation = scopedLocations.find(
    (location) => location.id === activeLocationId,
  )

  const locationName = activeLocation?.name?.trim()

  if (locationName) return locationName

  const locationType = activeLocation?.type?.trim()

  if (locationType) return locationType

  return fallbackLabel
}