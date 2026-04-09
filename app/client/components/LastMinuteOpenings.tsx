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
  id: string | null
  businessName: string | null
  handle: string | null
  avatarUrl: string | null
  professionType: string | null
  locationLabel: string | null
  city: string | null
  location: string | null
  timeZone: string | null
}

type LocationRow = {
  id: string | null
  type: string | null
  timeZone: string | null
  city: string | null
  state: string | null
  formattedAddress: string | null
  lat: string | null
  lng: string | null
}

type OpeningServiceRow = {
  id: string
  openingId: string
  serviceId: string
  offeringId: string
  sortOrder: number
  service: {
    id: string
    name: string
    minPrice: string
    defaultDurationMinutes: number
  }
  offering: {
    id: string
    title: string | null
    salonPriceStartingAt: string | null
    mobilePriceStartingAt: string | null
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
    offersInSalon: boolean
    offersMobile: boolean
  }
}

type PublicIncentiveRow = {
  tier: string
  offerType: string
  label: string
  percentOff: number | null
  amountOff: string | null
  freeAddOnService: { id: string; name: string } | null
} | null

type OpeningRow = {
  id: string
  startAt: string
  endAt: string | null
  note: string | null
  status: string | null
  visibilityMode: string | null
  publicVisibleFrom: string | null
  publicVisibleUntil: string | null
  locationType: string | null
  timeZone: string
  professional: Pro
  location: LocationRow | null
  services: OpeningServiceRow[]
  publicIncentive: PublicIncentiveRow
  legacyOfferingId: string | null
  legacyDiscountPct: number | null
  legacyServiceName: string | null
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
  const tz =
    o.timeZone ||
    o.location?.timeZone ||
    o.professional.timeZone ||
    'UTC'

  return sanitizeTimeZone(tz, 'UTC')
}

function primaryOfferingId(o: OpeningRow) {
  return o.services[0]?.offeringId ?? o.legacyOfferingId ?? null
}

function openingHref(o: OpeningRow) {
  const offeringId = primaryOfferingId(o)
  if (!offeringId) return null

  const tz = proTz(o)

  return `/offerings/${encodeURIComponent(offeringId)}?scheduledFor=${encodeURIComponent(
    o.startAt,
  )}&source=DISCOVERY&openingId=${encodeURIComponent(o.id)}&proTimeZone=${encodeURIComponent(tz)}`
}

function TierPill({ tier }: { tier: string }) {
  const normalized = tier.trim().toUpperCase()

  const label =
    normalized === 'WAITLIST' || normalized === 'TIER1_WAITLIST_LAPSED'
      ? 'Priority'
      : normalized === 'REACTIVATION' || normalized === 'TIER2_FAVORITE_VIEWER'
        ? 'For you'
        : 'Open'

  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[11px] font-black text-textPrimary">
      {label}
    </span>
  )
}

