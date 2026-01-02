// app/client/bookings/[id]/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

console.log('CLIENT BookingActions mounted')

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | string

type Props = {
  bookingId: string
  status: BookingStatus | null
  scheduledFor: string // ISO string
  durationMinutesSnapshot?: number | null
}

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function prettyWhenISO(iso: string) {
  const d = toDate(iso)
  if (!d) return 'Unknown time'
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// for <input type="datetime-local" />
function toLocalInputValue(iso: string) {
  const d = toDate(iso)
  if (!d) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

function fromLocalInputValue(v: string) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.toUpperCase() : ''
}

function tzLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'
  } catch {
    return 'Local time'
  }
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 409) return 'That time is no longer available.'
  return `Request failed (${res.status}).`
}

export default function BookingActions({ bookingId, status, scheduledFor, durationMinutesSnapshot }: Props) {
  const router = useRouter()

  const statusUpper = upper(status)
  const isPending = statusUpper === 'PENDING'
  const isAccepted = statusUpper === 'ACCEPTED'
  const isCancelled = statusUpper === 'CANCELLED'
  const isCompleted = statusUpper === 'COMPLETED'

  const canCancel = !isCancelled && !isCompleted
  const canReschedule = (isPending || isAccepted) && !isCancelled && !isCompleted

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [mode, setMode] = useState<'none' | 'reschedule'>('none')
  const [localValue, setLocalValue] = useState<string>(() => toLocalInputValue(scheduledFor))

  const scheduledDate = useMemo(() => toDate(scheduledFor), [scheduledFor])
  const whenLabel = useMemo(() => prettyWhenISO(scheduledFor), [scheduledFor])

  // When the server updates scheduledFor and the page refreshes, keep the input in sync.
  useEffect(() => {
    setLocalValue(toLocalInputValue(scheduledFor))
  }, [scheduledFor])

  // Abort support so quick clicks don’t apply stale results.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  function resetAlerts() {
    setError(null)
    setSuccess(null)
  }

  async function doPatch(body: any) {
    resetAlerts()
    setBusy(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`/api/client/bookings/${encodeURIComponent(bookingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

    const ok = window.confirm('Cancel this booking?')
    if (!ok) return

    await doPatch({ action: 'cancel' })
  }

  async function rescheduleBooking() {
    if (!canReschedule || busy) return
    resetAlerts()

    const next = fromLocalInputValue(localValue)
    if (!next) {
      setError('Pick a valid date/time.')
      return
    }

    const now = Date.now()
    if (next.getTime() < now) {
      setError('Pick a future time.')
      return
    }

    // Don’t let users “reschedule” to the same minute. It’s not cute.
    if (scheduledDate) {
      const sameMinute = Math.floor(next.getTime() / 60000) === Math.floor(scheduledDate.getTime() / 60000)
      if (sameMinute) {
        setError('Choose a different time than the current one.')
        return
      }
    }

    const ok = window.confirm(
      `Reschedule to:\n\n${next.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}\n\nProceed?`,
    )
    if (!ok) return

    await doPatch({ action: 'reschedule', scheduledFor: next.toISOString() })
  }

  // Tiny timeline: Requested → Confirmed → Completed (or Cancelled)
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

  const tz = useMemo(() => tzLabel(), [])

  return (
    <section
      style={{
        borderRadius: 12,
        border: '1px solid #eee',
        background: '#fff',
        padding: 12,
        marginTop: 16,
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Booking status</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {whenLabel} · {tz}
        </div>
      </div>

      {/* Timeline */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {timeline.map((t) => (
          <span
            key={t.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              border: '1px solid #e5e7eb',
              background: t.on ? '#111' : '#fff',
              color: t.on ? '#fff' : '#6b7280',
            }}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {canCancel ? (
          <button
            type="button"
            onClick={cancelBooking}
            disabled={busy}
            style={{
              border: '1px solid #fecaca',
              background: '#fff',
              color: '#991b1b',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 900,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
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
            style={{
              border: '1px solid #ddd',
              background: '#fff',
              color: '#111',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 900,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            Reschedule
          </button>
        ) : null}

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
          {durationMinutesSnapshot ? `${durationMinutesSnapshot} min` : null}
        </div>
      </div>

      {/* Reschedule panel */}
      {mode === 'reschedule' && canReschedule ? (
        <div
          style={{
            borderRadius: 10,
            border: '1px solid #f3f4f6',
            background: '#fafafa',
            padding: 10,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700 }}>
            Pick a new time <span style={{ color: '#6b7280', fontWeight: 600 }}>({tz})</span>
          </div>

          <input
            type="datetime-local"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            disabled={busy}
            style={{
              width: '100%',
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              padding: 10,
              fontSize: 13,
              background: '#fff',
              opacity: busy ? 0.7 : 1,
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setMode('none')}
              disabled={busy}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '10px 14px',
                background: '#e5e7eb',
                color: '#111',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 13,
                fontWeight: 900,
                opacity: busy ? 0.7 : 1,
              }}
            >
              Close
            </button>

            <button
              type="button"
              onClick={rescheduleBooking}
              disabled={busy}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '10px 14px',
                background: '#111',
                color: '#fff',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 13,
                fontWeight: 900,
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Save new time'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div> : null}
      {success ? <div style={{ color: '#166534', fontSize: 12 }}>{success}</div> : null}
    </section>
  )
}
