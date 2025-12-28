'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function extractError(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 409) return data?.error || 'This consultation is already decided.'
  return `Request failed (${res.status}).`
}

export default function ClientApprovalButtons({ bookingId }: { bookingId: string }) {
  const router = useRouter()

  const [loading, setLoading] = useState<'APPROVE' | 'REJECT' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  async function act(action: 'APPROVE' | 'REJECT') {
    if (!bookingId) {
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
      const res = await fetch(`/api/client/bookings/${encodeURIComponent(bookingId)}/consultation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        signal: controller.signal,
      })

      const data = await safeJson(res)
      if (!res.ok) {
        throw new Error(extractError(res, data))
      }

      // Make sure the next page sees updated server state.
      router.refresh()

      // Take them back to the booking. This is the normal UX.
      router.push(`/client/bookings/${encodeURIComponent(bookingId)}?consultation=${action.toLowerCase()}`)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      if (!mountedRef.current) return
      setError(e?.message || 'Network error. Try again.')
    } finally {
      // Only clear if we’re still mounted and this is the latest request.
      if (!mountedRef.current) return
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setLoading(null)
    }
  }

  const buttonBase: React.CSSProperties = {
    borderRadius: 999,
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 900,
    cursor: 'pointer',
  }

  const disabled = loading !== null

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {error ? (
        <div aria-live="polite" style={{ fontSize: 12, color: '#b91c1c' }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => act('APPROVE')}
          style={{
            ...buttonBase,
            border: '1px solid #111',
            background: loading === 'APPROVE' ? '#111' : '#fff',
            color: loading === 'APPROVE' ? '#fff' : '#111',
            opacity: loading && loading !== 'APPROVE' ? 0.6 : 1,
          }}
        >
          {loading === 'APPROVE' ? 'Approving…' : 'Approve'}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => act('REJECT')}
          style={{
            ...buttonBase,
            border: '1px solid #e5e7eb',
            background: loading === 'REJECT' ? '#fee2e2' : '#fafafa',
            color: '#7f1d1d',
            opacity: loading && loading !== 'REJECT' ? 0.6 : 1,
          }}
        >
          {loading === 'REJECT' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  )
}
