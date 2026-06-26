// lib/time/index.ts
//
// Single import surface for all date/time + timezone handling.
//
// Import time helpers from `@/lib/time` — not from raw `Intl.DateTimeFormat`,
// `Date.prototype.toLocale*String`, or the individual helper modules. The
// `check:no-raw-datetime-format` guard enforces "no raw Intl/toLocale*"; this
// barrel is the place that answers "then what do I import instead?".
//
// Mental model — store instants as UTC, only resolve a timezone at the edges:
//   1. WHICH timezone wins?   resolveApptTimeZone* / resolveAppointmentSchedulingContext
//   2. UTC instant -> display  formatInTimeZone / formatAppointmentWhen / formatSlot*
//   3. wall clock <-> UTC      dateTimeLocalToUtc* / utc*ToDateTimeLocal / *ToUtc / utc*Local*
//   4. viewer's own zone       getViewerTimeZone (hints only, never scheduling truth)

// 1. Which timezone wins (precedence: booking snapshot -> hold -> location -> pro -> fallback)
export {
  resolveApptTimeZone,
  resolveApptTimeZoneFromValues,
  resolveSchedulingTimeZone,
  resolveSchedulingTimeZoneFromValues,
  resolveAppointmentSchedulingContext,
} from '@/lib/booking/timeZoneTruth'
export type {
  IanaTimeZone,
} from '@/lib/timeZone'
export type {
  TimeZoneTruthSource,
  TimeZoneTruthResult,
  TimeZoneTruthArgs,
  AppointmentSchedulingContext,
  AppointmentSchedulingContextResult,
} from '@/lib/booking/timeZoneTruth'

// Timezone validation / labels / defaults
export {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  sanitizeTimeZone,
  pickTimeZoneOrNull,
  friendlyTimeZoneLabel,
} from '@/lib/timeZone'

// Low-level timezone math (UTC <-> zoned parts / offset / day boundaries).
// Prefer the higher-level helpers below; reach for these only for custom math.
export {
  getZonedParts,
  timeZoneOffsetMinutes,
  zonedTimeToUtc,
  startOfDayUtcInTimeZone,
  ymdInTimeZone,
  minutesSinceMidnightInTimeZone,
  weekdayInTimeZone,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'

// 2. Display formatting (sanitized + explicit timeZone)
export {
  formatInTimeZone,
  formatAppointmentWhen,
  formatRangeInTimeZone,
} from '@/lib/formatInTimeZone'

// Booking-edge display + parsing helpers
export {
  getViewerTimeZone,
  formatSlotLabel,
  formatSlotFullLabel,
  getHourInTimeZone,
  ymdInTimeZoneFromIso,
  toISOFromDatetimeLocalInTimeZone,
  partsToUtcIsoStrict,
  datetimeLocalToUtcIsoStrict,
  WALL_TIME_ERROR_MESSAGE,
  isoToDatetimeLocalInTimeZone,
  formatInBookingTimeZone,
} from '@/lib/bookingTime'
export type { WallTimeToUtcResult } from '@/lib/bookingTime'

// 3. wall clock <-> UTC, local-day bounds, datetime-local <-> UTC
export {
  formatDateTimeLocalParts,
  utcDateToDateTimeLocal,
  utcIsoToDateTimeLocal,
  dateTimeLocalToUtcDate,
  dateTimeLocalToUtcIso,
  getUtcBoundsForLocalDate,
  getUtcIsoBoundsForLocalDate,
  utcDateToLocalYmd,
  utcIsoToLocalYmd,
  utcDateToLocalParts,
  zonedPartsToUtcStrict,
} from '@/lib/booking/dateTime'

// Client-side input <-> UTC helpers (datetime-local form fields)
export {
  utcIsoToDateInputValue,
  utcIsoToTimeInputValue,
  combineDateAndTimeInput,
  dateTimeLocalToUtcIso as dateTimeLocalToUtcIsoClient,
  formatUtcInAppointmentTz,
  formatUtcInViewerTz,
} from '@/lib/bookingDateTimeClient'

// Relative ("5m", "3h", "2d") timestamps for social/feed surfaces
export { formatRelativeTimeCompact } from '@/lib/time/relativeTime'
