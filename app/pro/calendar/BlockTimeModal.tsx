// app/pro/calendar/BlockTimeModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'

const SNAP_MINUTES = 15

function snapMinutes(mins: number) {
  return Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function toDateInputValueFromParts(parts: { year: number; month: number; day: number }) {
  const yyyy = String(parts.year)
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputValueFromParts(parts: { hour: number; minute: number }) {
  const hh = String(parts.hour).padStart(2, '0')
  const mm = String(parts.minute).padStart(2, '0')
  return `${hh}:${mm}`
}

function parseHHMM(hhmm: string) {
  const [hhStr, mmStr] = (hhmm || '').split(':')
  const hh = Number(hhStr)
  const mm = Number(mmStr)
  return {
    hour: Number.isFinite(hh) ? clamp(hh, 0, 23) : 0,
    minute: Number.isFinite(mm) ? clamp(mm, 0, 59) : 0,
  }
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

export type BlockRow = { id: string; startsAt: string; endsAt: string; note: string | null }

export default function BlockTimeModal(props: {
  open: boolean
  onClose: () => void
  initialStart: Date // UTC instant user clicked
  timeZone: string // pro IANA timezone (may be empty/invalid until setup)
  onCreated: (block: BlockRow) => void
}) {
  const { open, onClose, initialStart, timeZone, onCreated } = props

  // ✅ Always resolve to a valid IANA TZ. Never fall back to LA.
  const tz = useMemo(() => sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE), [timeZone])

  // Build initial inputs: clicked instant rendered into the pro timezone
  const init = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(initialStart)

    const map: Record<string, string> = {}
    for (const p of parts) map[p.type] = p.value

    const year = Number(map.year)
    const month = Number(map.month)
    const day = Number(map.day)

    const hourRaw = Number(map.hour)
    const minuteRaw = Number(map.minute)

    const snapped = snapMinutes(hourRaw * 60 + minuteRaw)
    const hour = clamp(Math.floor(snapped / 60), 0, 23)
    const minute = clamp(snapped % 60, 0, 59)

    return {
      date: toDateInputValueFromParts({ year, month, day }),
      time: toTimeInputValueFromParts({ hour, minute }),
    }
  }, [initialStart, tz])

  const [date, setDate] = useState<string>(init.date)
  const [time, setTime] = useState<string>(init.time)
  const [durationMinutes, setDurationMinutes] = useState<number>(60)
  const [note, setNote] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSaving(false)
    setDate(init.date)
    setTime(init.time)
    setDurationMinutes(60)
    setNote('')
  }, [open, init.date, init.time])

  function close() {
    if (saving) return
    setError(null)
    onClose()
  }

  async function submit() {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const [yyyy, mm, dd] = (date || '').split('-').map((x) => Number(x))
      if (!yyyy || !mm || !dd) throw new Error('Pick a valid date.')

      const t = parseHHMM(time)
      const dur = clamp(snapMinutes(Number(durationMinutes || 60)), 15, 12 * 60)

      // ✅ wall-clock in pro TZ -> UTC instant
      const startUtc = zonedTimeToUtc({
        year: yyyy,
        month: mm,
        day: dd,
        hour: t.hour,
        minute: t.minute,
        second: 0,
        timeZone: tz,
      })

      if (!Number.isFinite(startUtc.getTime())) throw new Error('Invalid start time.')

      const endUtc = new Date(startUtc.getTime() + dur * 60_000)
      if (endUtc.getTime() <= startUtc.getTime()) throw new Error('End time must be after start time.')

      const res = await fetch('/api/pro/calendar/blocked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt: startUtc.toISOString(),
          endsAt: endUtc.toISOString(),
          note: note.trim() ? note.trim() : null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to create block.')

      const block = data?.block as BlockRow
      if (!block?.id) throw new Error('Block created but response was missing data.')

      onCreated(block)
      close()
    } catch (e: any) {
      setError(e?.message || 'Failed to create block.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-1300 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-520px overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div className="text-sm font-extrabold text-textPrimary">Block personal time</div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold text-textPrimary hover:bg-bgSecondary/70 disabled:opacity-70"
          >
            Close
          </button>
        </div>

        <div className="p-4">
          {error && <div className="mb-3 text-xs font-semibold text-toneDanger">{error}</div>}

          <div className="mb-3 text-xs text-textSecondary">
            Timezone: <span className="font-black text-textPrimary">{tz}</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-textSecondary">Date</div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary"
              />
            </div>

            <div>
              <div className="mb-1 text-xs text-textSecondary">Start time</div>
              <input
                type="time"
                step={SNAP_MINUTES * 60}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary"
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 text-xs text-textSecondary">Duration (minutes)</div>
            <input
              type="number"
              step={15}
              min={15}
              max={720}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary"
            />
          </div>

          <div className="mt-3">
            <div className="mb-1 text-xs text-textSecondary">Note (optional)</div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Lunch, dentist, school pickup, etc."
              className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary/70"
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-semibold text-textPrimary hover:bg-bgSecondary/40 disabled:opacity-70"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-full bg-accentPrimary px-4 py-2 text-xs font-extrabold text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-70"
            >
              {saving ? 'Saving…' : 'Create block'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
