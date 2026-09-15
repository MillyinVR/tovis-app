// app/pro/_components/DaySchedulePanel.tsx
'use client'

// What is ALREADY on the day the pro just picked — times, who, and what.
//
// The month grid above it can only say "something is here": its overlay
// (`busy-days`) carries counts, never names or times, which is the right shape
// for a grid and the wrong one the moment a pro taps a day to book into it.
// A dot that means "you have a 2pm colour and a blocked school run" and a dot
// that means "one appointment at 8am" are the same dot, so the pro either
// guesses or leaves the flow to go look at their calendar.
//
// So the DETAIL is fetched for the SELECTED DAY ONLY, from the full pro
// calendar feed — one day's worth of events, not a month's — and reduced by the
// one shared helper (`lib/calendar/dayAgenda`) so this list and the grid's dot
// can never disagree about what counts as occupancy.
//
// 🔴 `scope=ALL`, always. `Booking_no_active_professional_overlap` excludes on
// `professionalId` alone — no location term — so a feed filtered to one
// location renders free time that a job at the pro's other location already
// owns. The same reason the overlap warnings ask this way.

import { useEffect, useMemo, useState } from 'react'

import {
  CALENDAR_SCOPE_ALL,
  OVERLAP_CONFLICT_FETCH_WINDOW_MS,
} from '@/lib/calendar/constants'
import { dayAgendaEntries, type DayAgendaEntry } from '@/lib/calendar/dayAgenda'
import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'
import { formatInTimeZone, getUtcIsoBoundsForLocalDate } from '@/lib/time'

type Props = {
  /** The selected day, "YYYY-MM-DD". Nothing renders without one. */
  ymd: string | null
  /** The zone the day's bounds and every time label are resolved in. */
  timeZone: string
}

type DayBounds = { startUtcIso: string; endUtcIso: string }

/** See the debounce comment in the effect below. */
const DAY_SCHEDULE_DEBOUNCE_MS = 300

/**
 * The last settled answer, tagged with the day it answers FOR.
 *
 * Tagged rather than reset: a result for the previous day must never be shown
 * under the new one, and the alternative — clearing the state synchronously
 * inside the effect — is the cascading-render pattern React warns about. So
 * "loading" is DERIVED (the tag doesn't match the selection yet) and the only
 * state write happens when a response actually lands.
 */
type Settled = { key: string; entries: DayAgendaEntry[] | null }

