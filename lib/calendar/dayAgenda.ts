// lib/calendar/dayAgenda.ts
//
// Reads a `/api/v1/pro/calendar` response down to "what is actually on this
// day" — the agenda a pro needs when a date picker's cell says something is
// there but not WHAT, WHEN, or whether it is even a client.
//
// The counting overlay (`/api/v1/pro/availability/busy-days`) deliberately
// carries no names, ids or times: it answers "which days am I busy", and that
// is all a month grid should see. The moment a pro PICKS one of those days to
// book into, the honest answer needs the times — so the day's detail comes from
// the full feed instead, and only for the one selected day.
//
// Two rules keep this list and the grid's dot from contradicting each other:
//
//  1. Only OCCUPYING bookings count. The feed ships everything except
//     CANCELLED, so DECLINED/NO_SHOW rows would appear here as commitments the
//     pro does not have — while `busy-days` counts `BOOKING_BLOCKING_STATUSES`
//     alone. Filtering to that same set is what makes "2 bookings" on the cell
//     mean the two rows underneath it.
//  2. Holds are KEPT even though the dot never counted them (B5). A live
//     checkout genuinely owns that time and the pro cannot see it any other
//     way; it is labelled as its own kind rather than mixed in with bookings,
//     so an extra row reads as extra INFORMATION, not as a miscount.
//
// Framework-neutral and pure: no React, no fetch, no Prisma. The caller owns
// the request and the timezone.

import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'
import { labelForBookingStatus } from '@/lib/booking/statusLabel'
import {
  DEFAULT_BLOCK_CLIENT_NAME,
  DEFAULT_BLOCK_TITLE,
  DEFAULT_BOOKING_CLIENT_NAME,
  DEFAULT_BOOKING_SERVICE_NAME,
  DEFAULT_HOLD_CLIENT_NAME,
  DEFAULT_HOLD_TITLE,
} from '@/lib/calendar/constants'
import { isRecord } from '@/lib/guards'

export type DayAgendaKind = 'BOOKING' | 'BLOCK' | 'HOLD'

export type DayAgendaEntry = {
  /** The feed's own event id — namespaced for blocks/holds, so unique per day. */
  id: string
  kind: DayAgendaKind
  startsAt: string
  endsAt: string
  /**
   * WHOSE time this is: the client's name, "Personal" for the pro's own block,
   * or the anonymous hold label. Never empty — an unnamed client falls back to
   * the same word the calendar card uses.
   */
  name: string
  /** The service (booking), the block's note, or the hold's fixed title. */
  detail: string
  /**
   * The booking's lifecycle word ("Pending", "Confirmed", …) via THE canonical
   * table, so this row can never spell a status differently from the bookings
   * list. null for blocks and holds, which have no lifecycle.
   */
  statusLabel: string | null
  /** The entry starts before this day — it spilled in from yesterday. */
  continuesBefore: boolean
  /** The entry ends after this day — an overnight block, usually. */
  continuesAfter: boolean
}

/**
 * Ceiling on rendered rows. A real day cannot hit this; a nonsense payload
 * must not be able to turn into a nonsense list.
 */
export const DAY_AGENDA_MAX_ENTRIES = 50

const OCCUPYING_STATUSES = new Set<string>(BOOKING_BLOCKING_STATUSES)

function msOrNull(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function trimmedOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * The occupancy on `[dayStartIso, dayEndIso)`, in start order.
 *
 * Half-open on BOTH ends, matching every other overlap read in the app
 * (`lib/calendar/overlap`): an appointment that ends exactly at midnight
 * belongs to the day it ran in, not to the next one.
 */
export function dayAgendaEntries(args: {
  data: unknown
  dayStartIso: string
  dayEndIso: string
}): DayAgendaEntry[] {
  const { data, dayStartIso, dayEndIso } = args

  const dayStartMs = msOrNull(dayStartIso)
  const dayEndMs = msOrNull(dayEndIso)
  if (dayStartMs === null || dayEndMs === null || dayEndMs <= dayStartMs) {
    return []
  }

  if (!isRecord(data) || !Array.isArray(data.events)) return []

  const entries: DayAgendaEntry[] = []

  for (const item of data.events) {
    if (!isRecord(item)) continue

    const kind = item.kind
    if (kind !== 'BOOKING' && kind !== 'BLOCK' && kind !== 'HOLD') continue

    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const startsAt = typeof item.startsAt === 'string' ? item.startsAt : ''
    const endsAt = typeof item.endsAt === 'string' ? item.endsAt : ''
    const startMs = msOrNull(startsAt)
    const endMs = msOrNull(endsAt)
    if (!id || startMs === null || endMs === null || endMs <= startMs) continue

    // Half-open overlap with the day.
    if (startMs >= dayEndMs || endMs <= dayStartMs) continue

    let name: string
    let detail: string
    let statusLabel: string | null = null

    if (kind === 'BOOKING') {
      const status = typeof item.status === 'string' ? item.status : ''
      // Rule 1: only time the pro actually owes someone.
      if (!OCCUPYING_STATUSES.has(status)) continue
      name = trimmedOr(item.clientName, DEFAULT_BOOKING_CLIENT_NAME)
      detail = trimmedOr(item.title, DEFAULT_BOOKING_SERVICE_NAME)
      statusLabel = labelForBookingStatus(status) || null
    } else if (kind === 'BLOCK') {
      // The route already folds the note into `title`, falling back to the
      // default — so this reads the one field rather than re-deriving it.
      name = trimmedOr(item.clientName, DEFAULT_BLOCK_CLIENT_NAME)
      detail = trimmedOr(item.title, DEFAULT_BLOCK_TITLE)
    } else {
      name = trimmedOr(item.clientName, DEFAULT_HOLD_CLIENT_NAME)
      detail = trimmedOr(item.title, DEFAULT_HOLD_TITLE)
    }

    entries.push({
      id,
      kind,
      startsAt,
      endsAt,
      name,
      detail,
      statusLabel,
      continuesBefore: startMs < dayStartMs,
      continuesAfter: endMs > dayEndMs,
    })
  }

  // Start order, then the longer entry first, then id — a total order, so the
  // list cannot reshuffle between two renders of the same data.
  entries.sort((a, b) => {
    const startDiff =
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    if (startDiff !== 0) return startDiff
    const endDiff = new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
    if (endDiff !== 0) return endDiff
    return a.id.localeCompare(b.id)
  })

  return entries.slice(0, DAY_AGENDA_MAX_ENTRIES)
}
