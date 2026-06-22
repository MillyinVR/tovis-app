// lib/clients/relationshipIntelligence.ts
//
// Pure, schema-free derivations for the pro-facing client chart's
// "relationship intelligence" zone. NO Prisma imports, NO DB access — the chart
// page maps its loaded rows into the plain shapes below and feeds them here, so
// every metric and flag is unit-testable in isolation.
//
// Nothing here adds data: it's pure aggregation over bookings/reviews/referrals
// the page already loads (design doc PR2, "derived relationship intelligence").

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/** Plain booking shape the chart maps each Prisma row into. */
export type IntelBooking = {
  status: string
  scheduledFor: Date
  createdAt: Date
  finishedAt: Date | null
  professionalId: string
  /** totalAmount ?? subtotalSnapshot, already coerced to a number (dollars). */
  amount: number | null
}

export type RelationshipIntelligenceInput = {
  bookings: IntelBooking[]
  proId: string
  now: Date
  reviewCount: number
  noteCount: number
  /** Confirmed/converted referrals where this client was the referrer. */
  referredCount: number
  /** This client was themselves referred by someone. */
  wasReferred: boolean
  dateOfBirth: Date | null
  preferredContactMethod: string | null
}

export type SmartFlagTone = 'warn' | 'info' | 'success'

export type SmartFlag = {
  key:
    | 'retention-risk'
    | 'low-review-no-note'
    | 'birthday-soon'
    | 'referred-people'
  label: string
  tone: SmartFlagTone
}

