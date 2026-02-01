// app/pro/bookings/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { pickTimeZoneOrNull } from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
type LoadingAction = 'ACCEPT' | 'CANCEL' | 'START' | 'FINISH'

type Props = {
  bookingId: string
  currentStatus: BookingStatus | string
  startedAt?: string | null
  finishedAt?: string | null

  /**
   * Appointment timezone (preferred: booking.locationTimeZone).
   * UI policy: do NOT invent a timezone if missing — hide timestamps instead.
   */
  timeZone?: string | null
}

function isBookingStatus(v: unknown): v is BookingStatus {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return s === 'PENDING' || s === 'ACCEPTED' || s === 'COMPLETED' || s === 'CANCELLED'
}

function normalizeBookingStatus(v: unknown): BookingStatus {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (isBookingStatus(s)) return s
  throw new Error(`Invalid booking status: ${String(v)}`)
}

function parseIso(iso?: string | null): Date | null {
  if (!iso || typeof iso !== 'string') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * UI formatting:
 * - If tz is missing/invalid, return null (don’t lie)
 * - If date invalid, return null
 */
function formatWhen(iso: string | null | undefined, timeZone?: string | null) {
  const d = parseIso(iso)
  if (!d) return null

  const tz = pickTimeZoneOrNull(timeZone)
  if (!tz) return null

  return formatAppointmentWhen(d, tz)
}

async function safeJson(res: Response) {
  if (res.status === 204) return {} as any
  return res.json().catch(async () => {
    const raw = await res.text().catch(() => '')
    return raw ? { raw } : {}
  })
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (typeof data?.message === 'string') return data.message
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 404) return 'Not found.'
  if (res.status === 409) return 'That action isn’t allowed right now.'
  return `Request failed (${res.status}).`
}

function extractNextHref(data: any): string | null {
  const maybe = data?.nextHref ?? data?.booking?.nextHref ?? data?.data?.nextHref
  return typeof maybe === 'string' && maybe.startsWith('/') && !maybe.startsWith('//') ? maybe : null
}

/**
 * Enforce canonical backend response.
 * We accept:
 *  - data.status
 *  - data.booking.status
 *  - data.data.status
 * Anything else is a hard error.
 */
function extractStatusStrict(data: any): BookingStatus {
  const candidate =
    (typeof data?.status === 'string' && data.status) ||
    (typeof data?.booking?.status === 'string' && data.booking.status) ||
    (typeof data?.data?.status === 'string' && data.data.status)

  return normalizeBookingStatus(candidate)
}

function extractIso(data: any, key: 'startedAt' | 'finishedAt') {
  const maybe = data?.[key] ?? data?.booking?.[key] ?? data?.data?.[key]
  return typeof maybe === 'string' && parseIso(maybe) ? maybe : null
}

