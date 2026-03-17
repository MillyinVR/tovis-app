// app/client/components/WaitlistBookings.tsx
'use client'

import { useMemo, useState } from 'react'
import type { WaitlistLike } from './_helpers'
import { prettyWhen, waitlistLocationLabel } from './_helpers'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import ProProfileLink from './ProProfileLink'
import { safeJson, readErrorMessage, errorMessageFromUnknown } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

type Props = {
  items: WaitlistLike[]
  onChanged?: () => void
}

type WaitlistPreferenceType = 'ANY_TIME' | 'TIME_OF_DAY' | 'SPECIFIC_DATE' | 'TIME_RANGE'
type WaitlistTimeOfDay = 'MORNING' | 'AFTERNOON' | 'EVENING'

const DEFAULT_BROWSER_TIME_ZONE = 'UTC'

function getBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && isValidIanaTimeZone(tz)) return tz
  } catch {
    // ignore
  }
  return DEFAULT_BROWSER_TIME_ZONE
}

function apiErrorMessage(data: unknown, fallback: string): string {
  return readErrorMessage(data) ?? (isRecord(data) ? pickString(data.error) : null) ?? fallback
}

function parsePreferenceType(value: unknown): WaitlistPreferenceType | null {
  if (
    value === 'ANY_TIME' ||
    value === 'TIME_OF_DAY' ||
    value === 'SPECIFIC_DATE' ||
    value === 'TIME_RANGE'
  ) {
    return value
  }
  return null
}

function parseTimeOfDay(value: unknown): WaitlistTimeOfDay | null {
  if (value === 'MORNING' || value === 'AFTERNOON' || value === 'EVENING') return value
  return null
}

function clampMinuteOfDay(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1440) return 1440
  return Math.floor(value)
}

function minutesToTimeInput(value: number | null): string {
  if (value == null || value < 0 || value > 1440) return ''
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  return `${hh}:${mm}`
}

function timeInputToMinutes(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  return hours * 60 + minutes
}