export type RelationshipIntelligence = {
  lifetimeValue: { withYou: number; platform: number }
  /** COMPLETED visits, platform-wide. */
  completedVisits: number
  /** COMPLETED visits with the viewing pro. */
  completedVisitsWithYou: number
  /** Mean interval between consecutive completed visits, in days. */
  cadenceDays: number | null
  /** Mean (scheduledFor − createdAt) over completed visits, in days. */
  avgLeadTimeDays: number | null
  cancelCount: number
  /** Most common weekday of completed visits (e.g. "Saturday"). */
  preferredDay: string | null
  /** Most common time band of completed visits. */
  preferredTimeOfDay: 'Morning' | 'Afternoon' | 'Evening' | null
  lastVisitAt: Date | null
  hasUpcoming: boolean
  daysSinceLastVisit: number | null
  /** Lapsed past the usual interval with nothing on the books. */
  retentionRisk: boolean
  /** Days until the next birthday, if dateOfBirth is known (0..365). */
  daysUntilBirthday: number | null
  preferredContactMethod: string | null
  flags: SmartFlag[]
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

function isCompleted(b: IntelBooking): boolean {
  return b.status === 'COMPLETED'
}

function visitInstant(b: IntelBooking): number {
  return (b.finishedAt ?? b.scheduledFor).getTime()
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Most frequent entry; ties broken by first-seen order. */
function mode<T>(values: T[]): T | null {
  if (values.length === 0) return null
  const counts = new Map<T, number>()
  let best: T | null = null
  let bestCount = 0
  for (const v of values) {
    const next = (counts.get(v) ?? 0) + 1
    counts.set(v, next)
    if (next > bestCount) {
      best = v
      bestCount = next
    }
  }
  return best
}

function timeBand(hour: number): 'Morning' | 'Afternoon' | 'Evening' {
  if (hour < 12) return 'Morning'
  if (hour < 17) return 'Afternoon'
  return 'Evening'
}

/** Whole days until the next anniversary of `dob` from `now` (0 = today). */
function daysUntilNextBirthday(dob: Date, now: Date): number {
  const year = now.getFullYear()
  const candidate = new Date(year, dob.getMonth(), dob.getDate())
  const today = new Date(year, now.getMonth(), now.getDate())
  if (candidate.getTime() < today.getTime()) {
    candidate.setFullYear(year + 1)
  }
  return Math.round((candidate.getTime() - today.getTime()) / DAY_MS)
}

export function computeRelationshipIntelligence(
  input: RelationshipIntelligenceInput,
): RelationshipIntelligence {
  const { bookings, proId, now } = input

  const completed = bookings
    .filter(isCompleted)
    .sort((a, b) => visitInstant(a) - visitInstant(b))

  const withYouCompleted = completed.filter((b) => b.professionalId === proId)

  const platformValue = completed.reduce((sum, b) => sum + (b.amount ?? 0), 0)
  const withYouValue = withYouCompleted.reduce(
    (sum, b) => sum + (b.amount ?? 0),
    0,
  )

  // Cadence: mean gap between consecutive completed visits.
  const intervals: number[] = []
  for (let i = 1; i < completed.length; i += 1) {
    const prev = completed[i - 1]
    const curr = completed[i]
    if (prev && curr) intervals.push(visitInstant(curr) - visitInstant(prev))
  }
  const cadenceMs = mean(intervals)
  const cadenceDays = cadenceMs === null ? null : cadenceMs / DAY_MS

  // Lead time: how far ahead they book (scheduledFor − createdAt).
  const leadTimes = completed
    .map((b) => b.scheduledFor.getTime() - b.createdAt.getTime())
    .filter((ms) => ms >= 0)
  const leadMs = mean(leadTimes)
  const avgLeadTimeDays = leadMs === null ? null : leadMs / DAY_MS

  const cancelCount = bookings.filter((b) => b.status === 'CANCELLED').length

  const preferredDay = mode(
    completed
      .map((b) => WEEKDAYS[b.scheduledFor.getDay()])
      .filter((day): day is (typeof WEEKDAYS)[number] => Boolean(day)),
  )
  const preferredTimeOfDay = mode(
    completed.map((b) => timeBand(b.scheduledFor.getHours())),
  )

  const lastVisit = completed.at(-1) ?? null
  const lastVisitAt = lastVisit
    ? (lastVisit.finishedAt ?? lastVisit.scheduledFor)
    : null
  const daysSinceLastVisit = lastVisitAt
    ? Math.floor((now.getTime() - lastVisitAt.getTime()) / DAY_MS)
    : null

  const hasUpcoming = bookings.some(
    (b) =>
      b.scheduledFor.getTime() > now.getTime() &&
      b.status !== 'CANCELLED' &&
      b.status !== 'COMPLETED',
  )

  // Retention risk: lapsed clearly past the usual interval, nothing booked.
  // Need a cadence to compare against and at least one prior visit.
  const retentionRisk =
    !hasUpcoming &&
    cadenceDays !== null &&
    daysSinceLastVisit !== null &&
    daysSinceLastVisit > cadenceDays * 1.5

  const daysUntilBirthday = input.dateOfBirth // pii-plaintext-read-ok: pure date math, no DB read; birthday is plaintext-by-schema.
    ? daysUntilNextBirthday(input.dateOfBirth, now) // pii-plaintext-read-ok: pure date math, no DB read; birthday is plaintext-by-schema.
    : null

  const flags: SmartFlag[] = []

  if (retentionRisk && daysSinceLastVisit !== null && cadenceDays !== null) {
    const weeksLapsed = Math.round(daysSinceLastVisit / 7)
    const usualWeeks = Math.max(1, Math.round(cadenceDays / 7))
    flags.push({
      key: 'retention-risk',
      label: `Lapsed ${weeksLapsed} wk${weeksLapsed === 1 ? '' : 's'} · usual ~${usualWeeks} wk`,
      tone: 'warn',
    })
  }

  if (input.reviewCount > 0 && input.noteCount === 0) {
    flags.push({
      key: 'low-review-no-note',
      label: 'Left a review · no notes yet',
      tone: 'info',
    })
  }

  if (daysUntilBirthday !== null && daysUntilBirthday <= 14) {
    flags.push({
      key: 'birthday-soon',
      label:
        daysUntilBirthday === 0
          ? 'Birthday today 🎂'
          : `Birthday in ${daysUntilBirthday} day${daysUntilBirthday === 1 ? '' : 's'}`,
      tone: 'success',
    })
  }

  if (input.referredCount > 0) {
    flags.push({
      key: 'referred-people',
      label: `Referred ${input.referredCount} ${input.referredCount === 1 ? 'person' : 'people'}`,
      tone: 'success',
    })
  }

  return {
    lifetimeValue: { withYou: withYouValue, platform: platformValue },
    completedVisits: completed.length,
    completedVisitsWithYou: withYouCompleted.length,
    cadenceDays,
    avgLeadTimeDays,
    cancelCount,
    preferredDay,
    preferredTimeOfDay,
    lastVisitAt,
    hasUpcoming,
    daysSinceLastVisit,
    retentionRisk,
    daysUntilBirthday,
    preferredContactMethod: input.preferredContactMethod,
    flags,
  }
}

/** Human "~every N wks" / "~every N days" from a day cadence. */
export function formatCadence(cadenceDays: number | null): string | null {
  if (cadenceDays === null) return null
  if (cadenceDays >= 7) {
    const weeks = Math.round(cadenceDays / 7)
    return `~every ${weeks} wk${weeks === 1 ? '' : 's'}`
  }
  const days = Math.max(1, Math.round(cadenceDays))
  return `~every ${days} day${days === 1 ? '' : 's'}`
}

/** Whole days remaining in the access window, given its close instant. */
export function daysLeftInWindow(accessUntil: Date, now: Date): number {
  return Math.max(0, Math.ceil((accessUntil.getTime() - now.getTime()) / DAY_MS))
}

export { DAY_MS, WEEK_MS }
