// app/client/components/UpcomingBookings.tsx
'use client'

import Link from 'next/link'
import type { BookingLike } from './_helpers'
import { prettyWhen } from './_helpers'

function prettyWhere(b: BookingLike) {
  const p = b.professional
  const bits = [p?.location, p?.city, p?.state].filter(Boolean)
  return bits.length ? bits.join(', ') : null
}

export default function UpcomingBookings({ items }: { items: BookingLike[] }) {
  if (!items?.length) return null

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>Upcoming</h2>

      <div style={{ display: 'grid', gap: 10 }}>
        {items.map((b) => {
          const when = prettyWhen(b.scheduledFor)
          const serviceName = b.service?.name || 'Appointment'
          const proName = b.professional?.businessName || 'Professional'
          const where = prettyWhere(b)

          return (
            <Link
              key={b.id}
              href={`/client/bookings/${encodeURIComponent(b.id)}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  border: '1px solid #eee',
                  borderRadius: 12,
                  padding: 12,
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 14 }}>{serviceName}</div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 900,
                      color: '#166534',
                      background: '#f0fdf4',
                      border: '1px solid #dcfce7',
                      padding: '2px 8px',
                      borderRadius: 999,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Confirmed
                  </div>
                </div>

                <div style={{ marginTop: 6, fontSize: 13, color: '#111' }}>
                  <span style={{ fontWeight: 800 }}>{when}</span> · <span>{proName}</span>
                  {where ? <span style={{ color: '#6b7280' }}> · {where}</span> : null}
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                  Tap to view details.
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
