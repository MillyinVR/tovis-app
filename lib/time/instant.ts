const MILLISECONDS_PER_ELAPSED_DAY = 24 * 60 * 60 * 1_000

/**
 * Add a fixed number of elapsed 24-hour periods to a UTC instant.
 *
 * This is intentionally not calendar-day math. Use the zoned calendar helpers
 * from `@/lib/time` when a user's local date is the policy boundary.
 */
export function addElapsedDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * MILLISECONDS_PER_ELAPSED_DAY)
}

const MILLISECONDS_PER_ELAPSED_HOUR = 60 * 60 * 1_000

/**
 * Add (or, with a negative count, subtract) a fixed number of elapsed hours.
 *
 * Like `addElapsedDays` this is deliberately NOT calendar math: it is the
 * "exact instant offset" rule sub-day appointment-reminder leads already use
 * (lib/notifications/appointmentReminders.ts). A prep deadline of
 * "the appointment minus 48 hours" means 48 hours of real time, whatever the
 * client's zone does about daylight saving in between.
 */
export function addElapsedHours(instant: Date, hours: number): Date {
  return new Date(instant.getTime() + hours * MILLISECONDS_PER_ELAPSED_HOUR)
}
