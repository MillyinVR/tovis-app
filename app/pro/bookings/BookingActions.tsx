'use client'

import { useEffect, useRef, useState } from 'react'

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
type SafeStatus = BookingStatus | 'UNKNOWN'
type ActionStatus = 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'

type BookingActionsProps = {
  bookingId: string
  currentStatus: BookingStatus | string
}

function normalizeStatus(s: string): SafeStatus {
  if (s === 'PENDING' || s === 'ACCEPTED' || s === 'COMPLETED' || s === 'CANCELLED') return s
  return 'UNKNOWN'
}

export default function BookingActions({ bookingId, currentStatus }: BookingActionsProps) {
  const [status, setStatus] = useState<SafeStatus>(normalizeStatus(String(currentStatus)))
  const [loading, setLoading] = useState<ActionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setStatus(normalizeStatus(String(currentStatus)))
  }, [currentStatus])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const isPending = status === 'PENDING'
  const isAccepted = status === 'ACCEPTED'
  const isTerminal = status === 'COMPLETED' || status === 'CANCELLED' || status === 'UNKNOWN'

  const canAccept = isPending
  const canComplete = isAccepted
  const canCancel = isPending || isAccepted

  async function updateStatus(nextStatus: ActionStatus) {
    if (loading) return

    setError(null)
    setLoading(nextStatus)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`/api/pro/bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
        signal: controller.signal,
      })

      const data: any = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg =
          typeof data?.error === 'string'
            ? data.error
            : `Failed to update booking (${res.status})`
        setError(msg)
        return
      }

      const serverStatus = typeof data?.status === 'string' ? data.status : nextStatus
      setStatus(normalizeStatus(serverStatus))
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
    return (
      <div style={{ fontSize: 12, color: '#777' }}>
        Status: {label}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'flex-end' }}>
      <div style={{ fontSize: 12, color: '#777' }}>Status: {status}</div>

      {error && (
        <div
          aria-live="polite"
          style={{ fontSize: 11, color: 'red', maxWidth: 220, textAlign: 'right' }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {canAccept && (
          <button
            type="button"
            onClick={() => updateStatus('ACCEPTED')}
            disabled={loading !== null}
            style={{
              ...buttonBase,
              border: '1px solid #111',
              background: loading === 'ACCEPTED' ? '#111' : '#fff',
              color: loading === 'ACCEPTED' ? '#fff' : '#111',
              opacity: loading && loading !== 'ACCEPTED' ? 0.6 : 1,
            }}
          >
            {loading === 'ACCEPTED' ? 'Accepting…' : 'Accept'}
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={() => updateStatus('CANCELLED')}
            disabled={loading !== null}
            style={{
              ...buttonBase,
              border: '1px solid #ddd',
              background: loading === 'CANCELLED' ? '#eee' : '#fafafa',
              color: '#444',
              opacity: loading && loading !== 'CANCELLED' ? 0.6 : 1,
            }}
          >
            {loading === 'CANCELLED' ? 'Cancelling…' : 'Cancel'}
          </button>
        )}

        {canComplete && (
          <button
            type="button"
            onClick={() => updateStatus('COMPLETED')}
            disabled={loading !== null}
            style={{
              ...buttonBase,
              border: 'none',
              background: '#111',
              color: '#fff',
              opacity: loading && loading !== 'COMPLETED' ? 0.6 : 1,
            }}
          >
            {loading === 'COMPLETED' ? 'Saving…' : 'Mark completed'}
          </button>
        )}
      </div>
    </div>
  )
}
