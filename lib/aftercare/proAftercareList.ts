// lib/aftercare/proAftercareList.ts
//
// Pure, serializable view-model derivation for the pro "all aftercare" list at
// /pro/aftercare. The page server-component loads the raw AftercareSummary rows
// (plus the resolved appointment timezone and any confirmed next booking) and
// hands each one to {@link deriveProAftercareCard}; the resulting cards are
// JSON-serializable so they cross the server→client boundary into the
// interactive list. Sorting, counts, and the at-a-glance summary live here too,
// so the rendering layers stay dumb.
//
// Status model (Draft → Sent → Finished):
//   draft     — saved, not yet sent to the client.
//   sent      — sent, but payment is still pending (not PAID/WAIVED).
//   finished  — sent AND payment is resolved (PAID or WAIVED). "No pending
//               payment = finished." A rebook does NOT decide this: rebooking is
//               itself gated on resolved payment, so every confirmed next booking
//               already implies a finished card. A paid client who hasn't rebooked
//               is still finished — but keeps a rebook nudge (the loop can reopen
//               any time; rebooking stays available after finish).
//
// Rebook chip (the dual-date logic) — keyed on the booking, not the status:
//   recommended — pro entered a window/date, not yet booked.
//   overdue     — that window/date is in the past with no booking.
//   next        — a confirmed next booking exists; show its actual date.
//
// Time is rendered through `@/lib/time` (never raw Intl/toLocale*).

import { AftercareRebookMode, BookingCheckoutStatus } from '@prisma/client'

import { formatInTimeZone, getZonedParts } from '@/lib/time'

export type ProAftercareCardStatus = 'draft' | 'sent' | 'finished'
export type ProAftercareRebookKind = 'recommended' | 'overdue' | 'next'
export type ProAftercareAction = 'send' | 'nudge'
export type ProAftercareSortMode = 'needs' | 'recent'

/** The minimal, framework-free shape the page must resolve for each summary. */
export type ProAftercareRowInput = {
  id: string
  bookingId: string
  createdAt: Date
  draftSavedAt: Date | null
  sentToClientAt: Date | null
  rebookMode: AftercareRebookMode
  rebookedFor: Date | null
  rebookWindowStart: Date | null
  rebookWindowEnd: Date | null
  /** Date the appointment this aftercare is *for* is/was scheduled. */
  scheduledFor: Date | null
  serviceName: string | null
  clientName: string
  /** Resolved appointment timezone (IANA) for this row. */
  timeZone: string
  /**
   * Checkout state of the appointment this aftercare is for. `finished` means
   * payment is resolved — PAID or WAIVED. Null is treated as unresolved.
   */
  checkoutStatus: BookingCheckoutStatus | null
  /** A confirmed next booking off this aftercare, or null if none/awaiting. */
  nextBooking: { scheduledFor: Date | null; bookedAt: Date } | null
}

export type ProAftercareCard = {
  id: string
  bookingId: string
  href: string
  serviceName: string
  clientName: string
  initials: string
  status: ProAftercareCardStatus
  /** Date of the booking this aftercare is for, e.g. "Jun 18", or null. */
  bookingDateLabel: string | null
  rebook: { kind: ProAftercareRebookKind; value: string } | null
  /** Relative activity stamp: verb + compact value (e.g. "sent" + "18d"). */
  ago: { verb: 'saved' | 'sent' | 'booked'; value: string } | null
  action: ProAftercareAction | null
  needsAction: boolean
  /** Lowercased "client service" text for in-memory search. */
  searchText: string
  /** Activity timestamp (ms) used as the secondary sort key. */
  sortKey: number
}

export type ProAftercareCounts = {
  all: number
  draft: number
  sent: number
  finished: number
}

export type ProAftercareSummary = {
  drafts: number
  awaiting: number
  overdue: number
  hasOverdue: boolean
}

const HREF_PREFIX = '/pro/bookings/'
const HREF_SUFFIX = '/aftercare'

export function proAftercareHref(bookingId: string): string {
  return `${HREF_PREFIX}${encodeURIComponent(bookingId)}${HREF_SUFFIX}`
}

function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
  if (words.length === 0) return '—'
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'
}

function formatDay(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, { month: 'short', day: 'numeric' })
}

// "Aug 1–8" when the window stays in one month; "Aug 28 – Sep 3" across months.
function formatWindow(start: Date, end: Date, timeZone: string): string {
  const startLabel = formatDay(start, timeZone)
  const sp = getZonedParts(start, timeZone)
  const ep = getZonedParts(end, timeZone)
  const sameMonth = sp.year === ep.year && sp.month === ep.month
  const endLabel = sameMonth ? String(ep.day) : formatDay(end, timeZone)
  return sameMonth ? `${startLabel}–${endLabel}` : `${startLabel} – ${endLabel}`
}

