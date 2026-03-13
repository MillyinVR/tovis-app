// app/client/bookings/[id]/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { safeJson } from '@/lib/http'

type BookingLocationType = 'SALON' | 'MOBILE' | null

type Props = {
  bookingId: string
  status: unknown
  scheduledFor: string // ISO UTC
  durationMinutesSnapshot?: number | null
  appointmentTz?: string | null
  rescheduleHoldId?: string | null
  locationType?: BookingLocationType
  onRequestReschedule?: () => void
  onConfirmReschedule?: () => Promise<void> | void
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function toDateIsoUtc(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function errorFromResponse(res: Response, data: unknown) {
  const rec =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : null

  if (typeof rec?.error === 'string') return rec.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You do not have access to do that.'
  if (res.status === 409) {
    return typeof rec?.error === 'string'
      ? rec.error
      : 'That request could not be completed.'
  }
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
  rescheduleHoldId,
  locationType,
  onRequestReschedule,
  onConfirmReschedule,
}: Props) {
  const router = useRouter()

  const statusUpper = upper(status)
  const isPending = statusUpper === 'PENDING'
  const isAccepted = statusUpper === 'ACCEPTED'
  const isCancelled = statusUpper === 'CANCELLED'
  const isCompleted = statusUpper === 'COMPLETED'

  const canCancel = !isCancelled && !isCompleted
  const canReschedule =
    (isPending || isAccepted) && !isCancelled && !isCompleted

  const tz = useMemo(
    () => sanitizeTimeZone(appointmentTz, DEFAULT_TIME_ZONE),
    [appointmentTz],
  )

  const scheduledDate = useMemo(() => toDateIsoUtc(scheduledFor), [scheduledFor])

  const whenLabel = useMemo(() => {
    if (!scheduledDate) return 'Unknown time'
    return formatAppointmentWhen(scheduledDate, tz)
  }, [scheduledDate, tz])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [mode, setMode] = useState<'none' | 'reschedule'>('none')

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  function resetAlerts() {
    setError(null)
    setSuccess(null)
  }

  async function post(url: string, body?: Record<string, unknown>) {
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
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string } | null
      if (err?.name === 'AbortError') return
      setError(err?.message || 'Something went wrong.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setBusy(false)
    }
  }

  async function cancelBooking() {
    if (!canCancel || busy) return
    resetAlerts()

    if (!window.confirm('Cancel this booking?')) return

    await post(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`)
  }

  async function confirmReschedule() {
    if (!canReschedule || busy) return
    resetAlerts()

    if (!rescheduleHoldId) {
      setError('Choose a new available time before rescheduling this booking.')
      return
    }

    if (!locationType) {
      setError('Missing booking location type for reschedule.')
      return
    }

    if (!onConfirmReschedule) {
      setError('Reschedule flow is not connected yet.')
      return
    }

    const ok = window.confirm('Use the selected new time for this booking?')
    if (!ok) return

    try {
      setBusy(true)
      await onConfirmReschedule()
      setSuccess('Saved.')
      setMode('none')
    } catch (e: unknown) {
      const err = e as { message?: string } | null
      setError(err?.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const timeline = useMemo(() => {
    const base = [
      {
        key: 'requested',
        label: 'Requested',
        on: isPending || isAccepted || isCompleted || isCancelled,
      },
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
            className={[
              'inline-flex items-center rounded-full px-3 py-1 text-xs font-black',
              pillClass(t.on),
            ].join(' ')}
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
            Choose a new time slot before confirming
          </div>

          <div className="text-xs font-semibold text-textSecondary">
            This flow now uses a held slot. It does not directly submit a raw date/time anymore.
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {onRequestReschedule ? (
              <button
                type="button"
                onClick={onRequestReschedule}
                disabled={busy}
                className={[
                  'rounded-full px-4 py-2 text-sm font-black transition',
                  busy
                    ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                    : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
                ].join(' ')}
              >
                Pick new time
              </button>
            ) : null}

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
              onClick={confirmReschedule}
              disabled={busy || !rescheduleHoldId || !locationType}
              className={[
                'rounded-full px-4 py-2 text-sm font-black transition',
                busy || !rescheduleHoldId || !locationType
                  ? 'cursor-not-allowed border border-white/10 bg-bgSecondary text-textSecondary'
                  : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
              ].join(' ')}
            >
              {busy ? 'Saving…' : 'Confirm new time'}
            </button>
          </div>

          {!rescheduleHoldId ? (
            <div className="text-xs font-semibold text-textSecondary">
              No held replacement slot selected yet.
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="text-xs font-semibold text-microAccent">{error}</div>
      ) : null}
      {success ? (
        <div className="text-xs font-semibold text-textSecondary">{success}</div>
      ) : null}
    </section>
  )
}