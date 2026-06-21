// app/client/bookings/[id]/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookingStatus, SessionStep } from '@prisma/client'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { safeJson } from '@/lib/http'
import {
  buildLifecycleActionViewModel,
  type LifecycleAction,
} from '@/lib/booking/lifecycleActionViewModel'

type BookingLocationType = 'SALON' | 'MOBILE' | null

type Props = {
  bookingId: string
  status: unknown
  sessionStep?: string | null
  scheduledFor: string // ISO UTC
  durationMinutesSnapshot?: number | null
  appointmentTz?: string | null
  rescheduleHoldId?: string | null
  locationType?: BookingLocationType
  hasAftercareLink?: boolean
  onRequestReschedule?: () => void
  onConfirmReschedule?: () => Promise<void> | void
}

function toBookingStatus(v: unknown): BookingStatus | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return (Object.values(BookingStatus) as string[]).includes(s)
    ? (s as BookingStatus)
    : null
}

function toSessionStep(v: unknown): SessionStep | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return (Object.values(SessionStep) as string[]).includes(s)
    ? (s as SessionStep)
    : null
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
  sessionStep,
  scheduledFor,
  durationMinutesSnapshot,
  appointmentTz,
  rescheduleHoldId,
  locationType,
  hasAftercareLink,
  onRequestReschedule,
  onConfirmReschedule,
}: Props) {
  const router = useRouter()

  const tz = useMemo(
    () => sanitizeTimeZone(appointmentTz, DEFAULT_TIME_ZONE),
    [appointmentTz],
  )

  const scheduledDate = useMemo(() => toDateIsoUtc(scheduledFor), [scheduledFor])

  const whenLabel = useMemo(() => {
    if (!scheduledDate) return 'Unknown time'
    return formatAppointmentWhen(scheduledDate, tz)
  }, [scheduledDate, tz])

  const normalizedStatus = useMemo(() => toBookingStatus(status), [status])
  const normalizedStep = useMemo(() => toSessionStep(sessionStep), [sessionStep])

  const viewModel = useMemo(() => {
    if (!normalizedStatus) return null
    return buildLifecycleActionViewModel({
      bookingId,
      status: normalizedStatus,
      sessionStep: normalizedStep,
      role: 'CLIENT',
      rescheduleHoldId: rescheduleHoldId ?? null,
      hasAftercareLink: Boolean(hasAftercareLink),
    })
  }, [
    bookingId,
    normalizedStatus,
    normalizedStep,
    rescheduleHoldId,
    hasAftercareLink,
  ])

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

  async function postAction(action: LifecycleAction) {
    if (!action.href) {
      setError('Action is missing a destination.')
      return
    }

    if (action.confirmCopy && typeof window !== 'undefined' && !window.confirm(action.confirmCopy)) return

    resetAlerts()
    setBusy(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(action.href, {
        method: action.method === 'POST' ? 'POST' : 'PATCH',
        headers: action.payload
          ? { 'Content-Type': 'application/json' }
          : undefined,
        body: action.payload ? JSON.stringify(action.payload) : undefined,
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

  async function confirmReschedule() {
    if (busy) return
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

    if (typeof window === 'undefined') return
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

  function handleAction(action: LifecycleAction) {
    if (action.verb === 'CLIENT_RESCHEDULE') {
      resetAlerts()
      setMode((m) => (m === 'reschedule' ? 'none' : 'reschedule'))
      return
    }

    if (action.method === 'NAVIGATE' && action.href) {
      router.push(action.href)
      return
    }

    if (action.method === 'POST' || action.method === 'PATCH') {
      void postAction(action)
      return
    }
  }

  if (!viewModel) {
    return (
      <section className="mt-4 grid gap-3 rounded-card border border-white/10 bg-bgSecondary p-3 text-textPrimary">
        <div className="text-sm font-black">
          Booking status unavailable
        </div>
      </section>
    )
  }

  return (
    <section className="mt-4 grid gap-3 rounded-card border border-white/10 bg-bgSecondary p-3 text-textPrimary">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-black">{viewModel.displayLabel}</div>
        <div className="text-xs font-semibold text-textSecondary">
          {whenLabel} · {tz}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {viewModel.timelinePills.map((t) => (
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
        {viewModel.actions.map((action) => {
          const isDestructive = action.verb === 'CLIENT_CANCEL'
          const className = [
            'rounded-full px-4 py-2 text-sm font-black transition',
            busy
              ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary'
              : action.primary
                ? 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
                : isDestructive
                  ? 'border border-white/10 bg-bgPrimary text-microAccent hover:bg-surfaceGlass'
                  : 'border border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
          ].join(' ')

          return (
            <button
              key={action.verb}
              type="button"
              onClick={() => handleAction(action)}
              disabled={busy}
              className={className}
            >
              {busy && action.verb === 'CLIENT_CANCEL'
                ? 'Working…'
                : action.label}
            </button>
          )
        })}

        <div className="ml-auto text-xs font-semibold text-textSecondary">
          {durationMinutesSnapshot ? `${durationMinutesSnapshot} min` : null}
        </div>
      </div>

      {mode === 'reschedule' ? (
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
