// app/client/components/PastBookings.tsx
'use client'

import Link from 'next/link'
import type { BookingLike } from './_helpers'
import { prettyWhen, locationLabel, Badge } from './_helpers'

export default function PastBookings({ items }: { items: BookingLike[] }) {
  const list = items || []

  function statusBadge(statusRaw: any) {
    const s = String(statusRaw || '').toUpperCase()
    if (s === 'COMPLETED') return <Badge label="Completed" bg="#d1fae5" color="#065f46" />
    if (s === 'CANCELLED') return <Badge label="Cancelled" bg="#fee2e2" color="#991b1b" />
    if (s === 'ACCEPTED') return <Badge label="Confirmed" bg="#ecfeff" color="#155e75" />
    if (s === 'PENDING') return <Badge label="Requested" bg="#fef9c3" color="#854d0e" />
    return <Badge label={s || 'Unknown'} bg="#f3f4f6" color="#111827" />
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 900, marginBottom: 4 }}>Past</div>

      {list.map((b) => {
        const svc = b?.service?.name || 'Appointment'
        const pro = b?.professional?.businessName || 'Professional'
        const when = prettyWhen(b?.scheduledFor)
        const loc = locationLabel(b?.professional)

        const hasUnreadAftercare = Boolean((b as any)?.hasUnreadAftercare)

        return (
          <Link key={b.id} href={`/client/bookings/${encodeURIComponent(b.id)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
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
                {statusBadge(b?.status)}
                {hasUnreadAftercare ? <Badge label="New aftercare" bg="#fffbeb" color="#854d0e" /> : null}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