function IncentivePill({ opening }: { opening: OpeningRow }) {
  const label =
    opening.publicIncentive?.label ||
    (opening.legacyDiscountPct != null ? `${opening.legacyDiscountPct}% off` : null)

  if (!label) return null

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

function serviceSummary(o: OpeningRow) {
  const names = Array.from(
    new Set(
      o.services
        .map((row) => row.service.name.trim())
        .filter((name) => name.length > 0),
    ),
  )

  if (names.length === 0) {
    return o.legacyServiceName || 'Service'
  }

  if (names.length === 1) {
    return names[0]
  }

  return `${names[0]} +${names.length - 1} more`
}

function proLabel(o: OpeningRow) {
  return o.professional.businessName || 'Professional'
}

function locationLabel(o: OpeningRow) {
  return (
    o.location?.formattedAddress ||
    o.location?.city ||
    o.professional.city ||
    o.professional.locationLabel ||
    o.professional.location ||
    null
  )
}

function OpeningCard({ o, badge }: { o: OpeningRow; badge?: React.ReactNode }) {
  const tz = proTz(o)
  const when = prettyWhen(o.startAt, tz)
  const svc = serviceSummary(o)
  const pro = proLabel(o)
  const loc = locationLabel(o)
  const href = openingHref(o)

  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-black text-textPrimary">{svc}</div>
          {badge}
          <IncentivePill opening={o} />
        </div>

        <div className="text-xs font-semibold text-textSecondary">
          {when}
          <span className="opacity-75"> · {tz}</span>
        </div>
      </div>

      <div className="mt-1 text-sm text-textPrimary">
        <span className="font-black">
          <ProProfileLink proId={o.professional.id} label={pro} className="text-textPrimary" />
        </span>
        {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
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
          <span className="text-xs font-semibold text-textSecondary">Opening link unavailable</span>
        )}
      </div>
    </div>
  )
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parsePro(x: unknown): Pro {
  if (!isRecord(x)) {
    return {
      id: null,
      businessName: null,
      handle: null,
      avatarUrl: null,
      professionType: null,
      locationLabel: null,
      city: null,
      location: null,
      timeZone: null,
    }
  }

  return {
    id: asStringOrNull(x.id),
    businessName: asStringOrNull(x.businessName),
    handle: asStringOrNull(x.handle),
    avatarUrl: asStringOrNull(x.avatarUrl),
    professionType: asStringOrNull(x.professionType),
    locationLabel: asStringOrNull(x.locationLabel),
    city: asStringOrNull(x.city),
    location: asStringOrNull(x.location),
    timeZone: asStringOrNull(x.timeZone),
  }
}

function parseLocation(x: unknown): LocationRow | null {
  if (!isRecord(x)) return null

  return {
    id: asStringOrNull(x.id),
    type: asStringOrNull(x.type),
    timeZone: asStringOrNull(x.timeZone),
    city: asStringOrNull(x.city),
    state: asStringOrNull(x.state),
    formattedAddress: asStringOrNull(x.formattedAddress),
    lat: asStringOrNull(x.lat),
    lng: asStringOrNull(x.lng),
  }
}

function parseOpeningServiceRow(x: unknown): OpeningServiceRow | null {
  if (!isRecord(x)) return null
  if (!isRecord(x.service) || !isRecord(x.offering)) return null

  const id = pickStringOrEmpty(x.id)
  const openingId = pickStringOrEmpty(x.openingId)
  const serviceId = pickStringOrEmpty(x.serviceId)
  const offeringId = pickStringOrEmpty(x.offeringId)
  const sortOrder = asNumberOrNull(x.sortOrder)

  const serviceName = asStringOrNull(x.service.name)
  const serviceMinPrice = asStringOrNull(x.service.minPrice)
  const defaultDurationMinutes = asNumberOrNull(x.service.defaultDurationMinutes)

  if (
    !id ||
    !openingId ||
    !serviceId ||
    !offeringId ||
    sortOrder == null ||
    !serviceName ||
    !serviceMinPrice ||
    defaultDurationMinutes == null
  ) {
    return null
  }

  const offersInSalon =
    typeof x.offering.offersInSalon === 'boolean' ? x.offering.offersInSalon : null
  const offersMobile =
    typeof x.offering.offersMobile === 'boolean' ? x.offering.offersMobile : null

  if (offersInSalon == null || offersMobile == null) return null

  return {
    id,
    openingId,
    serviceId,
    offeringId,
    sortOrder,
    service: {
      id: serviceId,
      name: serviceName,
      minPrice: serviceMinPrice,
      defaultDurationMinutes,
    },
    offering: {
      id: offeringId,
      title: asStringOrNull(x.offering.title),
      salonPriceStartingAt: asStringOrNull(x.offering.salonPriceStartingAt),
      mobilePriceStartingAt: asStringOrNull(x.offering.mobilePriceStartingAt),
      salonDurationMinutes:
        x.offering.salonDurationMinutes === null ? null : asNumberOrNull(x.offering.salonDurationMinutes),
      mobileDurationMinutes:
        x.offering.mobileDurationMinutes === null ? null : asNumberOrNull(x.offering.mobileDurationMinutes),
      offersInSalon,
      offersMobile,
    },
  }
}

