// app/pro/bookings/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
type SafeStatus = BookingStatus | 'UNKNOWN'

type Props = {
  bookingId: string
  currentStatus: BookingStatus | string
  startedAt?: string | null
  finishedAt?: string | null
}

type LoadingAction = 'ACCEPT' | 'CANCEL' | 'START' | 'FINISH'

function normalizeStatus(s: unknown): SafeStatus {
  const v = String(s || '').toUpperCase().trim()
  if (v === 'PENDING' || v === 'ACCEPTED' || v === 'COMPLETED' || v === 'CANCELLED') return v
  return 'UNKNOWN'
}

function hasValidDate(iso?: string | null) {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime())
}

async function safeRead(res: Response): Promise<any> {
  if (res.status === 204) return {}
  const text = await res.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function extractError(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (typeof data?.message === 'string') return data.message

  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 404) return 'Not found (404).'
  if (res.status === 409) return 'That action isn’t allowed right now.'
  return `Request failed (${res.status}).`
}

function extractStatus(data: any, fallback: SafeStatus): SafeStatus {
  const candidate =
    (typeof data?.status === 'string' && data.status) ||
    (typeof data?.booking?.status === 'string' && data.booking.status) ||
    (typeof data?.data?.status === 'string' && data.data.status) ||
    fallback

  return normalizeStatus(candidate)
}

function extractIso(data: any, key: 'startedAt' | 'finishedAt') {
  const maybe = data?.[key] ?? data?.booking?.[key] ?? data?.data?.[key]
  return typeof maybe === 'string' && hasValidDate(maybe) ? maybe : null
}

function extractNextHref(data: any): string | null {
  const maybe = data?.nextHref ?? data?.booking?.nextHref ?? data?.data?.nextHref
  return typeof maybe === 'string' && maybe.startsWith('/') ? maybe : null
}

export default function BookingActions({ bookingId, currentStatus, startedAt, finishedAt }: Props) {
  const router = useRouter()

  const [status, setStatus] = useState<SafeStatus>(normalizeStatus(currentStatus))
  const [localStartedAt, setLocalStartedAt] = useState<string | null>(startedAt ?? null)
  const [localFinishedAt, setLocalFinishedAt] = useState<string | null>(finishedAt ?? null)

  const [loading, setLoading] = useState<LoadingAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => setStatus(normalizeStatus(currentStatus)), [currentStatus])
  useEffect(() => setLocalStartedAt(startedAt ?? null), [startedAt])
  useEffect(() => setLocalFinishedAt(finishedAt ?? null), [finishedAt])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const started = useMemo(() => hasValidDate(localStartedAt), [localStartedAt])
  const finished = useMemo(() => hasValidDate(localFinishedAt), [localFinishedAt])

  const isPending = status === 'PENDING'
  const isAccepted = status === 'ACCEPTED'
  const isTerminal = status === 'COMPLETED' || status === 'CANCELLED' || status === 'UNKNOWN' || finished

  const canAccept = isPending
  const canCancel = status === 'PENDING' || status === 'ACCEPTED'
  const canStart = isAccepted && !started && !finished
  const canFinish = isAccepted && started && !finished

  async function run(action: LoadingAction) {
    const id = String(bookingId || '').trim()
    if (!id) {
      setError('Missing booking id.')
      return
    }
    if (loading) return

    // ✅ Cancel confirm (recommendation applied)
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

      const data = await safeRead(res)

      if (!res.ok) {
        setError(extractError(res, data))
        return
      }

      const nextStatus =
        action === 'ACCEPT'
          ? extractStatus(data, 'ACCEPTED')
          : action === 'CANCEL'
            ? extractStatus(data, 'CANCELLED')
            : extractStatus(data, status)

      setStatus(nextStatus)
      router.refresh()

      if (action === 'START') {
        const iso = extractIso(data, 'startedAt')
        setLocalStartedAt(iso ?? new Date().toISOString())
      }

      if (action === 'FINISH') {
        const nextHref = extractNextHref(data)
        if (nextHref) {
          router.push(nextHref)
          return
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error while updating booking.')
    } finally {
      if (abortRef.current === controller) setLoading(null)
    }
  }

  const btnBase =
    'rounded-full border px-3 py-2 text-[12px] font-black transition disabled:cursor-not-allowed disabled:opacity-60'

  if (isTerminal) {
    const label = status === 'UNKNOWN' ? String(currentStatus) : status
    return <div className="text-[12px] text-textSecondary">Status: {label}</div>
  }

  return (
    <div className="grid gap-2 justify-items-start md:justify-items-end">
      <div className="text-[12px] text-textSecondary">
        Status: <span className="font-black text-textPrimary">{status}</span>
        {started ? <span className="ml-2 text-textSecondary">• Started</span> : null}
      </div>

      {error ? (
        <div aria-live="polite" className="max-w-65 text-right text-[11px] font-black text-toneDanger">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
        {canAccept ? (
          <button
            type="button"
            onClick={() => run('ACCEPT')}
            disabled={loading !== null}
            className={[btnBase, 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'].join(
              ' ',
            )}
          >
            {loading === 'ACCEPT' ? 'Accepting…' : 'Accept'}
          </button>
        ) : null}

        {canCancel ? (
          <button
            type="button"
            onClick={() => run('CANCEL')}
            disabled={loading !== null}
            className={[btnBase, 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20'].join(' ')}
          >
            {loading === 'CANCEL' ? 'Cancelling…' : 'Cancel'}
          </button>
        ) : null}

        {canStart ? (
          <button
            type="button"
            onClick={() => run('START')}
            disabled={loading !== null}
            className={[btnBase, 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20'].join(' ')}
          >
            {loading === 'START' ? 'Starting…' : 'Start'}
          </button>
        ) : null}

        {canFinish ? (
          <button
            type="button"
            onClick={() => run('FINISH')}
            disabled={loading !== null}
            className={[
              btnBase,
              'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
            ].join(' ')}
          >
            {loading === 'FINISH' ? 'Finishing…' : 'Finish'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
