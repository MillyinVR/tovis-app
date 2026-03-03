// app/pro/calendar/BlockTimeModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone, zonedTimeToUtc, getZonedParts } from '@/lib/timeZone'
import { safeJson } from './_utils/http'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snapToStep(mins: number, stepMinutes: number) {
  const step = clamp(Math.trunc(stepMinutes || 15), 5, 60)
  return Math.round(mins / step) * step
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function getString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function errorFrom(data: unknown, fallback: string) {
  if (!isRecord(data)) return fallback
  return getString(data.error) ?? getString(data.message) ?? fallback
}

export type BlockRow = { id: string; startsAt: string; endsAt: string; note: string | null; locationId?: string | null }

export default function BlockTimeModal(props: {
  open: boolean
  onClose: () => void
  initialStart: Date // UTC instant user clicked
  timeZone: string // pro/location IANA timezone (may be empty/invalid until setup)

  // ✅ location context
  locationId: string | null
  locationLabel?: string | null

  // ✅ calendar step minutes (prefer location.stepMinutes)
  stepMinutes?: number

  onCreated: (block: BlockRow) => void
}) {
  const { open, onClose, initialStart, timeZone, onCreated, locationId, locationLabel, stepMinutes } = props

  // ✅ Always resolve to a valid IANA TZ. Never fall back to LA.
  const tz = useMemo(() => sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE), [timeZone])

  const step = useMemo(() => {
    const n = Number(stepMinutes ?? 15)
    return Number.isFinite(n) ? clamp(Math.trunc(n), 5, 60) : 15
  }, [stepMinutes])

  // If locationId is null, we can only create a GLOBAL block.
  const [blockAllLocations, setBlockAllLocations] = useState<boolean>(locationId ? false : true)

  // Build initial inputs: clicked instant rendered into the pro timezone
  const init = useMemo(() => {
    const p = getZonedParts(initialStart, tz)
    const snapped = snapToStep(p.hour * 60 + p.minute, step)
    const hour = clamp(Math.floor(snapped / 60), 0, 23)
    const minute = clamp(snapped % 60, 0, 59)

    return {
      date: toDateInputValueFromParts({ year: p.year, month: p.month, day: p.day }),
      time: toTimeInputValueFromParts({ hour, minute }),
    }
  }, [initialStart, tz, step])

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
    setBlockAllLocations(locationId ? false : true)
  }, [open, init.date, init.time, locationId])

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

      const durRaw = Number(durationMinutes || 60)
      const durSnapped = snapToStep(durRaw, step)
      const dur = clamp(durSnapped, step, 12 * 60)

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

      // If user chose location-specific but we don't have one, refuse (trustworthy behavior).
      if (!blockAllLocations && !locationId) {
        throw new Error('Select a location first, or choose “Block all locations”.')
      }

      const payload = {
        startsAt: startUtc.toISOString(),
        endsAt: endUtc.toISOString(),
        note: note.trim() ? note.trim() : null,
        locationId: blockAllLocations ? null : locationId,
      }

      const res = await fetch('/api/pro/calendar/blocked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data: unknown = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(data, 'Failed to create block.'))

      if (!isRecord(data) || !isRecord(data.block)) throw new Error('Block created but response was missing data.')

      const b = data.block
      const id = getString(b.id)
      const startsAtOut = getString(b.startsAt)
      const endsAtOut = getString(b.endsAt)
      const noteOut = getString(b.note)
      const locOut = (getString(b.locationId) ?? null) as string | null

      if (!id || !startsAtOut || !endsAtOut) throw new Error('Block created but response was missing data.')

      onCreated({ id, startsAt: startsAtOut, endsAt: endsAtOut, note: noteOut ?? null, locationId: locOut })
      close()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create block.')
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

          <div className="mb-3 rounded-2xl border border-white/10 bg-bgSecondary/30 p-3 text-xs text-textSecondary">
            <div>
              Location:{' '}
              <span className="font-black text-textPrimary">{locationLabel || locationId || 'All locations'}</span>
            </div>
            <div className="mt-1">
              TZ: <span className="font-black text-textPrimary">{tz}</span> • Step:{' '}
              <span className="font-black text-textPrimary">{step} min</span>
            </div>

            {locationId ? (
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-textPrimary">
                <input
                  type="checkbox"
                  checked={blockAllLocations}
                  onChange={(e) => setBlockAllLocations(e.target.checked)}
                  disabled={saving}
                />
                Block all locations
              </label>
            ) : (
              <div className="mt-2 text-xs font-semibold text-textSecondary">
                No location selected — this block will apply to all locations.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-textSecondary">Date</div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={saving}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary"
              />
            </div>

            <div>
              <div className="mb-1 text-xs text-textSecondary">Start time</div>
              <input
                type="time"
                step={step * 60}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={saving}
                className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary"
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 text-xs text-textSecondary">Duration (minutes)</div>
            <input
              type="number"
              step={step}
              min={step}
              max={720}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              disabled={saving}
              className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary"
            />
          </div>

          <div className="mt-3">
            <div className="mb-1 text-xs text-textSecondary">Note (optional)</div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
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