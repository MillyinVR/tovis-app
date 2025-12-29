'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

async function safeJson(res: Response) {
  return res.json().catch(() => ({}))
}

function errorFrom(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

export default function ConsultationDecisionCard(props: {
  bookingId: string
  appointmentTz: string
  notes: string
  proposedTotalLabel: string | null
  disabled?: boolean
}) {
  const { bookingId, appointmentTz, notes, proposedTotalLabel, disabled } = props
  const router = useRouter()

  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function decide(action: 'approve' | 'reject') {
    if (disabled || loading) return
    setErr(null)
    setLoading(action)

    try {
      const url = `/api/client/bookings/${encodeURIComponent(bookingId)}/consultation/${action}`
      const res = await fetch(url, { method: 'POST' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(res, data))

      // Refresh server component data (booking.sessionStep + consultationApproval.status)
      router.refresh()
      // Optional: kick them back to overview after decision
      // router.push(`/client/bookings/${encodeURIComponent(bookingId)}?step=overview`)
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <section
      style={{
        borderRadius: 12,
        border: '1px solid #fde68a',
        background: '#fffbeb',
        padding: 12,
        marginTop: 8,
      }}
    >
      <div style={{ fontWeight: 900, color: '#854d0e', marginBottom: 6 }}>Approve this consultation?</div>

      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Proposed total</div>
      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>
        {proposedTotalLabel || 'Not provided'} <span style={{ fontSize: 12, color: '#6b7280' }}>· {appointmentTz}</span>
      </div>

      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Notes</div>
      <div style={{ fontSize: 13, color: '#111', whiteSpace: 'pre-wrap', marginBottom: 10 }}>
        {notes?.trim() ? notes : 'No consultation notes provided.'}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => decide('approve')}
          disabled={disabled || loading !== null}
          style={{
            border: '1px solid #111',
            borderRadius: 999,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 900,
            color: '#fff',
            background: '#111',
            cursor: disabled || loading ? 'not-allowed' : 'pointer',
            opacity: loading === 'approve' ? 0.7 : 1,
          }}
        >
          {loading === 'approve' ? 'Approving…' : 'Approve'}
        </button>

        <button
          type="button"
          onClick={() => decide('reject')}
          disabled={disabled || loading !== null}
          style={{
            border: '1px solid #111',
            borderRadius: 999,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 900,
            color: '#111',
            background: '#fff',
            cursor: disabled || loading ? 'not-allowed' : 'pointer',
            opacity: loading === 'reject' ? 0.7 : 1,
          }}
        >
          {loading === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {err ? (
        <div style={{ marginTop: 10, fontSize: 12, color: '#7f1d1d', fontWeight: 700 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
        If you reject, the pro gets kicked back to consultation to revise.
      </div>
    </section>
  )
}
