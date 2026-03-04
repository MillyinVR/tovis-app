// app/client/components/LastMinuteOpenings.tsx
'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { sanitizeTimeZone } from '@/lib/timeZone'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import { prettyWhen } from '@/app/client/components/_helpers'
import { cn } from '@/lib/utils'
import { isRecord } from '@/lib/guards'
import { pickStringOrEmpty } from '@/lib/pick'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'

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

type TabKey = 'forYou' | 'openNow'

function proTz(o: OpeningRow) {
  return sanitizeTimeZone(o.professional?.timeZone, 'UTC')
}

function openingHref(o: OpeningRow) {
  if (!o.offeringId) return null
  const tz = proTz(o)

  return `/offerings/${encodeURIComponent(o.offeringId)}?scheduledFor=${encodeURIComponent(
    o.startAt,
  )}&source=DISCOVERY&openingId=${encodeURIComponent(o.id)}&proTimeZone=${encodeURIComponent(tz)}`
}

function TierPill({ tier }: { tier: string }) {
  const label = tier === 'TIER1_WAITLIST_LAPSED' ? 'Priority' : tier === 'TIER2_FAVORITE_VIEWER' ? 'For you' : 'Open'

  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[11px] font-black text-textPrimary">
      {label}
    </span>
  )
}

function MiniTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center px-1 pb-2 text-[12px] font-black transition',
        'outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bgPrimary',
        active ? 'text-textPrimary' : 'text-textSecondary hover:text-textPrimary',
      )}
    >
      {label}
      {active ? <span className="absolute -bottom-px left-0 h-0.5 w-full bg-accentPrimary" /> : null}
    </button>
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
            className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-3 py-2 text-xs font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
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

/** ---------- parsing helpers (no property access on unknown) ---------- */

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parsePro(x: unknown): Pro {
  if (!isRecord(x)) {
    return { id: null, businessName: null, city: null, location: null, timeZone: null }
  }
  return {
    id: asStringOrNull(x.id),
    businessName: asStringOrNull(x.businessName),
    city: asStringOrNull(x.city),
    location: asStringOrNull(x.location),
    timeZone: asStringOrNull(x.timeZone),
  }
}

function parseSvc(x: unknown): Svc {
  if (!isRecord(x)) return null
  const name = asStringOrNull(x.name)
  return name ? { name } : null
}

function parseOpeningRow(x: unknown): OpeningRow | null {
  if (!isRecord(x)) return null

  const id = pickStringOrEmpty(x.id)
  const startAt = pickStringOrEmpty(x.startAt)
  if (!id || !startAt) return null

  return {
    id,
    startAt,
    endAt: asStringOrNull(x.endAt),
    discountPct: asNumberOrNull(x.discountPct),
    note: asStringOrNull(x.note),
    offeringId: asStringOrNull(x.offeringId),
    professional: parsePro(x.professional),
    service: parseSvc(x.service),
  }
}

function parseNotificationRow(x: unknown): NotificationRow | null {
  if (!isRecord(x)) return null
  const id = pickStringOrEmpty(x.id)
  const tier = pickStringOrEmpty(x.tier)
  const sentAt = pickStringOrEmpty(x.sentAt)

  const opening = parseOpeningRow(x.opening)
  if (!id || !tier || !sentAt || !opening) return null

  return {
    id,
    tier,
    sentAt,
    openedAt: asStringOrNull(x.openedAt),
    clickedAt: asStringOrNull(x.clickedAt),
    bookedAt: asStringOrNull(x.bookedAt),
    opening,
  }
}

function readArrayField(data: Record<string, unknown> | null, key: string): unknown[] {
  if (!data) return []
  const v = data[key]
  return Array.isArray(v) ? v : []
}

export default function LastMinuteOpenings() {
  const [tab, setTab] = useState<TabKey>('openNow')
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

        const nData = await safeJsonRecord(nRes)
        const fData = await safeJsonRecord(fRes)

        if (!nRes.ok) throw new Error(readErrorMessage(nData) ?? 'Failed to load your openings.')
        if (!fRes.ok) throw new Error(readErrorMessage(fData) ?? 'Failed to load openings feed.')

        if (!alive) return

        const notifications = readArrayField(nData, 'notifications').map(parseNotificationRow).filter(Boolean) as NotificationRow[]
        const openings = readArrayField(fData, 'openings').map(parseOpeningRow).filter(Boolean) as OpeningRow[]

        setNotif(notifications)
        setFeed(openings)

        // default mini-tab: "For you" if it exists
        if (notifications.length > 0) setTab('forYou')
      } catch (e: unknown) {
        if (!alive) return
        setErr(e instanceof Error ? e.message : 'Failed to load openings.')
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

  if (loading) return <div className="text-sm font-semibold text-textSecondary">{headerLine}</div>

  if (err) {
    return (
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-1 text-sm font-black text-textPrimary">{headerLine}</div>
        <div className="text-sm font-semibold text-microAccent">{err}</div>
      </div>
    )
  }

  const showForYou = tab === 'forYou'
  const list = showForYou
    ? notif.map((n) => ({ key: n.id, opening: n.opening, badge: <TierPill tier={n.tier} /> }))
    : feed.map((o) => ({ key: o.id, opening: o, badge: null }))

  return (
    <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-black text-textPrimary">Last-minute openings</div>
          <div className="text-[12px] font-semibold text-textSecondary">
            {showForYou ? 'Based on your activity & waitlist' : 'Next 48 hours'}
          </div>
        </div>

        <div className="inline-flex items-end gap-5 border-b border-white/10">
          {notif.length > 0 ? <MiniTab active={tab === 'forYou'} label="For you" onClick={() => setTab('forYou')} /> : null}
          <MiniTab active={tab === 'openNow'} label="Open now" onClick={() => setTab('openNow')} />
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {list.length ? (
          list.slice(0, 8).map((row) => <OpeningCard key={row.key} o={row.opening} badge={row.badge} />)
        ) : (
          <div className="text-sm font-semibold text-textSecondary">
            When pros open slots, they’ll show up here. People love impulse decisions, especially when it’s eyeliner.
          </div>
        )}
      </div>
    </div>
  )
}