// Compact, day-granular relative stamp ("now", "5m", "3h", "18d"). Days never
// roll up to weeks here (the list shows "Sent 18d ago", not "2w").
function compactAgo(from: Date, now: number): string {
  const ms = Math.max(0, now - from.getTime())
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function deriveProAftercareCard(
  row: ProAftercareRowInput,
  opts: { now?: number } = {},
): ProAftercareCard {
  // Defaulted here (a plain lib fn) rather than in the server component, where
  // calling `Date.now()` during render trips the react purity lint.
  const now = opts.now ?? Date.now()
  const serviceName = row.serviceName?.trim() || ''
  const clientName = row.clientName.trim() || ''

  // Finished = sent AND payment resolved (PAID/WAIVED). Sending is still a
  // prerequisite — a paid appointment whose aftercare was never sent stays a
  // draft (the pro still owes the client the send).
  const paymentResolved =
    row.checkoutStatus === BookingCheckoutStatus.PAID ||
    row.checkoutStatus === BookingCheckoutStatus.WAIVED
  const hasNextBooking = row.nextBooking != null
  const status: ProAftercareCardStatus = !row.sentToClientAt
    ? 'draft'
    : paymentResolved
      ? 'finished'
      : 'sent'

  // Rebook chip — a confirmed next booking wins; otherwise surface the pro's
  // recommended window/date. This is independent of the finished label: a
  // finished (paid) card that hasn't rebooked still shows its rebook target so
  // the pro can keep chasing the next appointment.
  let rebook: ProAftercareCard['rebook'] = null
  if (hasNextBooking && row.nextBooking?.scheduledFor) {
    rebook = { kind: 'next', value: formatDay(row.nextBooking.scheduledFor, row.timeZone) }
  } else if (!hasNextBooking && row.rebookMode !== AftercareRebookMode.NONE) {
    const value =
      row.rebookWindowStart && row.rebookWindowEnd
        ? formatWindow(row.rebookWindowStart, row.rebookWindowEnd, row.timeZone)
        : row.rebookedFor
          ? formatDay(row.rebookedFor, row.timeZone)
          : null

    if (value) {
      const refEnd = row.rebookWindowEnd ?? row.rebookedFor
      const overdue = refEnd != null && refEnd.getTime() < now
      rebook = { kind: overdue ? 'overdue' : 'recommended', value }
    }
  }

  // Relative activity stamp + sort key — keyed on the actual booking, so the
  // "booked" stamp only shows once a next appointment is confirmed.
  let ago: ProAftercareCard['ago'] = null
  let sortKey = row.createdAt.getTime()
  if (hasNextBooking && row.nextBooking) {
    ago = { verb: 'booked', value: compactAgo(row.nextBooking.bookedAt, now) }
    sortKey = row.nextBooking.bookedAt.getTime()
  } else if (row.sentToClientAt) {
    ago = { verb: 'sent', value: compactAgo(row.sentToClientAt, now) }
    sortKey = row.sentToClientAt.getTime()
  } else if (row.draftSavedAt) {
    ago = { verb: 'saved', value: compactAgo(row.draftSavedAt, now) }
    sortKey = row.draftSavedAt.getTime()
  } else {
    ago = { verb: 'saved', value: compactAgo(row.createdAt, now) }
  }

  // Draft → send it. Once a next appointment is booked the loop is fully closed
  // (no action). Otherwise the rebook loop is still open — including a finished
  // (paid) card that hasn't rebooked — so offer a nudge. `nudgeAftercareRebook`
  // only requires the aftercare to have been sent, which every non-draft card is.
  const action: ProAftercareAction | null =
    status === 'draft' ? 'send' : hasNextBooking ? null : 'nudge'

  return {
    id: row.id,
    bookingId: row.bookingId,
    href: proAftercareHref(row.bookingId),
    serviceName,
    clientName,
    initials: initialsFor(clientName),
    status,
    bookingDateLabel: row.scheduledFor ? formatDay(row.scheduledFor, row.timeZone) : null,
    rebook,
    ago,
    action,
    needsAction: action != null,
    searchText: `${clientName} ${serviceName}`.toLowerCase(),
    sortKey,
  }
}

// "Needs action" rank: open loops first — drafts, then overdue, then
// awaiting-a-nudge, then fully-closed (paid + rebooked) last. Keyed on the
// action, not the status label, so a finished-but-not-rebooked card still sorts
// up among the open loops rather than dropping to the bottom.
function needsActionRank(card: ProAftercareCard): number {
  if (card.status === 'draft') return 0
  if (card.action == null) return 3
  return card.rebook?.kind === 'overdue' ? 1 : 2
}

export function compareProAftercareCards(
  a: ProAftercareCard,
  b: ProAftercareCard,
  mode: ProAftercareSortMode,
): number {
  if (mode === 'needs') {
    const rank = needsActionRank(a) - needsActionRank(b)
    if (rank !== 0) return rank
  }
  // Most recent activity first (also the tiebreaker within a "needs" rank).
  return b.sortKey - a.sortKey
}

export function sortProAftercareCards<T extends ProAftercareCard>(
  cards: T[],
  mode: ProAftercareSortMode,
): T[] {
  return [...cards].sort((a, b) => compareProAftercareCards(a, b, mode))
}

export function countProAftercareCards(cards: ProAftercareCard[]): ProAftercareCounts {
  return {
    all: cards.length,
    draft: cards.filter((c) => c.status === 'draft').length,
    sent: cards.filter((c) => c.status === 'sent').length,
    finished: cards.filter((c) => c.status === 'finished').length,
  }
}

export function summarizeProAftercareCards(
  cards: ProAftercareCard[],
): ProAftercareSummary {
  const drafts = cards.filter((c) => c.status === 'draft').length
  // Awaiting your follow-up: sent, loop still open (a nudge is offered). Includes
  // finished-but-not-rebooked cards, which still await the next appointment.
  const awaiting = cards.filter((c) => c.action === 'nudge').length
  const overdue = cards.filter((c) => c.rebook?.kind === 'overdue').length
  return { drafts, awaiting, overdue, hasOverdue: overdue > 0 }
}
