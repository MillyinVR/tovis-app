// lib/calendar/constants.ts

/**
 * Shared calendar constants for API/business logic.
 *
 * Keep this file framework-neutral:
 * - no React
 * - no Next imports
 * - no Prisma imports
 * - no browser APIs
 *
 * UI-only constants belong in:
 * app/pro/calendar/_constants.ts
 */

// ─── Date / time constants ────────────────────────────────────────────────────

export const CALENDAR_MINUTES_PER_HOUR = 60
export const CALENDAR_HOURS_PER_DAY = 24
export const CALENDAR_MINUTES_PER_DAY =
  CALENDAR_HOURS_PER_DAY * CALENDAR_MINUTES_PER_HOUR

export const CALENDAR_MS_PER_SECOND = 1_000
export const CALENDAR_SECONDS_PER_MINUTE = 60
export const CALENDAR_MS_PER_MINUTE =
  CALENDAR_SECONDS_PER_MINUTE * CALENDAR_MS_PER_SECOND

export const CALENDAR_MS_PER_DAY =
  CALENDAR_MINUTES_PER_DAY * CALENDAR_MS_PER_MINUTE

export const CALENDAR_WEEK_DAY_COUNT = 7
export const CALENDAR_MONTH_GRID_DAY_COUNT = 42

// ─── API range limits ─────────────────────────────────────────────────────────

export const DEFAULT_CALENDAR_RANGE_DAYS = CALENDAR_MONTH_GRID_DAY_COUNT

export const MAX_CALENDAR_RANGE_DAYS = CALENDAR_MONTH_GRID_DAY_COUNT

/**
 * Hard cap for calendar event queries.
 *
 * This is intentionally server-owned. The client may request ranges,
 * but the API decides how much data is safe to return.
 */
export const MAX_CALENDAR_EVENTS_PER_RANGE = 1_200

/**
 * Hard cap for bookable locations loaded into calendar selection logic.
 */
export const MAX_CALENDAR_LOCATIONS_PER_PRO = 50

// ─── Blocked-time API defaults ────────────────────────────────────────────────

export const DEFAULT_BLOCK_QUERY_LOOKBACK_DAYS = 7
export const DEFAULT_BLOCK_QUERY_LOOKAHEAD_DAYS = 60

export const MAX_BLOCK_QUERY_RANGE_DAYS = 90

export const MAX_BLOCKS_PER_QUERY = 1_000

// ─── Calendar defaults ────────────────────────────────────────────────────────

export const DEFAULT_CALENDAR_TIME_ZONE = 'UTC'

export const DEFAULT_BLOCK_TITLE = 'Blocked time'
export const DEFAULT_BLOCK_CLIENT_NAME = 'Personal'

export const DEFAULT_BOOKING_CLIENT_NAME = 'Client'
export const DEFAULT_BOOKING_SERVICE_NAME = 'Appointment'

// ─── Stats constants ──────────────────────────────────────────────────────────

export const CALENDAR_BLOCKED_HOURS_ROUNDING_FACTOR = 2

export function roundedCalendarHours(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0

  const hours = minutes / CALENDAR_MINUTES_PER_HOUR

  return (
    Math.round(hours * CALENDAR_BLOCKED_HOURS_ROUNDING_FACTOR) /
    CALENDAR_BLOCKED_HOURS_ROUNDING_FACTOR
  )
}