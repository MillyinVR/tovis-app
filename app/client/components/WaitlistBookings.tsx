// app/client/components/WaitlistBookings.tsx
'use client'

import { useMemo, useState } from 'react'
import type { WaitlistLike } from './_helpers'
import { prettyWhen, locationLabel } from './_helpers'

type Props = {
  items: WaitlistLike[]
  onChanged?: () => void
}

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

function datetimeLocalToISO(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 60
  return Math.max(15, Math.min(24 * 60, Math.floor(n)))
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

export default function WaitlistBookings({ items, onChanged }: Props) {
  const list = items ?? []

  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [desiredForLocal, setDesiredForLocal] = useState<string>('') // datetime-local
  const [flexMinutes, setFlexMinutes] = useState<number>(60)
  const [timeBucket, setTimeBucket] = useState<string>('')

  const editingItem = useMemo(
    () => list.find((x) => x.id === editingId) ?? null,
    [list, editingId],
  )

  function openEdit(w: WaitlistLike) {
    setErr(null)
    setEditingId(w.id)

    const startISO =
      (w as any)?.preferredStart ?? (w as any)?.availability?.preferredStart ?? null
    const endISO =
      (w as any)?.preferredEnd ?? (w as any)?.availability?.preferredEnd ?? null

    const seed = (() => {
      if (startISO) {
        const d = new Date(String(startISO))
        if (!Number.isNaN(d.getTime())) return d
      }
      return new Date(Date.now() + 2 * 60 * 60_000)
    })()

    setDesiredForLocal(toDatetimeLocalValue(seed))

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
      const res = await fetch(`/api/waitlist?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
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
    <div className="grid gap-2">
      <div className="text-sm font-black text-textPrimary">Waitlist</div>

      {err ? (
        <div className="rounded-card border border-white/10 bg-surfaceGlass p-3 text-sm font-semibold text-microAccent">
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
          <div key={w.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-black text-textPrimary">{svc}</div>
              <div className="text-xs font-semibold text-textSecondary">Joined {joined}</div>
            </div>

            <div className="mt-1 text-sm text-textPrimary">
              <span className="font-black">{pro}</span>
              {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill>Waitlisted</Pill>

              {!isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => openEdit(w)}
                    disabled={isBusy}
                    className={[
                      'ml-auto rounded-full px-3 py-2 text-xs font-black transition',
                      isBusy
                        ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                        : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
                    ].join(' ')}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => removeEntry(w.id)}
                    disabled={isBusy}
                    className={[
                      'rounded-full px-3 py-2 text-xs font-black transition',
                      isBusy
                        ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                        : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
                    ].join(' ')}
                  >
                    {isBusy ? 'Working…' : 'Remove'}
                  </button>
                </>
              ) : null}
            </div>

            {isEditing ? (
              <div className="mt-4 grid gap-3 border-t border-white/10 pt-4">
                <div className="text-xs font-medium text-textSecondary">
                  Set a preferred time and flexibility. We’ll store a window around it.
                </div>

                <label className="text-sm font-semibold text-textPrimary">
                  Desired time
                  <input
                    type="datetime-local"
                    value={desiredForLocal}
                    onChange={(e) => setDesiredForLocal(e.target.value)}
                    disabled={isBusy}
                    className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                  />
                </label>

                <label className="text-sm font-semibold text-textPrimary">
                  Flexibility (minutes)
                  <input
                    type="number"
                    value={flexMinutes}
                    onChange={(e) =>
                      setFlexMinutes(clampMinutes(Number(e.target.value) || 60))
                    }
                    disabled={isBusy}
                    min={15}
                    max={24 * 60}
                    className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                  />
                </label>

                <label className="text-sm font-semibold text-textPrimary">
                  Preferred time bucket (optional)
                  <select
                    value={timeBucket}
                    onChange={(e) => setTimeBucket(e.target.value)}
                    disabled={isBusy}
                    className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                  >
                    <option value="">No preference</option>
                    <option value="MORNING">Morning</option>
                    <option value="AFTERNOON">Afternoon</option>
                    <option value="EVENING">Evening</option>
                  </select>
                </label>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeEdit}
                    disabled={isBusy}
                    className={[
                      'rounded-full px-3 py-2 text-xs font-black transition',
                      isBusy
                        ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                        : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
                    ].join(' ')}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={isBusy}
                    className={[
                      'rounded-full px-3 py-2 text-xs font-black transition',
                      isBusy
                        ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                        : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                    ].join(' ')}
                  >
                    {isBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}

      {list.length === 0 ? (
        <div className="text-sm font-medium text-textSecondary">No waitlist entries.</div>
      ) : null}
    </div>
  )
}
