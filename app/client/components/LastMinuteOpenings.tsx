// app/client/components/LastMinuteOpenings.tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { sanitizeTimeZone } from '@/lib/timeZone'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import { prettyWhen } from '@/app/client/components/_helpers'

type Pro = {
  id?: string | null
  businessName: string | null
  city?: string | null
  location?: string | null
  timeZone: string | null
}

type Svc = { name: string } | null

type OpeningRow = {
  id: string
  startAt: string // ISO UTC
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

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function proTz(o: OpeningRow) {
  // always valid IANA or fallback
  return sanitizeTimeZone(o.professional?.timeZone, 'UTC')
}

function openingHref(o: OpeningRow) {
  if (!o.offeringId) return null
  const tz = proTz(o)

  // scheduledFor is the opening start (UTC ISO). We also pass proTimeZone explicitly.
  return `/offerings/${encodeURIComponent(o.offeringId)}?scheduledFor=${encodeURIComponent(
    o.startAt,
  )}&source=DISCOVERY&openingId=${encodeURIComponent(o.id)}&proTimeZone=${encodeURIComponent(tz)}`
}

function TierPill({ tier }: { tier: string }) {
  const label =
    tier === 'TIER1_WAITLIST_LAPSED'
      ? 'Priority'
      : tier === 'TIER2_FAVORITE_VIEWER'
        ? 'For you'
        : 'Open'

  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-surfaceGlass px-2 py-1 text-[11px] font-black text-textPrimary">
      {label}
    </span>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2 rounded-card border border-white/10 bg-bgPrimary p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-black text-textPrimary">{title}</div>
        {subtitle ? <div className="text-xs font-semibold text-textSecondary">{subtitle}</div> : null}
      </div>
      {children}
    </div>
  )
}

function OpeningCard({ o, badge }: { o: OpeningRow; badge?: React.ReactNode }) {
  const tz = proTz(o)
  const when = prettyWhen(o.startAt, tz)

  const proLabel = o.professional?.businessName || 'Professional'
  const loc = (o.professional?.city || o.professional?.location || null)?.trim?.() || null

  const svc = o.service?.name || 'Service'
  const discount = o.discountPct ? `${o.discountPct}% off` : null
  const href = openingHref(o)

  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-black text-textPrimary">{svc}</div>
          {badge}
        </div>
        <div className="text-xs font-semibold text-textSecondary">
          {when}
          <span className="opacity-75"> · {tz}</span>
        </div>
      </div>

      <div className="mt-1 text-sm text-textPrimary">
        <span className="font-black">
          <ProProfileLink proId={o.professional?.id ?? null} label={proLabel} className="text-textPrimary" />
        </span>

        {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
        {discount ? <span className="text-textSecondary"> · {discount}</span> : null}
      </div>

      {o.note ? <div className="mt-1 text-xs font-medium text-textSecondary">{o.note}</div> : null}

      <div className="mt-3 flex justify-end gap-2">
        {href ? (
          <a
            href={href}
            className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-3 py-2 text-xs font-black text-bgPrimary shadow-sm transition hover:bg-accentPrimaryHover"
          >
            Book this slot
          </a>
        ) : (
          <span className="text-xs font-semibold text-textSecondary">Missing offeringId</span>
        )}
      </div>
    </div>
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

        const nData = await safeJson(nRes)
        const fData = await safeJson(fRes)

        if (!nRes.ok) throw new Error(nData?.error || 'Failed to load your openings.')
        if (!fRes.ok) throw new Error(fData?.error || 'Failed to load openings feed.')

        if (!alive) return
        setNotif(safeArray<NotificationRow>(nData?.notifications))
        setFeed(safeArray<OpeningRow>(fData?.openings))
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

  if (loading) return <div className="text-sm font-medium text-textSecondary">{headerLine}</div>

  if (err) {
    return (
      <div className="rounded-card border border-white/10 bg-surfaceGlass p-4">
        <div className="mb-1 text-sm font-black text-textPrimary">{headerLine}</div>
        <div className="text-sm font-semibold text-microAccent">{err}</div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {notif.length > 0 ? (
        <Section title="For you" subtitle="Based on your activity and waitlist">
          {notif.slice(0, 5).map((n) => (
            <OpeningCard key={n.id} o={n.opening} badge={<TierPill tier={n.tier} />} />
          ))}
        </Section>
      ) : null}

      <Section title="Open now" subtitle="Next 48 hours">
        {feed.length > 0 ? (
          feed.slice(0, 8).map((o) => <OpeningCard key={o.id} o={o} />)
        ) : (
          <div className="text-sm font-medium text-textSecondary">
            When pros open slots, they’ll show up here. People love impulse decisions, especially when it’s eyeliner.
          </div>
        )}
      </Section>
    </div>
  )
}