export default function BookingActions({ bookingId, currentStatus, startedAt, finishedAt, timeZone }: Props) {
  const router = useRouter()

  const [status, setStatus] = useState<BookingStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [localStartedAt, setLocalStartedAt] = useState<string | null>(startedAt ?? null)
  const [localFinishedAt, setLocalFinishedAt] = useState<string | null>(finishedAt ?? null)

  const [loading, setLoading] = useState<LoadingAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    try {
      setStatus(normalizeBookingStatus(currentStatus))
      setStatusError(null)
    } catch (e: any) {
      setStatus(null)
      setStatusError(e?.message || 'Invalid booking status.')
    }
  }, [currentStatus])

  useEffect(() => setLocalStartedAt(startedAt ?? null), [startedAt])
  useEffect(() => setLocalFinishedAt(finishedAt ?? null), [finishedAt])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const started = useMemo(() => Boolean(parseIso(localStartedAt)), [localStartedAt])
  const finished = useMemo(() => Boolean(parseIso(localFinishedAt)), [localFinishedAt])

  const startedLabel = formatWhen(localStartedAt, timeZone)
  const finishedLabel = formatWhen(localFinishedAt, timeZone)

  const isTerminal = status === 'COMPLETED' || status === 'CANCELLED' || finished

  const canAccept = status === 'PENDING'
  const canCancel = status === 'PENDING' || status === 'ACCEPTED'
  const canStart = status === 'ACCEPTED' && !started && !finished
  const canFinish = status === 'ACCEPTED' && started && !finished

  async function run(action: LoadingAction) {
    const id = String(bookingId || '').trim()
    if (!id) {
      setError('Missing booking id.')
      return
    }
    if (!status) {
      setError('Booking has an invalid status. Refresh or contact support.')
      return
    }
    if (loading) return

    if (action === 'CANCEL') {
      const ok = window.confirm('Cancel this booking? This will notify the client.')
      if (!ok) return
    }

    setError(null)
    setLoading(action)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      let res: Response

      if (action === 'ACCEPT') {
        res = await fetch(`/api/pro/bookings/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACCEPTED' }),
          signal: controller.signal,
        })
      } else if (action === 'CANCEL') {
        res = await fetch(`/api/pro/bookings/${encodeURIComponent(id)}/cancel`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Cancelled by professional', promoteWaitlist: true }),
          signal: controller.signal,
        })
      } else if (action === 'START') {
        res = await fetch(`/api/pro/bookings/${encodeURIComponent(id)}/start`, {
          method: 'POST',
          signal: controller.signal,
        })
      } else {
        res = await fetch(`/api/pro/bookings/${encodeURIComponent(id)}/finish`, {
          method: 'POST',
          signal: controller.signal,
        })
      }

      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      // 🔒 Canonical response enforcement
      const nextStatus = extractStatusStrict(data)
      setStatus(nextStatus)

      if (action === 'START') {
        const iso = extractIso(data, 'startedAt')
        setLocalStartedAt(iso ?? new Date().toISOString())
      }

      if (action === 'FINISH') {
        const iso = extractIso(data, 'finishedAt')
        if (iso) setLocalFinishedAt(iso)

        const nextHref = extractNextHref(data)
        if (nextHref) {
          router.push(nextHref)
          return
        }
      }

      router.refresh()
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError(err?.message || 'Network error while updating booking.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(null)
      }
    }
  }

  const btnBase =
    'inline-flex items-center justify-center rounded-full px-3 py-2 text-[12px] font-black transition ' +
    'disabled:cursor-not-allowed disabled:opacity-60 border border-white/10'

  const btnPrimary = `${btnBase} bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover`
  const btnGhost = `${btnBase} bg-bgPrimary text-textPrimary hover:border-white/20`

  if (statusError) {
    return (
      <div className="grid gap-1">
        <div className="text-[12px] text-textSecondary">
          Status: <span className="font-black text-microAccent">Invalid</span>
        </div>
        <div className="text-[11px] font-black text-microAccent">{statusError}</div>
      </div>
    )
  }

  if (!status) {
    return <div className="text-[12px] text-textSecondary">Status: —</div>
  }

  if (isTerminal) {
    return (
      <div className="text-[12px] text-textSecondary">
        Status: <span className="font-black text-textPrimary">{status}</span>
        {finishedLabel ? <span className="ml-2 text-textSecondary">• {finishedLabel}</span> : null}
      </div>
    )
  }

  return (
    <div className="grid gap-2 justify-items-start md:justify-items-end">
      <div className="text-[12px] text-textSecondary">
        Status: <span className="font-black text-textPrimary">{status}</span>
        {started ? (
          <span className="ml-2 text-textSecondary">• Started{startedLabel ? ` ${startedLabel}` : ''}</span>
        ) : null}
      </div>

      {error ? (
        <div aria-live="polite" className="max-w-65 text-right text-[11px] font-black text-microAccent">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
        {canAccept ? (
          <button type="button" onClick={() => run('ACCEPT')} disabled={loading !== null} className={btnPrimary}>
            {loading === 'ACCEPT' ? 'Accepting…' : 'Accept'}
          </button>
        ) : null}

        {canCancel ? (
          <button type="button" onClick={() => run('CANCEL')} disabled={loading !== null} className={btnGhost}>
            {loading === 'CANCEL' ? 'Cancelling…' : 'Cancel'}
          </button>
        ) : null}

        {canStart ? (
          <button type="button" onClick={() => run('START')} disabled={loading !== null} className={btnGhost}>
            {loading === 'START' ? 'Starting…' : 'Start'}
          </button>
        ) : null}

        {canFinish ? (
          <button type="button" onClick={() => run('FINISH')} disabled={loading !== null} className={btnPrimary}>
            {loading === 'FINISH' ? 'Finishing…' : 'Finish'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
