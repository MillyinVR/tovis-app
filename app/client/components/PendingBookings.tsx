// app/client/components/PendingBookings.tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { BookingLike } from './_helpers'
import { prettyWhen, locationLabel, Badge } from './_helpers'

export default function PendingBookings({ items }: { items: BookingLike[] }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [local, setLocal] = useState<BookingLike[]>(items || [])

  async function cancelRequest(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/client/bookings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to cancel.')
      setLocal((prev) => prev.filter((b) => b.id !== id))
    } catch (e: any) {
      alert(e?.message || 'Failed to cancel.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 900, marginBottom: 4 }}>Pending</div>

      {local.map((b) => {
        const svc = b?.service?.name || 'Appointment'
        const pro = b?.professional?.businessName || 'Professional'
        const when = prettyWhen(b?.scheduledFor)
        const loc = locationLabel(b?.professional)

        return (
          <Link
            key={b.id}
            href={`/client/bookings/${encodeURIComponent(b.id)}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 900 }}>{svc}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{when}</div>
              </div>

              <div style={{ fontSize: 13, marginTop: 4 }}>
                <span style={{ fontWeight: 900 }}>{pro}</span>
                {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                <Badge label="Requested" bg="#fef9c3" color="#854d0e" />

                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    cancelRequest(b.id)
                  }}
                  disabled={busyId === b.id}
                  style={{
                    marginLeft: 'auto',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    borderRadius: 999,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 900,
                    background: '#fff',
                    cursor: busyId === b.id ? 'default' : 'pointer',
                    opacity: busyId === b.id ? 0.6 : 1,
                  }}
                >
                  {busyId === b.id ? 'Cancelling…' : 'Cancel request'}
                </button>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
