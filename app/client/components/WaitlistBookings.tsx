// app/client/components/WaitlistBookings.tsx
'use client'

import type { WaitlistLike } from './_helpers'
import { prettyWhen, locationLabel, Badge } from './_helpers'

export default function WaitlistBookings({ items }: { items: WaitlistLike[] }) {
  const list = items ?? []

  function editAvailabilityPlaceholder() {
    alert('Waitlist edit/remove next. The UI exists, your dreams are safe.')
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 900, marginBottom: 4 }}>Waitlist</div>

      {list.map((w) => {
        const svc = w?.service?.name || 'Service'
        const pro = w?.professional?.businessName || 'Any professional'
        const joined = prettyWhen(w?.createdAt)
        const loc = locationLabel(w?.professional)

        return (
          <div key={w.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <div style={{ fontWeight: 900 }}>{svc}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Joined {joined}</div>
            </div>

            <div style={{ fontSize: 13, marginTop: 4 }}>
              <span style={{ fontWeight: 900 }}>{pro}</span>
              {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <Badge label="Waitlisted" bg="#f3f4f6" color="#111827" />

              <button
                type="button"
                onClick={editAvailabilityPlaceholder}
                style={{
                  marginLeft: 'auto',
                  border: '1px solid #ddd',
                  borderRadius: 999,
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 900,
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                Edit availability / Remove
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
