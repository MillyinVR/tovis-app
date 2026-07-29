// app/pro/_components/AvailabilityCalendar.tsx
'use client'

// A month calendar that overlays the AUTHED pro's own schedule (booked +
// blocked days, from /api/v1/pro/availability/busy-days) so the pro can pick a
// date around their existing commitments. Returns the chosen day as a
// "YYYY-MM-DD" string via onPick.
//
// Shared by every pro-facing day picker (R3): aftercare rebook, the waitlist
// offer, the new-booking slot picker, and the calendar's reschedule modal.
// The busy-days feed is derived from the SESSION's pro, so this only belongs on
// surfaces where the authed pro is picking a day on their OWN calendar.
//
// Not to be confused with the pro calendar's `MonthGrid`: that one browses an
// already-loaded `CalendarEvent[]` and renders per-event chips. This is a form
// control — it fetches its own per-day aggregate, floors at a minimum day,
// tracks a selection, and emits a date.
//
// Two variants:
//  - "modal" (default): the original popup — backdrop, title, close button;
//    picking a day also closes it.
//  - "inline": just the calendar card, always visible, selection stays put —
//    the primary rebook picker (R1), not a secondary affordance.
//
// The jump chips (+1w / +2w / +4w / Suggested) step the SELECTION forward from
// the currently selected day — tapping "+1w" repeatedly skips ahead a week at
// a time — and never close the modal, so the pro can keep stepping.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { formatInTimeZone, parseYYYYMMDD } from '@/lib/time'
import {
  addDaysToYmd,
  addMonthsToYmd,
  compareYmd,
  todayYmdInTimeZone,
} from '@/lib/booking/rebookDates'
import { zClass } from '@/lib/zIndex'

type DayBusy = { bookings: number; blocked: boolean; openSlots?: number }
type BusyMap = Record<string, DayBusy>

/**
 * What to count open slots FOR (R4). When supplied, the grid stops showing only
 * how full each day already is and starts showing how many bookable starts are
 * left on it — the question a pro opening a date picker is actually asking.
 *
 * Omit it and the calendar keeps its original busy-only behaviour, so a surface
 * that doesn't know the service yet degrades instead of breaking.
 */
export type CalendarSlotContext = {
  serviceId: string
  locationType?: 'SALON' | 'MOBILE' | null
  locationId?: string | null
  /** Selected add-on link ids — they widen the appointment, so they change the count. */
  addOnIds?: string[]
  /**
   * Set when the pro is MOVING this booking. The count is then sized from the
   * booking's committed width, and the booking stops blocking its own day.
   */
  rescheduleBookingId?: string | null
  /**
   * Set when the pro is booking the NEXT appointment from this booking's
   * aftercare. The rebook commit clones the source booking's items (base +
   * add-ons), so the count is sized from that clone width — offering-base
   * counting lights up days the clone doesn't fit.
   */
  rebookOfBookingId?: string | null
}

