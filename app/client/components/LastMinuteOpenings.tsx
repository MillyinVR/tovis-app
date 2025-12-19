'use client'

import { useEffect, useMemo, useState } from 'react'

type OpeningRow = {
  id: string
  startAt: string
  endAt: string | null
  discountPct: number | null
  note: string | null
  offeringId: string | null
  professional: { businessName: string | null; city: string | null; location: string | null; timeZone: string | null }
  service: { name: string } | null
  notifications: Array<{ tier: string; sentAt: string; openedAt: string | null; clickedAt: string | null; bookedAt: string | null }>
}

function prettyWhen(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

export default function LastMinuteOpenings() {
  const [items, setItems] = useState<OpeningRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        setErr(null)
        const res = await fetch('/api/client/openings?hours=48', { cache: 'no-store' })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to load openings.')
        if (!alive) return
        setItems(Array.isArray(data?.openings) ? data.openings : [])
      } catch (e: any) {
        if (!alive) return
        setErr(e?.message || 'Failed to load openings.')
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const has = items.length > 0

  const headerLine = useMemo(() => {
    if (loading) return 'Loading last-minute openings…'
    if (err) return 'Couldn’t load last-minute openings'
    return has ? 'Last-minute openings' : 'No last-minute openings right now'
  }, [loading, err, has])

  if (loading) return <div style={{ color: '#6b7280', fontSize: 13 }}>{headerLine}</div>

  if (err) {
    return (
      <div style={{ border: '1px solid #fee2e2', background: '#fff1f2', padding: 14, borderRadius: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>{headerLine}</div>
        <div style={{ color: '#7f1d1d', fontSize: 13 }}>{err}</div>
      </div>
    )
  }

  if (!has) {
    return (
      <div style={{ border: '1px solid #eee', background: '#fff', padding: 14, borderRadius: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>{headerLine}</div>
        <div style={{ color: '#6b7280', fontSize: 13 }}>
          When pros open slots, they’ll show up here. Humans love novelty, especially when it’s a haircut.
        </div>
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 16, background: '#fff', padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 900 }}>{headerLine}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>Next 48 hours</div>
      </div>

      {items.map((o) => {
        const when = prettyWhen(o.startAt)
        const proName = o.professional?.businessName || 'Professional'
        const loc = o.professional?.city || o.professional?.location || null
        const svc = o.service?.name || 'Service'
        const discount = o.discountPct ? `${o.discountPct}% off` : null

        // “Book” link goes straight into your existing booking flow.
        // We pass scheduledFor + source. proTimeZone helps the display.
        const href =
          o.offeringId
            ? `/offerings/${encodeURIComponent(o.offeringId)}?scheduledFor=${encodeURIComponent(o.startAt)}&source=DISCOVERY&openingId=${encodeURIComponent(o.id)}&proTimeZone=${encodeURIComponent(o.professional?.timeZone || 'America/Los_Angeles')}`
            : null


        return (
          <div key={o.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <div style={{ fontWeight: 900 }}>{svc}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{when}</div>
            </div>

            <div style={{ fontSize: 13, marginTop: 4 }}>
              <span style={{ fontWeight: 900 }}>{proName}</span>
              {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
              {discount ? <span style={{ color: '#6b7280' }}> · {discount}</span> : null}
            </div>

            {o.note ? <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{o.note}</div> : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              {href ? (
                <a
                  href={href}
                  style={{
                    textDecoration: 'none',
                    borderRadius: 999,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 900,
                    background: '#111',
                    color: '#fff',
                  }}
                >
                  Book this slot
                </a>
              ) : (
                <span style={{ fontSize: 12, color: '#6b7280' }}>Missing offeringId</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
