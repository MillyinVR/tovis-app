// lib/time/relativeTime.ts

type RelativeBucket =
  | { unit: 'now' }
  | { unit: 'minute' | 'hour' | 'day' | 'week'; value: number }
  | { unit: 'older'; at: Date }

/**
 * Shared bucketing core for relative timestamps. Returns the coarsest unit that
 * fits, or an `older` bucket (carrying the Date) once it crosses `weekCap`
 * weeks. Callers render the labels so wording ("5m" vs "5m ago") and the
 * older-than fallback stay caller-specific. Returns null for unparseable input.
 */
function bucketRelativeTime(
  input: string | Date,
  weekCap: number,
): RelativeBucket | null {
  const then = input instanceof Date ? input.getTime() : new Date(input).getTime()
  if (Number.isNaN(then)) return null

  const diffMs = Math.max(0, Date.now() - then)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return { unit: 'now' }
  if (minutes < 60) return { unit: 'minute', value: minutes }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hour', value: hours }

  const days = Math.floor(hours / 24)
  if (days < 7) return { unit: 'day', value: days }

  const weeks = Math.floor(days / 7)
  if (weeks < weekCap) return { unit: 'week', value: weeks }

  return { unit: 'older', at: new Date(then) }
}

/**
 * Compact, social-feed-style relative timestamp ("now", "5m", "3h", "2d",
 * "4w") that falls back to a short calendar date once it's older than ~a year.
 * Matches how TikTok/Instagram label comments. Accepts an ISO string or Date;
 * returns '' for unparseable input.
 */
export function formatRelativeTimeCompact(input: string | Date): string {
  const bucket = bucketRelativeTime(input, 52)
  if (!bucket) return ''

  switch (bucket.unit) {
    case 'now':
      return 'now'
    case 'minute':
      return `${bucket.value}m`
    case 'hour':
      return `${bucket.value}h`
    case 'day':
      return `${bucket.value}d`
    case 'week':
      return `${bucket.value}w`
    case 'older':
      return bucket.at.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
  }
}

/**
 * "ago"-suffixed relative timestamp ("just now", "5m ago", "3h ago", "2d ago",
 * "4w ago") for activity-feed surfaces, falling back to a short month/day date
 * after ~a month. Same bucketing as {@link formatRelativeTimeCompact}; only the
 * wording and fallback differ. Returns '' for unparseable input.
 */
export function formatRelativeTimeAgo(input: string | Date): string {
  const bucket = bucketRelativeTime(input, 5)
  if (!bucket) return ''

  switch (bucket.unit) {
    case 'now':
      return 'just now'
    case 'minute':
      return `${bucket.value}m ago`
    case 'hour':
      return `${bucket.value}h ago`
    case 'day':
      return `${bucket.value}d ago`
    case 'week':
      return `${bucket.value}w ago`
    case 'older':
      return bucket.at.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
  }
}
