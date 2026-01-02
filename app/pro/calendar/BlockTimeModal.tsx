// app/pro/calendar/BlockTimeModal.tsx
'use client'

import { useMemo, useState } from 'react'

const SNAP_MINUTES = 15

function startOfDay(d: Date) {
  const nd = new Date(d)
  nd.setHours(0, 0, 0, 0)
  return nd
}

function snapMinutes(mins: number) {
  return Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES
}

function toDateInputValue(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputValue(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function setDateTimeParts(baseDate: Date, hhmm: string) {
  const [hhStr, mmStr] = (hhmm || '').split(':')
  const hh = Number(hhStr)
  const mm = Number(mmStr)
  const out = new Date(baseDate)
  out.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0)
  return out
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

export type BlockRow = { id: string; startsAt: string; endsAt: string; note: string | null }

export default function BlockTimeModal(props: {
  open: boolean
  onClose: () => void
  initialStart: Date
  onCreated: (block: BlockRow) => void
}) {
  const { open, onClose, initialStart, onCreated } = props

  const init = useMemo(() => {
    const d = new Date(initialStart)
    const mins = snapMinutes(d.getHours() * 60 + d.getMinutes())
    d.setMinutes(mins, 0, 0)
    return d
  }, [initialStart])

  const [date, setDate] = useState<string>(toDateInputValue(init))
  const [time, setTime] = useState<string>(toTimeInputValue(init))
  const [durationMinutes, setDurationMinutes] = useState<number>(60)
  const [note, setNote] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when opened
  if (open && date === '' && time === '') {
    // no-op, just preventing TS paranoia in some configs
  }

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

      const base = startOfDay(new Date(yyyy, mm - 1, dd))
      const start = setDateTimeParts(base, time)

      const dur = Math.max(15, Math.min(12 * 60, snapMinutes(Number(durationMinutes || 60))))
      const end = new Date(start.getTime() + dur * 60_000)

      const res = await fetch('/api/pro/calendar/blocked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
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
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1300,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #eee',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: 14, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 900 }}>Block personal time</div>
          <button type="button" onClick={close} style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
            Close
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {error && <div style={{ fontSize: 12, color: 'red', marginBottom: 10 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Date</div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Start time</div>
              <input
                type="time"
                step={SNAP_MINUTES * 60}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
              />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Duration (minutes)</div>
            <input
              type="number"
              step={15}
              min={15}
              max={720}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Note (optional)</div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Lunch, dentist, school pickup, etc."
              style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={close} style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontSize: 12 }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              style={{
                border: 'none',
                background: '#111',
                color: '#fff',
                borderRadius: 999,
                padding: '8px 12px',
                cursor: saving ? 'default' : 'pointer',
                fontSize: 12,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Create block'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
