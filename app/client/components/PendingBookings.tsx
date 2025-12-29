// app/client/components/PendingBookings.tsx
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { BookingLike } from './_helpers'
import { Badge, prettyWhen, locationLabel, statusUpper } from './_helpers'

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function errorFrom(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in again.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

export default function PendingBookings({
  items,
  onChanged,
}: {
  items: BookingLike[]
  onChanged?: () => void
}) {
  const list = items || []
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actionRequired = useMemo(
    () => list.filter((b) => Boolean(b?.hasPendingConsultationApproval)),
    [list],
  )

  const regularPending = useMemo(
    () => list.filter((b) => !b?.hasPendingConsultationApproval),
    [list],
  )

  async function decide(bookingId: string, action: 'approve' | 'reject') {
    if (!bookingId || busyId) return
    setError(null)
    setBusyId(bookingId)

    try {
      const res = await fetch(`/api/client/bookings/${encodeURIComponent(bookingId)}/consultation/${action}`, {
        method: 'POST',
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(errorFrom(res, data))

      onChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 900, marginBottom: 4 }}>Pending</div>

      {error ? (
        <div style={{ border: '1px solid #fee2e2', background: '#fff1f2', padding: 10, borderRadius: 12, color: '#7f1d1d', fontSize: 12, fontWeight: 800 }}>
          {error}
        </div>
      ) : null}

      {/* ✅ Action required section */}
      {actionRequired.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>
            Action required
          </div>

          {actionRequired.map((b) => {
            const svc = b?.service?.name || 'Appointment'
            const pro = b?.professional?.businessName || 'Professional'
            const when = prettyWhen(b?.scheduledFor)
            const loc = locationLabel(b?.professional)

            const price =
              b?.consultation?.consultationPrice ??
              (typeof (b as any)?.consultationPrice === 'string' ? (b as any).consultationPrice : null)

            return (
              <div key={b.id} style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 900 }}>{svc}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{when}</div>
                </div>

                <div style={{ fontSize: 13, marginTop: 4 }}>
                  <span style={{ fontWeight: 900 }}>{pro}</span>
                  {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                  <Badge label="Action required" bg="#fff7ed" color="#9a3412" />
                  <Badge label="Approve consultation" bg="#fffbeb" color="#854d0e" />
                  {price ? <Badge label={`Proposed: $${price}`} bg="#eef2ff" color="#1e3a8a" /> : null}

                  <Link
                    href={`/client/bookings/${encodeURIComponent(b.id)}?step=consult`}
                    style={{
                      marginLeft: 'auto',
                      textDecoration: 'none',
                      border: '1px solid #111',
                      borderRadius: 999,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 900,
                      color: '#fff',
                      background: '#111',
                    }}
                  >
                    Review
                  </Link>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => decide(b.id, 'approve')}
                    disabled={busyId === b.id}
                    style={{
                      border: '1px solid #16a34a',
                      background: busyId === b.id ? '#d1d5db' : '#16a34a',
                      color: '#fff',
                      borderRadius: 999,
                      padding: '10px 14px',
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: busyId === b.id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {busyId === b.id ? 'Working…' : 'Approve'}
                  </button>

                  <button
                    type="button"
                    onClick={() => decide(b.id, 'reject')}
                    disabled={busyId === b.id}
                    style={{
                      border: '1px solid #ef4444',
                      background: busyId === b.id ? '#d1d5db' : '#fff',
                      color: '#ef4444',
                      borderRadius: 999,
                      padding: '10px 14px',
                      fontSize: 12,
                      fontWeight: 900,
                      cursor: busyId === b.id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Regular pending bookings (requested etc.) */}
      {regularPending.map((b) => {
        const svc = b?.service?.name || 'Appointment'
        const pro = b?.professional?.businessName || 'Professional'
        const when = prettyWhen(b?.scheduledFor)
        const loc = locationLabel(b?.professional)

        const s = statusUpper(b?.status)
        const statusLabel =
          s === 'PENDING' ? 'Requested' : s === 'ACCEPTED' ? 'Confirmed' : s || 'Pending'

        return (
          <Link
            key={b.id}
            href={`/client/bookings/${encodeURIComponent(b.id)}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, cursor: 'pointer', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 900 }}>{svc}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{when}</div>
              </div>

              <div style={{ fontSize: 13, marginTop: 4 }}>
                <span style={{ fontWeight: 900 }}>{pro}</span>
                {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
              </div>

              <div style={{ marginTop: 10 }}>
                <Badge label={statusLabel} bg="#fef9c3" color="#854d0e" />
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
