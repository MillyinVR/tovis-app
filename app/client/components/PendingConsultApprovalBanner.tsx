// app/client/components/PendingConsultApprovalBanner.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import ProProfileLink from '@/app/client/components/ProProfileLink'

type BookingLike = {
  id: string
  scheduledFor?: string | null
  hasPendingConsultationApproval?: boolean | null
  service?: { name?: string | null } | null
  professional?: { id?: string | null; businessName?: string | null } | null
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

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
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
        const data = await safeJson(res)
        if (!res.ok) throw new Error(data?.error || 'Failed to load bookings.')

        const buckets: Buckets = data?.buckets || {}

        const all = [
          ...asArray<BookingLike>(buckets.upcoming),
          ...asArray<BookingLike>(buckets.pending),
          ...asArray<BookingLike>(buckets.prebooked),
        ]

        const found = all.find((b) => Boolean(b?.hasPendingConsultationApproval))
        if (!cancelled) setItem(found || null)
      } catch {
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

  if (loading) return null
  if (!item || !href) return null

  const svc = item.service?.name ? item.service.name : 'A booking'
  const proLabel = item.professional?.businessName || 'Your pro'

  return (
    <section className="rounded-card border border-white/10 bg-surfaceGlass p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-xs font-black text-microAccent">Action required</div>
          <div className="text-sm font-black text-textPrimary">Consultation approval needed</div>

          <div className="text-xs font-medium text-textSecondary">
            {svc}
            {' · '}
            <ProProfileLink proId={item.professional?.id ?? null} label={proLabel} className="text-textSecondary" />
            {item.scheduledFor ? ` · ${prettyWhen(item.scheduledFor)}` : ''}
          </div>
        </div>

        <a
          href={href}
          className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-3 py-2 text-xs font-black text-bgPrimary shadow-sm transition hover:bg-accentPrimaryHover"
        >
          Review &amp; approve
        </a>
      </div>
    </section>
  )
}
