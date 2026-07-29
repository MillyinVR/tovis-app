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
import { formatInTimeZone } from '@/lib/time'
import {
  addDaysToYmd,
  addMonthsToYmd,
  compareYmd,
  todayYmdInTimeZone,
} from '@/lib/booking/rebookDates'
import { zClass } from '@/lib/zIndex'

type DayBusy = { bookings: number; blocked: boolean }
type BusyMap = Record<string, DayBusy>

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

function ymdParts(ymd: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function firstOfMonth(ymd: string): string {
  const p = ymdParts(ymd)
  if (!p) return ymd
  return `${pad2(p.y).padStart(4, '0')}-${pad2(p.m)}-01`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function weekdayOfFirst(y: number, m: number): number {
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
}

function monthLabel(monthYmd: string): string {
  const p = ymdParts(monthYmd)
  if (!p) return ''
  try {
    return formatInTimeZone(
      new Date(Date.UTC(p.y, p.m - 1, 1)),
      'UTC',
      {
        month: 'long',
        year: 'numeric',
      },
      'en-US',
    )
  } catch {
    return `${p.y}-${pad2(p.m)}`
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
}: Props) {
  const todayYmd = useMemo(() => todayYmdInTimeZone(tz), [tz])
  const earliest = minYmd && minYmd > todayYmd ? minYmd : todayYmd
  const isModal = variant === 'modal'

  const [viewMonth, setViewMonth] = useState(() =>
    firstOfMonth(anchorYmd && anchorYmd >= earliest ? anchorYmd : earliest),
  )
  const [busy, setBusy] = useState<BusyMap>({})
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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

  useEffect(() => {
    if (!open) return

    const p = ymdParts(viewMonth)
    if (!p) return

    const from = `${pad2(p.y).padStart(4, '0')}-${pad2(p.m)}-01`
    const to = `${pad2(p.y).padStart(4, '0')}-${pad2(p.m)}-${pad2(daysInMonth(p.y, p.m))}`

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    const params = new URLSearchParams({ from, to, tz })
    fetch(`/api/v1/pro/availability/busy-days?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = await safeJson(res)
        if (!res.ok || !isRecord(data) || !isRecord(data.days)) {
          setBusy({})
          return
        }
        setBusy(data.days as BusyMap)
      })
      .catch(() => {
        // Aborted or network error — leave the grid usable without overlay.
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null
        setLoading(false)
      })

    return () => controller.abort()
  }, [open, viewMonth, tz])

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

  const p = ymdParts(viewMonth)
  const cells: Array<{ ymd: string; day: number; weekday: number } | null> = []
  if (p) {
    const lead = weekdayOfFirst(p.y, p.m)
    for (let i = 0; i < lead; i += 1) cells.push(null)
    const total = daysInMonth(p.y, p.m)
    for (let d = 1; d <= total; d += 1) {
      cells.push({
        ymd: `${pad2(p.y).padStart(4, '0')}-${pad2(p.m)}-${pad2(d)}`,
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
              title={
                isBlocked
                  ? 'Time blocked'
                  : bookings > 0
                    ? `${bookings} booking${bookings === 1 ? '' : 's'}${
                        isOffDay ? ' · off day' : ''
                      }`
                    : isOffDay
                      ? 'Off day — you can still book it'
                      : 'Open'
              }
              className={[
                'relative flex aspect-square flex-col items-center justify-center rounded-card border text-xs font-black transition',
                cellDisabled
                  ? 'cursor-not-allowed border-transparent text-textSecondary/40'
                  : isSelected
                    ? 'border-transparent bg-accentPrimary text-bgPrimary'
                    : isBlocked
                      ? 'border-microAccent/40 bg-microAccent/10 text-textPrimary hover:bg-microAccent/20'
                      : bookings > 0
                        ? 'border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass/10'
                        : isOffDay
                          ? 'border-dashed border-white/15 bg-bgPrimary text-textSecondary hover:bg-surfaceGlass/10 hover:text-textPrimary'
                          : 'border-white/10 bg-bgPrimary text-textPrimary hover:bg-accentPrimary hover:text-bgPrimary',
              ].join(' ')}
            >
              <span>{cell.day}</span>
              {!cellDisabled && !isSelected && (isBlocked || bookings > 0) ? (
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

      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-semibold text-textSecondary">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accentPrimary" />
          Booked
        </span>
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
