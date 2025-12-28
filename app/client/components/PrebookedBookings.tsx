// app/client/components/PrebookedBookings.tsx
'use client'

import Link from 'next/link'
import type { BookingLike } from './_helpers'
import { prettyWhen, locationLabel, Badge } from './_helpers'

export default function PrebookedBookings({ items }: { items: BookingLike[] }) {
  const list = items || []

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 900, marginBottom: 4 }}>Prebooked</div>

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
                <Badge label="Prebooked" bg="#eef2ff" color="#1e3a8a" />
                <Badge label="Awaiting approval" bg="#fef9c3" color="#854d0e" />

                {hasUnreadAftercare ? <Badge label="New aftercare" bg="#fffbeb" color="#854d0e" /> : null}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