function parsePublicIncentive(x: unknown): PublicIncentiveRow {
  if (!isRecord(x)) return null

  const tier = asStringOrNull(x.tier)
  const offerType = asStringOrNull(x.offerType)
  const label = asStringOrNull(x.label)

  if (!tier || !offerType || !label) return null

  const freeAddOnService =
    isRecord(x.freeAddOnService) &&
    asStringOrNull(x.freeAddOnService.id) &&
    asStringOrNull(x.freeAddOnService.name)
      ? {
          id: asStringOrNull(x.freeAddOnService.id)!,
          name: asStringOrNull(x.freeAddOnService.name)!,
        }
      : null

  return {
    tier,
    offerType,
    label,
    percentOff: x.percentOff === null ? null : asNumberOrNull(x.percentOff),
    amountOff: x.amountOff === null ? null : asStringOrNull(x.amountOff),
    freeAddOnService,
  }
}

function parseOpeningRow(x: unknown): OpeningRow | null {
  if (!isRecord(x)) return null

  const id = pickStringOrEmpty(x.id)
  const startAt = pickStringOrEmpty(x.startAt)
  if (!id || !startAt) return null

  const services = readArrayField(x, 'services')
    .map(parseOpeningServiceRow)
    .filter((row): row is OpeningServiceRow => row !== null)

  const legacyService =
    isRecord(x.service) && asStringOrNull(x.service.name)
      ? { name: asStringOrNull(x.service.name)! }
      : null

  const timeZone =
    asStringOrNull(x.timeZone) ||
    (isRecord(x.location) ? asStringOrNull(x.location.timeZone) : null) ||
    (isRecord(x.professional) ? asStringOrNull(x.professional.timeZone) : null) ||
    'UTC'

  return {
    id,
    startAt,
    endAt: x.endAt === null ? null : asStringOrNull(x.endAt),
    note: x.note === null ? null : asStringOrNull(x.note),
    status: asStringOrNull(x.status),
    visibilityMode: asStringOrNull(x.visibilityMode),
    publicVisibleFrom: x.publicVisibleFrom === null ? null : asStringOrNull(x.publicVisibleFrom),
    publicVisibleUntil: x.publicVisibleUntil === null ? null : asStringOrNull(x.publicVisibleUntil),
    locationType: asStringOrNull(x.locationType),
    timeZone,
    professional: parsePro(x.professional),
    location: parseLocation(x.location),
    services,
    publicIncentive: parsePublicIncentive(x.publicIncentive),
    legacyOfferingId: asStringOrNull(x.offeringId),
    legacyDiscountPct: asNumberOrNull(x.discountPct),
    legacyServiceName: legacyService?.name ?? null,
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

        const notifications = readArrayField(nData, 'notifications')
          .map(parseNotificationRow)
          .filter((row): row is NotificationRow => row !== null)

        const openings = readArrayField(fData, 'openings')
          .map(parseOpeningRow)
          .filter((row): row is OpeningRow => row !== null)

        setNotif(notifications)
        setFeed(openings)

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
            {showForYou ? 'Based on your activity, matches, and waitlist' : 'Public openings in the next 48 hours'}
          </div>
        </div>

        <div className="inline-flex items-end gap-5 border-b border-white/10">
          {notif.length > 0 ? (
            <MiniTab active={tab === 'forYou'} label="For you" onClick={() => setTab('forYou')} />
          ) : null}
          <MiniTab active={tab === 'openNow'} label="Open now" onClick={() => setTab('openNow')} />
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {list.length ? (
          list.slice(0, 8).map((row) => <OpeningCard key={row.key} o={row.opening} badge={row.badge} />)
        ) : (
          <div className="text-sm font-semibold text-textSecondary">
            When pros open slots, they’ll show up here. Excellent timing remains undefeated.
          </div>
        )}
      </div>
    </div>
  )
}