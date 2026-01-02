// app/client/components/PendingConsultApprovalBanner.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

type BookingLike = {
  id: string
  scheduledFor?: string | null
  hasPendingConsultationApproval?: boolean | null
  service?: { name?: string | null } | null
  professional?: { businessName?: string | null } | null
}

type Buckets = {
  upcoming?: BookingLike[]
  pending?: BookingLike[]
  prebooked?: BookingLike[]
  past?: BookingLike[]
  waitlist?: any[]
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function prettyWhen(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function PendingConsultApprovalBanner() {
  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<BookingLike | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/client/bookings', { cache: 'no-store' })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to load bookings.')

        const buckets: Buckets = data?.buckets || {}

        // Scan in a sensible priority order:
        // 1) upcoming (because it’s soonest), 2) pending, 3) prebooked
        const all = [
          ...asArray<BookingLike>(buckets.upcoming),
          ...asArray<BookingLike>(buckets.pending),
          ...asArray<BookingLike>(buckets.prebooked),
        ]

        const found = all.find((b) => Boolean(b?.hasPendingConsultationApproval))
        if (!cancelled) setItem(found || null)
      } catch {
        // If this fails, don’t block the dashboard. Just show nothing.
        if (!cancelled) setItem(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const href = useMemo(() => {
    if (!item?.id) return null
    return `/client/bookings/${encodeURIComponent(item.id)}?step=consult`
  }, [item?.id])

  // ✅ “No sign of it” when there isn’t one.
  if (loading) return null
  if (!item || !href) return null

  return (
    <section
      style={{
        border: '1px solid #fde68a',
        background: '#fffbeb',
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#854d0e' }}>Action required</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#111' }}>
            Consultation approval needed
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {item.service?.name ? item.service.name : 'A booking'}{' '}
            {item.professional?.businessName ? `· ${item.professional.businessName}` : ''}{' '}
            {item.scheduledFor ? `· ${prettyWhen(item.scheduledFor)}` : ''}
          </div>
        </div>

        <a
          href={href}
          style={{
            textDecoration: 'none',
            border: '1px solid #111',
            borderRadius: 999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 900,
            color: '#fff',
            background: '#111',
            whiteSpace: 'nowrap',
            alignSelf: 'flex-start',
          }}
        >
          Review &amp; approve
        </a>
      </div>
    </section>
  )
}