function timeLabel(iso: string, timeZone: string): string {
  try {
    return formatInTimeZone(iso, timeZone, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

/**
 * "9:00 AM – 11:30 AM", with an ellipsis where the entry runs past the day — an
 * overnight block has no honest end time to print on THIS day.
 */
function rangeLabel(entry: DayAgendaEntry, timeZone: string): string {
  const start = entry.continuesBefore ? '…' : timeLabel(entry.startsAt, timeZone)
  const end = entry.continuesAfter ? '…' : timeLabel(entry.endsAt, timeZone)
  return `${start} – ${end}`
}

/**
 * "Thu, Oct 1" for a plain calendar date. Formatted at noon UTC in UTC — the
 * ymd is ALREADY a local date, so resolving it in the pro's zone would shift it
 * back through an offset it was never in and print the wrong weekday.
 */
function dayHeading(ymd: string): string {
  try {
    return formatInTimeZone(`${ymd}T12:00:00.000Z`, 'UTC', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ymd
  }
}

const KIND_TONE: Record<DayAgendaEntry['kind'], string> = {
  BOOKING: 'border-accentPrimary/40 bg-accentPrimary/10',
  BLOCK: 'border-microAccent/40 bg-microAccent/10',
  HOLD: 'border-toneWarn/30 bg-toneWarn/10',
}

const KIND_LABEL: Record<DayAgendaEntry['kind'], string> = {
  BOOKING: 'Booked',
  BLOCK: 'Blocked',
  HOLD: 'Held',
}

export default function DaySchedulePanel({ ymd, timeZone }: Props) {
  const [settled, setSettled] = useState<Settled | null>(null)

  // Null only when the day can't be resolved in this zone at all — a malformed
  // ymd. Computed outside the effect so a failure is a RENDER branch rather
  // than a state write.
  const bounds = useMemo<DayBounds | null>(() => {
    if (!ymd) return null
    try {
      return getUtcIsoBoundsForLocalDate(ymd, timeZone)
    } catch {
      return null
    }
  }, [ymd, timeZone])

  useEffect(() => {
    if (!ymd || !bounds) return

    // Ask from a day EARLIER than the day being shown. The feed filters
    // bookings and holds on `scheduledFor` — their START — so an appointment
    // that began last night and runs past midnight is simply absent from a
    // window that opens at this day's 00:00, and the pro's first hours would
    // render as free time they do not have. The same window the two overlap
    // warnings already use, for the same reason: it covers the longest
    // possible appointment (MAX_SLOT_DURATION 12h) plus its buffer.
    //
    // Nothing widens the DISPLAY: `dayAgendaEntries` clips to the real day and
    // marks what spilled in (`continuesBefore`).
    const controller = new AbortController()
    const fetchFromIso = new Date(
      new Date(bounds.startUtcIso).getTime() - OVERLAP_CONFLICT_FETCH_WINDOW_MS,
    ).toISOString()
    const params = new URLSearchParams({
      from: fetchFromIso,
      to: bounds.endUtcIso,
      scope: CALENDAR_SCOPE_ALL,
    })

    // Debounced, because the skip-ahead chips invite rapid tapping: "+1w" four
    // times is one intention and four selections, and this feed does real work
    // per call (consent requirements, service swatches, the management buckets)
    // regardless of how narrow the range is. Same 300ms the overlap check on
    // the rebook form already uses.
    const timer = window.setTimeout(() => {
      fetch(`/api/v1/pro/calendar?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
        .then(async (res) => {
          const data = await safeJson(res)
          if (!res.ok || !isRecord(data)) {
            setSettled({ key: ymd, entries: null })
            return
          }
          setSettled({
            key: ymd,
            entries: dayAgendaEntries({
              data,
              dayStartIso: bounds.startUtcIso,
              dayEndIso: bounds.endUtcIso,
            }),
          })
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setSettled({ key: ymd, entries: null })
        })
    }, DAY_SCHEDULE_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [ymd, bounds])

  if (!ymd) return null

  // A result still tagged with an older day is not an answer about this one.
  const answer = settled?.key === ymd ? settled : null
  const failed = !bounds || (answer !== null && answer.entries === null)
  const entries = answer?.entries ?? null

  return (
    <div className="mt-3 border-t border-surfaceGlass/10 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-textSecondary">
          That day’s schedule
        </div>
        <div className="text-[10px] font-semibold text-textSecondary">
          {dayHeading(ymd)}
        </div>
      </div>

      {failed ? (
        <div className="mt-2 text-[11px] font-semibold text-textSecondary">
          Couldn’t load that day’s schedule — open your calendar to check before
          you book.
        </div>
      ) : entries === null ? (
        <div className="mt-2 text-[11px] font-semibold text-textSecondary">
          Loading your day…
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-2 text-[11px] font-semibold text-textSecondary">
          Nothing on this day yet.
        </div>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={[
                'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-card border px-2.5 py-1.5 text-textPrimary',
                KIND_TONE[entry.kind],
              ].join(' ')}
            >
              <span className="text-[11px] font-black tabular-nums">
                {rangeLabel(entry, timeZone)}
              </span>
              <span className="text-[11px] font-bold">{entry.name}</span>
              <span className="text-[11px] font-semibold text-textSecondary">
                {entry.detail}
              </span>
              <span className="ml-auto text-[9px] font-black uppercase tracking-[0.08em] text-textSecondary">
                {entry.statusLabel ?? KIND_LABEL[entry.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
