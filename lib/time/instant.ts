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
