// lib/notifications/relativeWhen.ts
//
// The "how long until X" phrase shared by the pro-facing warning notifications.
//
// Three builders had each grown their own copy of the same two steps — round the
// gap up to whole days, then say it — and they had already drifted: appointment
// reminders read a 7-day lead as "in one week", while the handle-reservation and
// licence warnings read the same gap as "in 7 days". Consolidating the rule does
// not settle that difference; it puts the shared part in one place and leaves the
// week wording at the one call site where it is deliberate.

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whole days from `from` until `target`, rounded UP and floored at 1.
 *
 * Floored at 1 because these phrases are only built for a warning already
 * selected for sending — the window is still open, so "in 0 days" is not a state
 * the copy has to describe.
 */
export function wholeDaysUntil(target: Date, from: Date): number {
  return Math.max(
    1,
    Math.ceil((target.getTime() - from.getTime()) / MS_PER_DAY),
  )
}

/** One day out reads as "tomorrow"; anything else as "in N days". */
export function relativeDayPhrase(days: number): string {
  return days === 1 ? 'tomorrow' : `in ${days} days`
}