function formatPreferenceSummary(w: WaitlistLike): string {
  const preferenceType = parsePreferenceType(w.preferenceType)

  if (preferenceType === 'TIME_OF_DAY') {
    const timeOfDay = parseTimeOfDay(w.timeOfDay)
    if (timeOfDay === 'MORNING') return 'Morning'
    if (timeOfDay === 'AFTERNOON') return 'Afternoon'
    if (timeOfDay === 'EVENING') return 'Evening'
    return 'Time of day'
  }

  if (preferenceType === 'SPECIFIC_DATE') {
    const dateValue = typeof w.specificDate === 'string' ? w.specificDate : null
    return dateValue ? `Specific day: ${dateValue.slice(0, 10)}` : 'Specific day'
  }

  if (preferenceType === 'TIME_RANGE') {
    const start = typeof w.windowStartMin === 'number' ? minutesToTimeInput(w.windowStartMin) : ''
    const end = typeof w.windowEndMin === 'number' ? minutesToTimeInput(w.windowEndMin) : ''
    if (start && end) return `Time range: ${start}–${end}`
    return 'Time range'
  }

  return 'Any time'
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
  const tz = useMemo(() => getBrowserTimeZone(), [])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [preferenceType, setPreferenceType] = useState<WaitlistPreferenceType>('ANY_TIME')
  const [specificDate, setSpecificDate] = useState<string>('')
  const [timeOfDay, setTimeOfDay] = useState<WaitlistTimeOfDay | ''>('')
  const [windowStart, setWindowStart] = useState<string>('')
  const [windowEnd, setWindowEnd] = useState<string>('')

  const editingItem = useMemo(
    () => list.find((x) => x.id === editingId) ?? null,
    [list, editingId],
  )

  function openEdit(w: WaitlistLike) {
    setErr(null)
    setEditingId(w.id)

    const nextPreferenceType = parsePreferenceType(w.preferenceType) ?? 'ANY_TIME'
    setPreferenceType(nextPreferenceType)

    setSpecificDate(typeof w.specificDate === 'string' ? w.specificDate.slice(0, 10) : '')

    const nextTimeOfDay = parseTimeOfDay(w.timeOfDay)
    setTimeOfDay(nextTimeOfDay ?? '')

    setWindowStart(typeof w.windowStartMin === 'number' ? minutesToTimeInput(w.windowStartMin) : '')
    setWindowEnd(typeof w.windowEndMin === 'number' ? minutesToTimeInput(w.windowEndMin) : '')
  }

  function closeEdit() {
    setEditingId(null)
    setErr(null)
  }

  async function saveEdit() {
    if (!editingId) return
    setErr(null)

    let nextSpecificDate: string | null = null
    let nextTimeOfDay: WaitlistTimeOfDay | null = null
    let nextWindowStartMin: number | null = null
    let nextWindowEndMin: number | null = null

    if (preferenceType === 'SPECIFIC_DATE') {
      if (!specificDate) {
        setErr('Pick a valid date.')
        return
      }
      nextSpecificDate = specificDate
    }

    if (preferenceType === 'TIME_OF_DAY') {
      const parsed = parseTimeOfDay(timeOfDay)
      if (!parsed) {
        setErr('Pick a valid time of day.')
        return
      }
      nextTimeOfDay = parsed
    }

    if (preferenceType === 'TIME_RANGE') {
      const startMin = timeInputToMinutes(windowStart)
      const endMin = timeInputToMinutes(windowEnd)

      if (startMin == null || endMin == null) {
        setErr('Pick a valid start and end time.')
        return
      }

      const clampedStart = clampMinuteOfDay(startMin)
      const clampedEnd = clampMinuteOfDay(endMin)

      if (clampedEnd <= clampedStart) {
        setErr('End time must be after start time.')
        return
      }

      nextWindowStartMin = clampedStart
      nextWindowEndMin = clampedEnd
    }

    setBusyId(editingId)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          preferenceType,
          specificDate: nextSpecificDate,
          timeOfDay: nextTimeOfDay,
          windowStartMin: nextWindowStartMin,
          windowEndMin: nextWindowEndMin,
        }),
      })

      const data: unknown = await safeJson(res)
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, 'Failed to update waitlist.'))
      }

      closeEdit()
      onChanged?.()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Failed to update waitlist.'))
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
      const data: unknown = await safeJson(res)
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, 'Failed to remove waitlist.'))
      }

      if (editingId === id) closeEdit()
      onChanged?.()
    } catch (e: unknown) {
      setErr(errorMessageFromUnknown(e, 'Failed to remove waitlist.'))
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
        const preferenceSummary = formatPreferenceSummary(w)

        return (
          <div key={w.id} className="rounded-card border border-white/10 bg-bgPrimary p-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-black text-textPrimary">{svc}</div>
              <div className="text-xs font-semibold text-textSecondary">Joined {joined}</div>
            </div>

            <div className="mt-1 text-sm text-textPrimary">
              <span
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ProProfileLink
                  proId={w?.professional?.id || null}
                  label={w?.professional?.businessName || 'Any professional'}
                  className="font-black"
                />
              </span>

              {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
            </div>

            <div className="mt-2 text-xs font-semibold text-textSecondary">{preferenceSummary}</div>

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
                  Update your waitlist preference.
                </div>

                <label className="text-sm font-semibold text-textPrimary">
                  Preference type
                  <select
                    value={preferenceType}
                    onChange={(e) => {
                      const next = parsePreferenceType(e.target.value)
                      if (!next) return

                      setPreferenceType(next)

                      if (next !== 'SPECIFIC_DATE') setSpecificDate('')
                      if (next !== 'TIME_OF_DAY') setTimeOfDay('')
                      if (next !== 'TIME_RANGE') {
                        setWindowStart('')
                        setWindowEnd('')
                      }
                    }}
                    disabled={isBusy}
                    className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                  >
                    <option value="ANY_TIME">Any time</option>
                    <option value="TIME_OF_DAY">Time of day</option>
                    <option value="SPECIFIC_DATE">Specific day</option>
                    <option value="TIME_RANGE">Time range</option>
                  </select>
                </label>

                {preferenceType === 'TIME_OF_DAY' ? (
                  <label className="text-sm font-semibold text-textPrimary">
                    Time of day
                    <select
                      value={timeOfDay}
                      onChange={(e) => {
                        const next = parseTimeOfDay(e.target.value)
                        setTimeOfDay(next ?? '')
                      }}
                      disabled={isBusy}
                      className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                    >
                      <option value="">Choose one</option>
                      <option value="MORNING">Morning</option>
                      <option value="AFTERNOON">Afternoon</option>
                      <option value="EVENING">Evening</option>
                    </select>
                  </label>
                ) : null}

                {preferenceType === 'SPECIFIC_DATE' ? (
                  <label className="text-sm font-semibold text-textPrimary">
                    Preferred day
                    <input
                      type="date"
                      value={specificDate}
                      onChange={(e) => setSpecificDate(e.target.value)}
                      disabled={isBusy}
                      className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                    />
                  </label>
                ) : null}

                {preferenceType === 'TIME_RANGE' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-textPrimary">
                      Start time
                      <input
                        type="time"
                        value={windowStart}
                        onChange={(e) => setWindowStart(e.target.value)}
                        disabled={isBusy}
                        className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                      />
                    </label>

                    <label className="text-sm font-semibold text-textPrimary">
                      End time
                      <input
                        type="time"
                        value={windowEnd}
                        onChange={(e) => setWindowEnd(e.target.value)}
                        disabled={isBusy}
                        className="mt-1 w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
                      />
                    </label>
                  </div>
                ) : null}

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