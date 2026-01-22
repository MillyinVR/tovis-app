// app/pro/calendar/EditBlockModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { isValidIanaTimeZone, zonedToUtc, ymdInTimeZone, minutesSinceMidnightInTimeZone } from './_utils/date'
import { computeDurationMinutesFromIso } from './_utils/calendarMath'

type Props = {
  open: boolean
  blockId: string | null
  timeZone: string
  onClose: () => void
  onSaved: () => void
}

type BlockDto = {
  id: string
  startsAt: string
  endsAt: string
  note?: string | null
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function toTimeInputValueFromMinutes(minutes: number) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function minutesSinceMidnightInTz(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const hh = Number(map.hour)
  const mm = Number(map.minute)
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0)
}

function roundTo15(mins: number) {
  const snapped = Math.round(mins / 15) * 15
  return Math.max(15, Math.min(12 * 60, snapped))
}

export default function EditBlockModal({ open, blockId, timeZone, onClose, onSaved }: Props) {
  const tz = isValidIanaTimeZone(timeZone) ? timeZone : 'America/Los_Angeles'

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [block, setBlock] = useState<BlockDto | null>(null)

  const [dateStr, setDateStr] = useState('')
  const [startTime, setStartTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<number>(60)
  const [note, setNote] = useState<string>('')

  const canEdit = useMemo(() => open && Boolean(blockId), [open, blockId])

  useEffect(() => {
    if (!open) return
    if (!blockId) return

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/pro/calendar/blocked/${encodeURIComponent(blockId)}`, { cache: 'no-store' })
        const data = await safeJson(res)
        if (!res.ok) throw new Error(data?.error || `Failed to load block (${res.status}).`)

        const b = (data?.block ?? data) as BlockDto
        if (cancelled) return

        setBlock(b)

        const start = new Date(b.startsAt)
        const ymd = ymdInTimeZone(start, tz)
        setDateStr(ymd)

        const startMins = minutesSinceMidnightInTimeZone(start, tz)
        setStartTime(toTimeInputValueFromMinutes(startMins))

        const dur = roundTo15(computeDurationMinutesFromIso(b.startsAt, b.endsAt))
        setDurationMinutes(dur)

        setNote((b.note ?? '').toString())
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load block.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, blockId, tz])

  async function save() {
    if (!blockId) return
    if (!block) return
    if (saving) return

    setSaving(true)
    setError(null)

    try {
      const [yyyy, mm, dd] = (dateStr || '').split('-').map((x) => Number(x))
      if (!yyyy || !mm || !dd) throw new Error('Pick a valid date.')

      const [hhStr, miStr] = (startTime || '').split(':')
      const hh = Number(hhStr)
      const mi = Number(miStr)
      if (!Number.isFinite(hh) || !Number.isFinite(mi)) throw new Error('Pick a valid start time.')

      const dur = roundTo15(Number(durationMinutes || 60))
      const startUtc = zonedToUtc({ year: yyyy, month: mm, day: dd, hour: hh, minute: mi, timeZone: tz })
      const endUtc = new Date(startUtc.getTime() + dur * 60_000)

      const res = await fetch(`/api/pro/calendar/blocked/${encodeURIComponent(blockId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt: startUtc.toISOString(),
          endsAt: endUtc.toISOString(),
          note: note.trim() ? note.trim() : null,
        }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to save.')

      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!blockId) return
    if (deleting) return

    setDeleting(true)
    setError(null)

    try {
      const res = await fetch(`/api/pro/calendar/blocked/${encodeURIComponent(blockId)}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to delete.')

      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete.')
    } finally {
      setDeleting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-1400 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-bgSecondary px-4 py-3">
          <div className="text-sm font-extrabold text-textPrimary">Blocked time</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/60"
          >
            Close
          </button>
        </div>

        {/* body */}
        <div className="px-4 py-4">
          {!blockId && (
            <div className="text-xs text-textSecondary">No block selected.</div>
          )}

          {blockId && loading && (
            <div className="text-xs text-textSecondary">Loading…</div>
          )}

          {error && (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          {canEdit && block && !loading && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-[11px] font-extrabold text-textSecondary">Date</div>
                  <input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none ring-0 placeholder:text-textSecondary focus:border-white/20"
                  />
                </div>

                <div>
                  <div className="mb-1 text-[11px] font-extrabold text-textSecondary">Start time</div>
                  <input
                    type="time"
                    step={15 * 60}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none ring-0 focus:border-white/20"
                  />
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 text-[11px] font-extrabold text-textSecondary">Duration (minutes)</div>
                <input
                  type="number"
                  step={15}
                  min={15}
                  max={720}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none ring-0 focus:border-white/20"
                />
              </div>

              <div className="mt-3">
                <div className="mb-1 text-[11px] font-extrabold text-textSecondary">Note (optional)</div>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Lunch, admin time, school pickup…"
                  className="w-full rounded-xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none ring-0 placeholder:text-textSecondary focus:border-white/20"
                />
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={deleting || saving}
                  className={[
                    'rounded-full border px-4 py-2 text-xs font-extrabold',
                    'border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15',
                    deleting || saving ? 'cursor-not-allowed opacity-60' : '',
                  ].join(' ')}
                >
                  {deleting ? 'Deleting…' : 'Delete block'}
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving || deleting}
                    className={[
                      'rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/60',
                      saving || deleting ? 'cursor-not-allowed opacity-60' : '',
                    ].join(' ')}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || deleting}
                    className={[
                      'rounded-full px-4 py-2 text-xs font-extrabold text-black',
                      'bg-brandGold hover:brightness-110',
                      saving || deleting ? 'cursor-not-allowed opacity-60' : '',
                    ].join(' ')}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
