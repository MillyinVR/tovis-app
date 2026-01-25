// app/client/components/WaitlistBookings.tsx
'use client'

import { useMemo, useState } from 'react'
import type { WaitlistLike } from './_helpers'
import { prettyWhen, waitlistLocationLabel } from './_helpers'
import { isValidIanaTimeZone, sanitizeTimeZone, getZonedParts, zonedTimeToUtc } from '@/lib/timeZone'
import ProProfileLink from './ProProfileLink'

type Props = {
  items: WaitlistLike[]
  onChanged?: () => void
}

function getBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && isValidIanaTimeZone(tz)) return tz
  } catch {
    // ignore
  }
  return 'UTC'
}

function clampMinutes(n: number) {
  if (!Number.isFinite(n)) return 60
  return Math.max(15, Math.min(24 * 60, Math.floor(n)))
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * ISO UTC -> datetime-local value in the given timeZone
 * (avoid browser implicit conversions)
 */
function toDatetimeLocalValueInTimeZone(isoUtc: string, timeZone: string) {
  const d = toDate(isoUtc)
  if (!d) return ''
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(d, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * datetime-local -> UTC ISO, interpreting wall-clock time in timeZone
 */
function datetimeLocalToIsoInTimeZone(value: string, timeZone: string) {
  if (!value || typeof value !== 'string') return null
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const utc = zonedTimeToUtc({ year, month, day, hour, minute, second: 0, timeZone: tz })
  return Number.isNaN(utc.getTime()) ? null : utc.toISOString()
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

  // Client UX: treat datetime-local as browser timezone wall clock
  const tz = useMemo(() => getBrowserTimeZone(), [])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [desiredForLocal, setDesiredForLocal] = useState<string>('') // datetime-local (wall clock)
  const [flexMinutes, setFlexMinutes] = useState<number>(60)
  const [timeBucket, setTimeBucket] = useState<string>('')

  const editingItem = useMemo(() => list.find((x) => x.id === editingId) ?? null, [list, editingId])

  function openEdit(w: WaitlistLike) {
    setErr(null)
    setEditingId(w.id)

    const startISO = w?.preferredStart ?? null
    const endISO = w?.preferredEnd ?? null

    const seedIso = (() => {
      const d = startISO ? toDate(startISO) : null
      if (d) return d.toISOString()
      return new Date(Date.now() + 2 * 60 * 60_000).toISOString()
    })()

    setDesiredForLocal(toDatetimeLocalValueInTimeZone(seedIso, tz))

    if (startISO && endISO) {
      const s = toDate(startISO)
      const e = toDate(endISO)
      if (s && e) {
        const span = e.getTime() - s.getTime()
        if (Number.isFinite(span) && span > 0) {
          setFlexMinutes(clampMinutes(Math.round(span / 2 / 60_000)))
        } else {
          setFlexMinutes(60)
        }
      } else {
        setFlexMinutes(60)
      }
    } else {
      setFlexMinutes(60)
    }

    setTimeBucket((w?.preferredTimeBucket ?? '').toString())
  }

  function closeEdit() {
    setEditingId(null)
    setErr(null)
  }

  async function saveEdit() {
    if (!editingId) return
    setErr(null)

    const desiredForISO = datetimeLocalToIsoInTimeZone(desiredForLocal, tz)
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
        const joined = prettyWhen(w?.createdAt, tz)
        const loc = waitlistLocationLabel(w?.professional)

        const isEditing = editingId === w.id
        const isBusy = busyId === w.id

        return (
          <div key={w.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-black text-textPrimary">{svc}</div>
              <div className="text-xs font-semibold text-textSecondary">Joined {joined}</div>
            </div>

            <div className="mt-1 text-sm text-textPrimary">
              <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                <ProProfileLink
                  proId={w?.professional?.id || null}
                  label={w?.professional?.businessName || 'Any professional'}
                  className="font-black"
                />
              </span>

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
                  Set a preferred time and flexibility. We’ll store a window around it.{' '}
                  <span className="opacity-75">({sanitizeTimeZone(tz, 'UTC')})</span>
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
                    onChange={(e) => setFlexMinutes(clampMinutes(Number(e.target.value) || 60))}
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

      {list.length === 0 ? <div className="text-sm font-medium text-textSecondary">No waitlist entries.</div> : null}
    </div>
  )
}