type Props = {
  open: boolean
  onClose?: () => void
  onPick: (ymd: string) => void
  tz: string
  /** Earliest selectable day (inclusive). Defaults to today in tz. */
  minYmd?: string
  /** Month/day to open on. Defaults to minYmd or today. */
  anchorYmd?: string
  title?: string
  /**
   * Weekday indexes (0=Sun … 6=Sat) the pro's weekly schedule marks disabled.
   * Shaded as "off days" but still selectable — a pro may deliberately book a
   * client on a day their public calendar shows as off (the save asks them to
   * confirm the working-hours override).
   */
  offWeekdays?: ReadonlySet<number> | null
  /** "modal" (default) overlays with a backdrop; "inline" renders the bare card. */
  variant?: 'modal' | 'inline'
  /** The currently chosen day — highlighted, and the base the jump chips step from. */
  selectedYmd?: string | null
  /**
   * The offering's suggested rebook day (service date + rebook interval).
   * When set and still selectable, a "Suggested" jump chip goes straight there.
   */
  suggestedYmd?: string | null
  /** Disables every control (read-only aftercare, in-flight save). */
  disabled?: boolean
  /**
   * Count BOOKABLE starts per day for this service (R4). Omit for the
   * busy-only overlay.
   */
  slotContext?: CalendarSlotContext | null
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const JUMP_CHIPS: { days: number; label: string; aria: string }[] = [
  { days: 7, label: '+1w', aria: 'Skip ahead 1 week' },
  { days: 14, label: '+2w', aria: 'Skip ahead 2 weeks' },
  { days: 28, label: '+4w', aria: 'Skip ahead 4 weeks' },
]

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function firstOfMonth(ymd: string): string {
  const p = parseYYYYMMDD(ymd)
  if (!p) return ymd
  return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-01`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function weekdayOfFirst(y: number, m: number): number {
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
}

function monthLabel(monthYmd: string): string {
  const p = parseYYYYMMDD(monthYmd)
  if (!p) return ''
  try {
    // No explicit locale: month names render in the viewer's own language,
    // like every other pro-surface date label.
    return formatInTimeZone(new Date(Date.UTC(p.year, p.month - 1, 1)), 'UTC', {
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return `${p.year}-${pad2(p.month)}`
  }
}

export default function AvailabilityCalendar({
  open,
  onClose,
  onPick,
  tz,
  minYmd,
  anchorYmd,
  title = 'Pick a date',
  offWeekdays,
  variant = 'modal',
  selectedYmd,
  suggestedYmd,
  disabled = false,
  slotContext,
}: Props) {
  const todayYmd = useMemo(() => todayYmdInTimeZone(tz), [tz])
  const earliest = minYmd && minYmd > todayYmd ? minYmd : todayYmd
  const isModal = variant === 'modal'

  const [viewMonth, setViewMonth] = useState(() =>
    firstOfMonth(anchorYmd && anchorYmd >= earliest ? anchorYmd : earliest),
  )
  const [busy, setBusy] = useState<BusyMap>({})
  const [loading, setLoading] = useState(false)
  // Whether the response actually carried per-day open-slot counts. A request
  // can ask for them and still not get them (service/location resolves to no
  // bookable placement), and the grid must then fall back to the busy overlay
  // rather than render every day as "0 open".
  const [openSlotsComputed, setOpenSlotsComputed] = useState(false)
  // Counts were asked for but the server declined (openSlots.reason set). The
  // grid degrades to the busy overlay; this makes the degrade VISIBLE instead
  // of letting a wide-open month silently masquerade as "no counts feature"
  // ([[authorized-override-needs-visibility]]).
  const [countsUnavailable, setCountsUnavailable] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Stable primitive key: a new object/array identity with the same contents
  // must not retrigger the month fetch.
  const slotContextKey = slotContext
    ? [
        slotContext.serviceId,
        slotContext.locationType ?? '',
        slotContext.locationId ?? '',
        (slotContext.addOnIds ?? []).join(','),
        slotContext.rescheduleBookingId ?? '',
        slotContext.rebookOfBookingId ?? '',
      ].join('|')
    : ''

  // Re-anchor to a sensible month each time the popup opens.
  useEffect(() => {
    if (open) {
      setViewMonth(
        firstOfMonth(anchorYmd && anchorYmd >= earliest ? anchorYmd : earliest),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Follow the selection: when the chosen day changes (fallback date input,
  // step buttons, jump chips), show its month. Browsing ‹/› alone never snaps
  // back — this only runs when the selection itself moves.
  useEffect(() => {
    if (selectedYmd && YMD_RE.test(selectedYmd)) {
      setViewMonth(firstOfMonth(selectedYmd))
    }
  }, [selectedYmd])

  // A changed CONTEXT means the shown counts answer a different question
  // (another service, another width) — clear them rather than let them stand
  // in for the new request while it's in flight. Month browsing alone keeps
  // the previous overlay (same data domain, no flash of wrong numbers).
  useEffect(() => {
    setBusy({})
    setOpenSlotsComputed(false)
    setCountsUnavailable(false)
  }, [slotContextKey])

  useEffect(() => {
    if (!open) return

    const p = parseYYYYMMDD(viewMonth)
    if (!p) return

    const from = `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-01`
    const to = `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(daysInMonth(p.year, p.month))}`

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    const params = new URLSearchParams({ from, to, tz })
    if (slotContext?.serviceId) {
      params.set('serviceId', slotContext.serviceId)
      if (slotContext.locationType) {
        params.set('locationType', slotContext.locationType)
      }
      if (slotContext.locationId) params.set('locationId', slotContext.locationId)
      if (slotContext.addOnIds?.length) {
        params.set('addOnIds', slotContext.addOnIds.join(','))
      }
      if (slotContext.rescheduleBookingId) {
        params.set('rescheduleBookingId', slotContext.rescheduleBookingId)
      }
      if (slotContext.rebookOfBookingId) {
        params.set('rebookOfBookingId', slotContext.rebookOfBookingId)
      }
    }

    fetch(`/api/v1/pro/availability/busy-days?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = await safeJson(res)
        if (!res.ok || !isRecord(data) || !isRecord(data.days)) {
          setBusy({})
          setOpenSlotsComputed(false)
          setCountsUnavailable(false)
          return
        }
        setBusy(data.days as BusyMap)
        const computed =
          isRecord(data.openSlots) && data.openSlots.computed === true
        setOpenSlotsComputed(computed)
        setCountsUnavailable(Boolean(slotContext?.serviceId) && !computed)
      })
      .catch(() => {
        // Aborted or network error — leave the grid usable without overlay.
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null
        setLoading(false)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewMonth, tz, slotContextKey])

  useEffect(() => {
    if (!open || !isModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, isModal, onClose])

  const goPrevMonth = useCallback(() => {
    setViewMonth((m) => firstOfMonth(addMonthsToYmd(m, -1) ?? m))
  }, [])
  const goNextMonth = useCallback(() => {
    setViewMonth((m) => firstOfMonth(addMonthsToYmd(m, 1) ?? m))
  }, [])

  // Jump chips step from the current selection (else the earliest day) and
  // select the target — the month view follows via the selection effect.
  const jumpBase =
    selectedYmd && YMD_RE.test(selectedYmd) && selectedYmd >= earliest
      ? selectedYmd
      : earliest

  const jumpAhead = useCallback(
    (days: number) => {
      const target = addDaysToYmd(jumpBase, days)
      if (target) onPick(target)
    },
    [jumpBase, onPick],
  )

  const suggestedSelectable = Boolean(
    suggestedYmd &&
      YMD_RE.test(suggestedYmd) &&
      compareYmd(suggestedYmd, earliest) >= 0,
  )

  if (!open) return null

  const p = parseYYYYMMDD(viewMonth)
  const cells: Array<{ ymd: string; day: number; weekday: number } | null> = []
  if (p) {
    const lead = weekdayOfFirst(p.year, p.month)
    for (let i = 0; i < lead; i += 1) cells.push(null)
    const total = daysInMonth(p.year, p.month)
    for (let d = 1; d <= total; d += 1) {
      cells.push({
        ymd: `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(d)}`,
        day: d,
        weekday: (lead + d - 1) % 7,
      })
    }
  }

  // Don't allow navigating to months entirely before the earliest month.
  const prevDisabled = disabled || compareYmd(viewMonth, firstOfMonth(earliest)) <= 0

  const chipClass = (chipDisabled: boolean) =>
    [
      'rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black transition',
      chipDisabled
        ? 'cursor-not-allowed bg-bgPrimary text-textSecondary opacity-50'
        : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass/10',
    ].join(' ')

  const calendarBody = (
    <>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goPrevMonth}
          disabled={prevDisabled}
          aria-label="Previous month"
          className={[
            'rounded-full border border-white/10 px-3 py-1 text-xs font-black',
            prevDisabled
              ? 'cursor-not-allowed bg-bgPrimary text-textSecondary opacity-50'
              : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass/10',
          ].join(' ')}
        >
          ‹
        </button>
        <div className="text-sm font-black text-textPrimary">
          {monthLabel(viewMonth)}
        </div>
        <button
          type="button"
          onClick={goNextMonth}
          disabled={disabled}
          aria-label="Next month"
          className={[
            'rounded-full border border-white/10 px-3 py-1 text-xs font-black',
            disabled
              ? 'cursor-not-allowed bg-bgPrimary text-textSecondary opacity-50'
              : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass/10',
          ].join(' ')}
        >
          ›
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-black uppercase tracking-[0.08em] text-textSecondary">
          Skip ahead
        </span>
        {JUMP_CHIPS.map((chip) => (
          <button
            key={chip.days}
            type="button"
            disabled={disabled}
            onClick={() => jumpAhead(chip.days)}
            aria-label={chip.aria}
            className={chipClass(disabled)}
          >
            {chip.label}
          </button>
        ))}
        {suggestedSelectable && suggestedYmd ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(suggestedYmd)}
            aria-label="Jump to the suggested rebook date"
            title="The service date plus this offering’s usual rebook interval"
            className={chipClass(disabled)}
          >
            Suggested
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={`${w}-${i}`}
            className="py-1 text-center text-[10px] font-black text-textSecondary"
          >
            {w}
          </div>
        ))}

        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} />

          const info = busy[cell.ymd]
          const isPast = compareYmd(cell.ymd, earliest) < 0
          const isBlocked = Boolean(info?.blocked)
          const isOffDay = Boolean(offWeekdays?.has(cell.weekday))
          const isSelected = selectedYmd === cell.ymd
          const bookings = info?.bookings ?? 0
          const cellDisabled = disabled || isPast

          // R4: when the server counted bookable starts, THAT is the signal —
          // "where can I fit them" rather than "where am I busy". A day with no
          // openings reads as full even when nothing is booked on it (off day,
          // outside working hours, too short a gap between two appointments).
          const hasCounts = openSlotsComputed && !isPast
          const openCount = info?.openSlots ?? 0
          const isFull = hasCounts && openCount === 0

          // Busy-only wording is unchanged from R1–R3; the counted variant leads
          // with the openings, then adds the same booked/off-day context.
          // (Named cellTitle so it can't shadow the component's `title` prop.)
          let cellTitle: string
          if (isBlocked) {
            cellTitle = 'Time blocked'
          } else if (hasCounts) {
            cellTitle = [
              openCount > 0
                ? `${openCount} open time${openCount === 1 ? '' : 's'}`
                : 'No open times — you can still book a custom time',
              bookings > 0
                ? `${bookings} booking${bookings === 1 ? '' : 's'}`
                : null,
              isOffDay ? 'off day' : null,
            ]
              .filter(Boolean)
              .join(' · ')
          } else if (bookings > 0) {
            cellTitle = `${bookings} booking${bookings === 1 ? '' : 's'}${
              isOffDay ? ' · off day' : ''
            }`
          } else if (isOffDay) {
            cellTitle = 'Off day — you can still book it'
          } else {
            cellTitle = 'Open'
          }

          return (
            <button
              key={cell.ymd}
              type="button"
              disabled={cellDisabled}
              aria-pressed={isSelected}
              onClick={() => {
                onPick(cell.ymd)
                if (isModal) onClose?.()
              }}
              title={cellTitle}
              className={[
                'relative flex aspect-square flex-col items-center justify-center rounded-card border text-xs font-black transition',
                cellDisabled
                  ? 'cursor-not-allowed border-transparent text-textSecondary/40'
                  : isSelected
                    ? 'border-transparent bg-accentPrimary text-bgPrimary'
                    : isBlocked
                      ? 'border-microAccent/40 bg-microAccent/10 text-textPrimary hover:bg-microAccent/20'
                      : isFull
                        ? 'border-white/10 bg-bgPrimary text-textSecondary/60 hover:bg-surfaceGlass/10'
                        : hasCounts
                          ? 'border-toneSuccess/30 bg-toneSuccess/10 text-textPrimary hover:bg-toneSuccess/20'
                          : bookings > 0
                            ? 'border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass/10'
                            : isOffDay
                              ? 'border-dashed border-white/15 bg-bgPrimary text-textSecondary hover:bg-surfaceGlass/10 hover:text-textPrimary'
                              : 'border-white/10 bg-bgPrimary text-textPrimary hover:bg-accentPrimary hover:text-bgPrimary',
              ].join(' ')}
            >
              <span>{cell.day}</span>

              {hasCounts && !isSelected && openCount > 0 ? (
                <span className="mt-0.5 text-[9px] font-black leading-none text-toneSuccess">
                  {openCount}
                </span>
              ) : !hasCounts &&
                !cellDisabled &&
                !isSelected &&
                (isBlocked || bookings > 0) ? (
                <span
                  className={[
                    'mt-0.5 h-1.5 w-1.5 rounded-full',
                    isBlocked ? 'bg-microAccent' : 'bg-accentPrimary',
                  ].join(' ')}
                />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold text-textSecondary">
        {openSlotsComputed ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-toneSuccess" />
            Open times
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accentPrimary" />
            Booked
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-microAccent" />
          Blocked
        </span>
        {offWeekdays && offWeekdays.size > 0 ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-textSecondary" />
            Off day
          </span>
        ) : null}
        <span>{loading ? 'Loading…' : `Times in ${tz}`}</span>
      </div>

      {countsUnavailable && !loading ? (
        <div className="mt-1 text-[10px] font-semibold text-textSecondary">
          Open-time counts aren’t available for this service right now — showing
          your booked days instead.
        </div>
      ) : null}
    </>
  )

  if (!isModal) {
    return (
      <div className="rounded-card border border-white/10 bg-bgSecondary p-3 text-textPrimary">
        {calendarBody}
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 ${zClass.modal} flex items-center justify-center bg-black/60 p-4`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-black text-textPrimary">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-xs font-black text-textSecondary hover:bg-surfaceGlass/10"
          >
            ✕
          </button>
        </div>

        {calendarBody}
      </div>
    </div>
  )
}
