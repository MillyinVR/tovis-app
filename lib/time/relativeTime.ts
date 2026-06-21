// lib/time/relativeTime.ts

/**
 * Compact, social-feed-style relative timestamp ("now", "5m", "3h", "2d",
 * "4w") that falls back to a short calendar date once it's older than ~a year.
 * Matches how TikTok/Instagram label comments. Accepts an ISO string or Date;
 * returns '' for unparseable input.
 */
export function formatRelativeTimeCompact(input: string | Date): string {
  const then = input instanceof Date ? input.getTime() : new Date(input).getTime()
  if (Number.isNaN(then)) return ''

  const diffMs = Math.max(0, Date.now() - then)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 52) return `${weeks}w`

  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
