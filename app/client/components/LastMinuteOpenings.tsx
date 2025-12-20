'use client'

import React, { useEffect, useMemo, useState } from 'react'


type Pro = { businessName: string | null; city: string | null; location: string | null; timeZone: string | null }
type Svc = { name: string } | null

type OpeningRow = {
  id: string
  startAt: string
  endAt: string | null
  discountPct: number | null
  note: string | null
  offeringId: string | null
  professional: Pro
  service: Svc
}

type NotificationRow = {
  id: string
  tier: string
  sentAt: string
  openedAt: string | null
  clickedAt: string | null
  bookedAt: string | null
  opening: OpeningRow
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

function openingHref(o: OpeningRow) {
  if (!o.offeringId) return null
  return `/offerings/${encodeURIComponent(o.offeringId)}?scheduledFor=${encodeURIComponent(o.startAt)}&source=DISCOVERY&openingId=${encodeURIComponent(
    o.id,
  )}&proTimeZone=${encodeURIComponent(o.professional?.timeZone || 'America/Los_Angeles')}`
}

function TierPill({ tier }: { tier: string }) {
  const label =
    tier === 'TIER1_WAITLIST_LAPSED' ? 'Priority' : tier === 'TIER2_FAVORITE_VIEWER' ? 'For you' : 'Open'
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 900,
        border: '1px solid #ddd',
        padding: '3px 8px',
        borderRadius: 999,
        color: '#111',
        background: '#fff',
      }}
    >
      {label}
    </span>
  )
}

export default function LastMinuteOpenings() {
  const [feed, setFeed] = useState<OpeningRow[]>([])
  const [notif, setNotif] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        setErr(null)

        const [nRes, fRes] = await Promise.all([
          fetch('/api/client/openings', { cache: 'no-store' }),
          fetch('/api/openings?hours=48', { cache: 'no-store' }),
        ])

        const nData: any = await nRes.json().catch(() => ({}))
        const fData: any = await fRes.json().catch(() => ({}))

        if (!nRes.ok) throw new Error(nData?.error || 'Failed to load your openings.')
        if (!fRes.ok) throw new Error(fData?.error || 'Failed to load openings feed.')

        if (!alive) return
        setNotif(Array.isArray(nData?.notifications) ? nData.notifications : [])
        setFeed(Array.isArray(fData?.openings) ? fData.openings : [])
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

  const headerLine = useMemo(() => {
    if (loading) return 'Loading last-minute openings…'
    if (err) return 'Couldn’t load last-minute openings'
    const hasAny = notif.length > 0 || feed.length > 0
    return hasAny ? 'Last-minute openings' : 'No last-minute openings right now'
  }, [loading, err, notif.length, feed.length])

  if (loading) return <div style={{ color: '#6b7280', fontSize: 13 }}>{headerLine}</div>

  if (err) {
    return (
      <div style={{ border: '1px solid #fee2e2', background: '#fff1f2', padding: 14, borderRadius: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>{headerLine}</div>
        <div style={{ color: '#7f1d1d', fontSize: 13 }}>{err}</div>
      </div>
    )
  }

  const Section = ({ title, subtitle, children }: any) => (
    <div style={{ border: '1px solid #eee', borderRadius: 16, background: '#fff', padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 900 }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 12, color: '#6b7280' }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  )

  const Card = ({ o, badge }: { o: OpeningRow; badge?: React.ReactNode }) => {
    const when = prettyWhen(o.startAt)
    const proName = o.professional?.businessName || 'Professional'
    const loc = o.professional?.city || o.professional?.location || null
    const svc = o.service?.name || 'Service'
    const discount = o.discountPct ? `${o.discountPct}% off` : null
    const href = openingHref(o)

    return (
      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ fontWeight: 900 }}>{svc}</div>
            {badge}
          </div>
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
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {notif.length > 0 ? (
        <Section title="For you" subtitle="Based on your activity and waitlist">
          {notif.slice(0, 5).map((n) => (
            <Card key={n.id} o={n.opening} badge={<TierPill tier={n.tier} />} />
          ))}
        </Section>
      ) : null}

      {feed.length > 0 ? (
        <Section title="Open now" subtitle="Next 48 hours">
          {feed.slice(0, 8).map((o) => (
            <Card key={o.id} o={o} />
          ))}
        </Section>
      ) : (
        <Section title="Open now" subtitle="Next 48 hours">
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            When pros open slots, they’ll show up here. People love impulse decisions, especially when it’s eyeliner.
          </div>
        </Section>
      )}
    </div>
  )
}
