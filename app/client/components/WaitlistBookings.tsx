// app/client/components/WaitlistBookings.tsx
'use client'

import { useMemo, useState } from 'react'
import type { WaitlistLike } from './_helpers'
import { prettyWhen, locationLabel, Badge } from './_helpers'

type Props = {
  items: WaitlistLike[]
  onChanged?: () => void
}

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToISO(value: string) {
  // datetime-local is interpreted in viewer LOCAL timezone
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 60
  return Math.max(15, Math.min(24 * 60, Math.floor(n)))
}

export default function WaitlistBookings({ items, onChanged }: Props) {
  const list = items ?? []

  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Edit form state
  const [desiredForLocal, setDesiredForLocal] = useState<string>('') // datetime-local
  const [flexMinutes, setFlexMinutes] = useState<number>(60)
  const [timeBucket, setTimeBucket] = useState<string>('')

  const editingItem = useMemo(() => list.find((x) => x.id === editingId) ?? null, [list, editingId])

  function openEdit(w: WaitlistLike) {
    setErr(null)
    setEditingId(w.id)

    // Support both shapes:
    // - preferredStart/preferredEnd on root
    // - availability.preferredStart/preferredEnd (legacy)
    const startISO =
      (w as any)?.preferredStart ??
      (w as any)?.availability?.preferredStart ??
      null

    const endISO =
      (w as any)?.preferredEnd ??
      (w as any)?.availability?.preferredEnd ??
      null

    // Seed desired time
    const seed = (() => {
      if (startISO) {
        const d = new Date(String(startISO))
        if (!Number.isNaN(d.getTime())) return d
      }
      return new Date(Date.now() + 2 * 60 * 60_000)
    })()

    setDesiredForLocal(toDatetimeLocalValue(seed))

    // Infer flexibility from window if we have both start/end
    if (startISO && endISO) {
      const s = new Date(String(startISO))
      const e = new Date(String(endISO))
      const span = e.getTime() - s.getTime()
      if (Number.isFinite(span) && span > 0) {
        setFlexMinutes(clampMinutes(Math.round(span / 2 / 60_000)))
      } else {
        setFlexMinutes(60)
      }
    } else {
      setFlexMinutes(60)
    }

    setTimeBucket(((w as any)?.preferredTimeBucket ?? '').toString())
  }

  function closeEdit() {
    setEditingId(null)
    setErr(null)
  }

  async function saveEdit() {
    if (!editingId) return
    setErr(null)

    const desiredForISO = datetimeLocalToISO(desiredForLocal)
    if (!desiredForISO) {
      setErr('Pick a valid date/time.')
      return
    }

    setBusyId(editingId)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          desiredFor: desiredForISO,
          flexibilityMinutes: clampMinutes(flexMinutes),
          preferredTimeBucket: timeBucket?.trim() ? timeBucket.trim() : null,
        }),
      })

      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to update waitlist.')

      closeEdit()
      onChanged?.()
    } catch (e: any) {
      setErr(e?.message || 'Failed to update waitlist.')
    } finally {
      setBusyId(null)
    }
  }

  async function removeEntry(id: string) {
    setErr(null)
    if (!confirm('Remove this waitlist request?')) return

    setBusyId(id)
    try {
      const res = await fetch(`/api/waitlist?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to remove waitlist.')

      if (editingId === id) closeEdit()
      onChanged?.()
    } catch (e: any) {
      setErr(e?.message || 'Failed to remove waitlist.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 900, marginBottom: 4 }}>Waitlist</div>

      {err ? (
        <div
          style={{
            border: '1px solid #fecaca',
            background: '#fff1f2',
            color: '#7f1d1d',
            padding: 10,
            borderRadius: 12,
            fontSize: 13,
          }}
        >
          {err}
        </div>
      ) : null}

      {list.map((w) => {
        const svc = w?.service?.name || 'Service'
        const pro = w?.professional?.businessName || 'Any professional'
        const joined = prettyWhen(w?.createdAt)
        const loc = locationLabel(w?.professional)

        const isEditing = editingId === w.id
        const isBusy = busyId === w.id

        return (
          <div key={w.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <div style={{ fontWeight: 900 }}>{svc}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Joined {joined}</div>
            </div>

            <div style={{ fontSize: 13, marginTop: 4 }}>
              <span style={{ fontWeight: 900 }}>{pro}</span>
              {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <Badge label="Waitlisted" bg="#f3f4f6" color="#111827" />

              {!isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => openEdit(w)}
                    disabled={isBusy}
                    style={{
                      marginLeft: 'auto',
                      border: '1px solid #ddd',
                      borderRadius: 999,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 900,
                      background: '#fff',
                      cursor: isBusy ? 'default' : 'pointer',
                      opacity: isBusy ? 0.7 : 1,
                    }}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => removeEntry(w.id)}
                    disabled={isBusy}
                    style={{
                      border: '1px solid #fecaca',
                      borderRadius: 999,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 900,
                      background: '#fff1f2',
                      color: '#9f1239',
                      cursor: isBusy ? 'default' : 'pointer',
                      opacity: isBusy ? 0.7 : 1,
                    }}
                  >
                    {isBusy ? 'Working…' : 'Remove'}
                  </button>
                </>
              ) : null}
            </div>

            {isEditing ? (
              <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12, display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Set a preferred time and flexibility. We’ll store a window around it.
                </div>

                <label style={{ fontSize: 13, color: '#111' }}>
                  Desired time
                  <input
                    type="datetime-local"
                    value={desiredForLocal}
                    onChange={(e) => setDesiredForLocal(e.target.value)}
                    disabled={isBusy}
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #ddd',
                    }}
                  />
                </label>

                <label style={{ fontSize: 13, color: '#111' }}>
                  Flexibility (minutes)
                  <input
                    type="number"
                    value={flexMinutes}
                    onChange={(e) => setFlexMinutes(clampMinutes(Number(e.target.value) || 60))}
                    disabled={isBusy}
                    min={15}
                    max={24 * 60}
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #ddd',
                    }}
                  />
                </label>

                <label style={{ fontSize: 13, color: '#111' }}>
                  Preferred time bucket (optional)
                  <select
                    value={timeBucket}
                    onChange={(e) => setTimeBucket(e.target.value)}
                    disabled={isBusy}
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #ddd',
                      background: '#fff',
                    }}
                  >
                    <option value="">No preference</option>
                    <option value="MORNING">Morning</option>
                    <option value="AFTERNOON">Afternoon</option>
                    <option value="EVENING">Evening</option>
                  </select>
                </label>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={closeEdit}
                    disabled={isBusy}
                    style={{
                      border: '1px solid #ddd',
                      borderRadius: 999,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 900,
                      background: '#fff',
                      cursor: isBusy ? 'default' : 'pointer',
                      opacity: isBusy ? 0.7 : 1,
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={isBusy}
                    style={{
                      border: 'none',
                      borderRadius: 999,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 900,
                      background: '#111',
                      color: '#fff',
                      cursor: isBusy ? 'default' : 'pointer',
                      opacity: isBusy ? 0.7 : 1,
                    }}
                  >
                    {isBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}

      {list.length === 0 ? <div style={{ color: '#6b7280', fontSize: 13 }}>No waitlist entries.</div> : null}
    </div>
  )
}
