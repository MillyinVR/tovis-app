// app/pro/calendar/EditBlockModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

type Props = {
  open: boolean
  blockId: string | null
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

function roundTo15(mins: number) {
  const snapped = Math.round(mins / 15) * 15
  return Math.max(15, Math.min(12 * 60, snapped))
}

export default function EditBlockModal({ open, blockId, onClose, onSaved }: Props) {
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
    } catch (e: any) {
      if (!cancelled) setError(e?.message || 'Failed to load block.')
    } finally {
      if (!cancelled) setLoading(false)
    }
  })()

  return () => {
    cancelled = true
  }
}, [open, blockId])


  async function save() {
    if (!blockId) return // ✅ fixes your TS error source cleanly
    if (!block) return
    if (saving) return

    setSaving(true)
    setError(null)

    try {
      const [yyyy, mm, dd] = (dateStr || '').split('-').map((x) => Number(x))
      if (!yyyy || !mm || !dd) throw new Error('Pick a valid date.')

      const base = new Date(block.startsAt)
      const day = new Date(yyyy, mm - 1, dd, base.getHours(), base.getMinutes(), 0, 0)
      const start = setDateTimeParts(day, startTime)
      const dur = roundTo15(Number(durationMinutes || 60))
      const end = new Date(start.getTime() + dur * 60_000)

      const res = await fetch(`/api/pro/calendar/blocked/${encodeURIComponent(blockId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
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
    if (!blockId) return // ✅ fixes TS + runtime
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
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1400,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #eee',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: 14, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Blocked time</div>
          <button type="button" onClick={onClose} style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
            Close
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {!blockId && (
            <div style={{ fontSize: 12, color: '#666' }}>
              No block selected.
            </div>
          )}

          {blockId && loading && <div style={{ fontSize: 12, color: '#666' }}>Loading…</div>}
          {error && <div style={{ fontSize: 12, color: 'red', marginBottom: 10 }}>{error}</div>}

          {canEdit && block && !loading && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Date</div>
                  <input
                    type="date"
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>Start time</div>
                  <input
                    type="time"
                    step={15 * 60}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
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
                  placeholder="Lunch, admin time, school pickup…"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #ddd', fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={deleting || saving}
                  style={{
                    border: '1px solid #ef4444',
                    background: '#fff',
                    color: '#ef4444',
                    borderRadius: 999,
                    padding: '8px 12px',
                    cursor: deleting || saving ? 'default' : 'pointer',
                    fontSize: 12,
                    fontWeight: 900,
                    opacity: deleting || saving ? 0.7 : 1,
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete block'}
                </button>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving || deleting}
                    style={{ border: '1px solid #ddd', background: '#fff', borderRadius: 999, padding: '8px 12px', cursor: saving || deleting ? 'default' : 'pointer', fontSize: 12 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving || deleting}
                    style={{
                      border: 'none',
                      background: '#111',
                      color: '#fff',
                      borderRadius: 999,
                      padding: '8px 12px',
                      cursor: saving || deleting ? 'default' : 'pointer',
                      fontSize: 12,
                      fontWeight: 900,
                      opacity: saving || deleting ? 0.7 : 1,
                    }}
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
