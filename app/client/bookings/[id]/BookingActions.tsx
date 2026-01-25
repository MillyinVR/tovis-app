// app/client/bookings/[id]/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sanitizeTimeZone, getZonedParts, zonedTimeToUtc } from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/FormatInTimeZone'

type Props = {
  bookingId: string
  status: any
  scheduledFor: string // ISO UTC
  durationMinutesSnapshot?: number | null
  appointmentTz?: string | null // ✅ booking.timeZone (DTO) or server-derived
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function toDateIsoUtc(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatWhen(d: Date, timeZone: string) {
  return formatAppointmentWhen(d, timeZone)
}

/**
 * ISO (UTC) -> datetime-local string shown in the given timeZone,
 * without relying on browser implicit conversions.
 */
function toDatetimeLocalValueInTimeZone(isoUtc: string, timeZone: string) {
  const d = toDateIsoUtc(isoUtc)
  if (!d) return ''
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const p = getZonedParts(d, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * datetime-local value -> UTC Date, interpreting the wall clock in timeZone.
 */
function fromDatetimeLocalValueInTimeZone(v: string, timeZone: string): Date | null {
  if (!v || typeof v !== 'string') return null
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
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
  return Number.isNaN(utc.getTime()) ? null : utc
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 409) return data?.error || 'That time is no longer available.'
  return `Request failed (${res.status}).`
}

function pillClass(on: boolean) {
  return on
    ? 'bg-accentPrimary text-bgPrimary border border-white/10'
    : 'bg-bgPrimary text-textSecondary border border-white/10'
}

export default function BookingActions({
  bookingId,
  status,
  scheduledFor,
  durationMinutesSnapshot,
  appointmentTz,
}: Props) {
  const router = useRouter()

  const statusUpper = upper(status)
  const isPending = statusUpper === 'PENDING'
  const isAccepted = statusUpper === 'ACCEPTED'
  const isCancelled = statusUpper === 'CANCELLED'
  const isCompleted = statusUpper === 'COMPLETED'

  const canCancel = !isCancelled && !isCompleted
  const canReschedule = (isPending || isAccepted) && !isCancelled && !isCompleted

  const tz = useMemo(() => sanitizeTimeZone(appointmentTz || 'UTC', 'UTC'), [appointmentTz])

  const scheduledDate = useMemo(() => toDateIsoUtc(scheduledFor), [scheduledFor])

  const whenLabel = useMemo(() => {
    const d = scheduledDate
    if (!d) return 'Unknown time'
    return formatWhen(d, tz)
  }, [scheduledDate, tz])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [mode, setMode] = useState<'none' | 'reschedule'>('none')

  const [localValue, setLocalValue] = useState<string>(() => toDatetimeLocalValueInTimeZone(scheduledFor, tz))

  useEffect(() => {
    setLocalValue(toDatetimeLocalValueInTimeZone(scheduledFor, tz))
  }, [scheduledFor, tz])

  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  function resetAlerts() {
    setError(null)
    setSuccess(null)
  }

  async function post(url: string, body?: any) {
    resetAlerts()
    setBusy(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFromResponse(res, data))

      setSuccess('Saved.')
      setMode('none')
      router.refresh()
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function cancelBooking() {
    if (!canCancel || busy) return
    resetAlerts()
    if (!window.confirm('Cancel this booking?')) return
    await post(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`)
  }

  async function rescheduleBooking() {
    if (!canReschedule || busy) return
    resetAlerts()

    const nextUtc = fromDatetimeLocalValueInTimeZone(localValue, tz)
    if (!nextUtc) return setError('Pick a valid date/time.')
    if (nextUtc.getTime() < Date.now()) return setError('Pick a future time.')

    if (scheduledDate) {
      const sameMinute = Math.floor(nextUtc.getTime() / 60000) === Math.floor(scheduledDate.getTime() / 60000)
      if (sameMinute) return setError('Choose a different time than the current one.')
    }

    const ok = window.confirm(`Reschedule to:\n\n${formatWhen(nextUtc, tz)}\n\nProceed?`)
    if (!ok) return

    // ✅ API expects UTC ISO
    await post(`/api/bookings/${encodeURIComponent(bookingId)}/reschedule`, {
      scheduledFor: nextUtc.toISOString(),
    })
  }

  const timeline = useMemo(() => {
    const base = [
      { key: 'requested', label: 'Requested', on: isPending || isAccepted || isCompleted || isCancelled },
      { key: 'confirmed', label: 'Confirmed', on: isAccepted || isCompleted },
      { key: 'completed', label: 'Completed', on: isCompleted },
    ] as const

    if (isCancelled) {
      return [
        { key: 'requested', label: 'Requested', on: true },
        { key: 'cancelled', label: 'Cancelled', on: true },
      ] as const
    }

    return base
  }, [isPending, isAccepted, isCompleted, isCancelled])

  return (
    <section className="mt-4 grid gap-3 rounded-card border border-white/10 bg-bgSecondary p-3 text-textPrimary">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-black">Booking status</div>
        <div className="text-xs font-semibold text-textSecondary">
          {whenLabel} · {tz}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {timeline.map((t) => (
          <span
            key={t.key}
            className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-black', pillClass(t.on)].join(' ')}
          >
            {t.label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canCancel ? (
          <button
            type="button"
            onClick={cancelBooking}
            disabled={busy}
            className={[
              'rounded-full px-4 py-2 text-sm font-black transition',
              busy
                ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary'
                : 'border border-white/10 bg-bgPrimary text-microAccent hover:bg-surfaceGlass',
            ].join(' ')}
          >
            {busy ? 'Working…' : 'Cancel booking'}
          </button>
        ) : null}

        {canReschedule ? (
          <button
            type="button"
            onClick={() => {
              resetAlerts()
              setMode((m) => (m === 'reschedule' ? 'none' : 'reschedule'))
            }}
            disabled={busy}
            className={[
              'rounded-full px-4 py-2 text-sm font-black transition',
              busy
                ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary'
                : 'border border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
            ].join(' ')}
          >
            Reschedule
          </button>
        ) : null}

        <div className="ml-auto text-xs font-semibold text-textSecondary">
          {durationMinutesSnapshot ? `${durationMinutesSnapshot} min` : null}
        </div>
      </div>

      {mode === 'reschedule' && canReschedule ? (
        <div className="grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-3">
          <div className="text-xs font-black">
            Pick a new time <span className="font-semibold text-textSecondary">({tz})</span>
          </div>

          <input
            type="datetime-local"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            disabled={busy}
            className="w-full rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none"
          />

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode('none')}
              disabled={busy}
              className={[
                'rounded-full px-4 py-2 text-sm font-black transition',
                busy
                  ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                  : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
              ].join(' ')}
            >
              Close
            </button>

            <button
              type="button"
              onClick={rescheduleBooking}
              disabled={busy}
              className={[
                'rounded-full px-4 py-2 text-sm font-black transition',
                busy
                  ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                  : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
              ].join(' ')}
            >
              {busy ? 'Saving…' : 'Save new time'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="text-xs font-semibold text-microAccent">{error}</div> : null}
      {success ? <div className="text-xs font-semibold text-textSecondary">{success}</div> : null}
    </section>
  )
}
