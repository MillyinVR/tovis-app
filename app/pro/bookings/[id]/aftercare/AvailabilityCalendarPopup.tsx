// app/pro/bookings/[id]/aftercare/AvailabilityCalendarPopup.tsx
'use client'

// A month-calendar popup that overlays the pro's own schedule (booked + blocked
// days, from /api/v1/pro/availability/busy-days) so the pro can pick a recommended
// next-visit / window date around their existing commitments. Returns the
// chosen day as a "YYYY-MM-DD" string via onPick.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { formatInTimeZone } from '@/lib/time'
import { addMonthsToYmd, compareYmd, todayYmdInTimeZone } from './aftercareDates'
import { zClass } from '@/lib/zIndex'

type DayBusy = { bookings: number; blocked: boolean }
type BusyMap = Record<string, DayBusy>

type Props = {
  open: boolean
  onClose: () => void
  onPick: (ymd: string) => void
  tz: string
  /** Earliest selectable day (inclusive). Defaults to today in tz. */
  minYmd?: string
  /** Month/day to open on. Defaults to minYmd or today. */
  anchorYmd?: string
  title?: string
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

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

export default function AvailabilityCalendarPopup({
  open,
  onClose,
  onPick,
  tz,
  minYmd,
  anchorYmd,
  title = 'Pick a date',
}: Props) {
  const todayYmd = useMemo(() => todayYmdInTimeZone(tz), [tz])
  const earliest = minYmd && minYmd > todayYmd ? minYmd : todayYmd

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
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const goPrevMonth = useCallback(() => {
    setViewMonth((m) => firstOfMonth(addMonthsToYmd(m, -1) ?? m))
  }, [])
  const goNextMonth = useCallback(() => {
    setViewMonth((m) => firstOfMonth(addMonthsToYmd(m, 1) ?? m))
  }, [])

  if (!open) return null

  const p = ymdParts(viewMonth)
  const cells: Array<{ ymd: string; day: number } | null> = []
  if (p) {
    const lead = weekdayOfFirst(p.y, p.m)
    for (let i = 0; i < lead; i += 1) cells.push(null)
    const total = daysInMonth(p.y, p.m)
    for (let d = 1; d <= total; d += 1) {
      cells.push({ ymd: `${pad2(p.y).padStart(4, '0')}-${pad2(p.m)}-${pad2(d)}`, day: d })
    }
  }

  // Don't allow navigating to months entirely before the earliest month.
  const prevDisabled = compareYmd(viewMonth, firstOfMonth(earliest)) <= 0

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
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-black text-textPrimary">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-xs font-black text-textSecondary hover:bg-surfaceGlass"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goPrevMonth}
            disabled={prevDisabled}
            aria-label="Previous month"
            className={[
              'rounded-full border border-white/10 px-3 py-1 text-xs font-black',
              prevDisabled
                ? 'cursor-not-allowed bg-bgPrimary text-textSecondary opacity-50'
                : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
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
            aria-label="Next month"
            className="rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
          >
            ›
          </button>
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
            const bookings = info?.bookings ?? 0
            const disabled = isPast

            return (
              <button
                key={cell.ymd}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(cell.ymd)
                  onClose()
                }}
                title={
                  isBlocked
                    ? 'Time blocked'
                    : bookings > 0
                      ? `${bookings} booking${bookings === 1 ? '' : 's'}`
                      : 'Open'
                }
                className={[
                  'relative flex aspect-square flex-col items-center justify-center rounded-card border text-xs font-black transition',
                  disabled
                    ? 'cursor-not-allowed border-transparent text-textSecondary/40'
                    : isBlocked
                      ? 'border-microAccent/40 bg-microAccent/10 text-textPrimary hover:bg-microAccent/20'
                      : bookings > 0
                        ? 'border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass'
                        : 'border-white/10 bg-bgPrimary text-textPrimary hover:bg-accentPrimary hover:text-bgPrimary',
                ].join(' ')}
              >
                <span>{cell.day}</span>
                {!disabled && (isBlocked || bookings > 0) ? (
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

        <div className="mt-3 flex items-center justify-between text-[10px] font-semibold text-textSecondary">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accentPrimary" />
            Booked
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-microAccent" />
            Blocked
          </span>
          <span>{loading ? 'Loading…' : `Times in ${tz}`}</span>
        </div>
      </div>
    </div>
  )
}
