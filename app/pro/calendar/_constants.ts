// app/pro/calendar/_constants.ts

import type { ViewMode } from './_types'

// ─── View constants ───────────────────────────────────────────────────────────

export const DEFAULT_CALENDAR_VIEW: ViewMode = 'day'

export const CALENDAR_VIEW_ORDER: readonly ViewMode[] = [
  'day',
  'week',
  'month',
]

// ─── Date / time constants ────────────────────────────────────────────────────

export const MINUTES_PER_HOUR = 60
export const HOURS_PER_DAY = 24
export const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR

export const MS_PER_SECOND = 1_000
export const SECONDS_PER_MINUTE = 60
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE

export const WEEK_DAY_COUNT = 7
export const MONTH_GRID_DAY_COUNT = 42

/**
 * Used when converting calendar day anchors.
 * Noon is intentionally safer than midnight around DST boundaries.
 */
export const ANCHOR_NOON_HOUR = 12
export const ANCHOR_NOON_MS = ANCHOR_NOON_HOUR * MINUTES_PER_HOUR * MS_PER_MINUTE

// ─── Timeline grid constants ──────────────────────────────────────────────────

export const CALENDAR_GRID_INTERVAL_MINUTES = 60

export const DEFAULT_CALENDAR_STEP_MINUTES = 15

export const NOW_LINE_REFRESH_INTERVAL_MS = 30_000
export const NOW_LINE_SCROLL_OFFSET_PX = 160

export const DAY_VIEW_VISIBLE_DAY_COUNT = 1
export const WEEK_VIEW_VISIBLE_DAY_COUNT = WEEK_DAY_COUNT

// ─── Event density constants ──────────────────────────────────────────────────

export const MICRO_EVENT_HEIGHT_PX = 28
export const COMPACT_EVENT_HEIGHT_PX = 52

// ─── Month view constants ─────────────────────────────────────────────────────

export const MOBILE_MONTH_MAX_DOTS_PER_DAY = 4
export const DESKTOP_MONTH_MAX_VISIBLE_EVENTS_PER_DAY = 3

// ─── Responsive shell constants ───────────────────────────────────────────────

export const PRO_CALENDAR_TABLET_MIN_WIDTH_PX = 768
export const PRO_CALENDAR_DESKTOP_MIN_WIDTH_PX = 1024

// ─── Data attributes ──────────────────────────────────────────────────────────

export const CALENDAR_DATA_TRUE = 'true'
export const CALENDAR_DATA_FALSE = 'false'

export function booleanDataAttr(value: boolean): 'true' | 'false' {
  return value ? CALENDAR_DATA_TRUE : CALENDAR_DATA_FALSE
}