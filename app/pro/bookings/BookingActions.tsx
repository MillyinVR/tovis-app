// app/pro/bookings/BookingActions.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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

export default function BookingActions({ bookingId, currentStatus, startedAt, finishedAt }: Props) {
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

  // ⚠️ "Finish" is only allowed once started and not already finished.
  // But finishing does NOT necessarily mean COMPLETED anymore (aftercare submit completes).
  const canFinish = isAccepted && started && !finished

  async function run(action: LoadingAction) {
    if (!bookingId?.trim()) {
      setError('Missing booking id.')
      return
    }
    if (loading) return

    setError(null)
    setLoading(action)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      let res: Response

      if (action === 'ACCEPT') {
        // ✅ Correct accept route
        res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACCEPTED' }),
          signal: controller.signal,
        })
      } else if (action === 'CANCEL') {
        res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, {
          method: 'POST',
          signal: controller.signal,
        })
      } else if (action === 'START') {
        res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/start`, {
          method: 'POST',
          signal: controller.signal,
        })
      } else {
        res = await fetch(`/api/pro/bookings/${encodeURIComponent(bookingId)}/finish`, {
          method: 'POST',
          signal: controller.signal,
        })
      }

      const data = await safeRead(res)

      if (!res.ok) {
        setError(extractError(res, data))
        return
      }

      // ✅ Update status conservatively, based on what the API returns.
      // - ACCEPT should become ACCEPTED.
      // - CANCEL should become CANCELLED.
      // - START usually returns startedAt + status.
      // - FINISH (new flow) does NOT necessarily return COMPLETED anymore.
      const nextStatus =
        action === 'ACCEPT'
          ? extractStatus(data, 'ACCEPTED')
          : action === 'CANCEL'
            ? extractStatus(data, 'CANCELLED')
            : extractStatus(data, status)

      setStatus(nextStatus)

      // timestamps (best-effort)
      if (action === 'START') {
        const iso = extractIso(data, 'startedAt')
        setLocalStartedAt(iso ?? new Date().toISOString())
      }

      // IMPORTANT:
      // We do NOT set finishedAt here unless the API actually returns it.
      // Completion should happen when aftercare is submitted.
      if (action === 'FINISH') {
        const iso = extractIso(data, 'finishedAt')
        if (iso) setLocalFinishedAt(iso)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error while updating booking.')
    } finally {
      if (abortRef.current === controller) setLoading(null)
    }
  }

  const buttonBase: React.CSSProperties = {
    padding: '4px 8px',
    borderRadius: 999,
    fontSize: 12,
    cursor: 'pointer',
  }

  if (isTerminal) {
    const label = status === 'UNKNOWN' ? String(currentStatus) : status
    return <div style={{ fontSize: 12, color: '#777' }}>Status: {label}</div>
  }

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'flex-end' }}>
      <div style={{ fontSize: 12, color: '#777' }}>
        Status: {status}
        {started ? <span style={{ marginLeft: 6 }}>• Started</span> : null}
      </div>

      {error && (
        <div aria-live="polite" style={{ fontSize: 11, color: 'red', maxWidth: 240, textAlign: 'right' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {canAccept && (
          <button
            type="button"
            onClick={() => run('ACCEPT')}
            disabled={loading !== null}
            style={{
              ...buttonBase,
              border: '1px solid #111',
              background: loading === 'ACCEPT' ? '#111' : '#fff',
              color: loading === 'ACCEPT' ? '#fff' : '#111',
              opacity: loading && loading !== 'ACCEPT' ? 0.6 : 1,
            }}
          >
            {loading === 'ACCEPT' ? 'Accepting…' : 'Accept'}
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={() => run('CANCEL')}
            disabled={loading !== null}
            style={{
              ...buttonBase,
              border: '1px solid #ddd',
              background: loading === 'CANCEL' ? '#eee' : '#fafafa',
              color: '#444',
              opacity: loading && loading !== 'CANCEL' ? 0.6 : 1,
            }}
          >
            {loading === 'CANCEL' ? 'Cancelling…' : 'Cancel'}
          </button>
        )}

        {canStart && (
          <button
            type="button"
            onClick={() => run('START')}
            disabled={loading !== null}
            style={{
              ...buttonBase,
              border: '1px solid #111',
              background: loading === 'START' ? '#111' : '#fff',
              color: loading === 'START' ? '#fff' : '#111',
              opacity: loading && loading !== 'START' ? 0.6 : 1,
            }}
          >
            {loading === 'START' ? 'Starting…' : 'Start'}
          </button>
        )}

        {canFinish && (
          <button
            type="button"
            onClick={() => run('FINISH')}
            disabled={loading !== null}
            style={{
              ...buttonBase,
              border: 'none',
              background: '#111',
              color: '#fff',
              opacity: loading && loading !== 'FINISH' ? 0.6 : 1,
            }}
          >
            {loading === 'FINISH' ? 'Saving…' : 'Finish'}
          </button>
        )}
      </div>
    </div>
  )
}
