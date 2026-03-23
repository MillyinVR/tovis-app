// app/client/ClientBookingsDashboard.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'

import LastMinuteOpenings from './components/LastMinuteOpenings'
import ProProfileLink from './components/ProProfileLink'
import type { BookingLike, WaitlistLike } from './components/_helpers'
import {
  Badge,
  bookingLocationLabel,
  prettyWhen,
  sourceUpper,
  statusUpper,
  waitlistLocationLabel,
} from './components/_helpers'

type ApiBuckets = {
  upcoming: BookingLike[]
  pending: BookingLike[]
  waitlist: WaitlistLike[]
  prebooked: BookingLike[]
  past: BookingLike[]
}

type ApiResponse = {
  buckets?: unknown
  error?: string
}

type TabKey = 'upcoming' | 'aftercare' | 'pending' | 'waitlist'

type Counts = {
  upcoming: number
  aftercare: number
  pending: number
  waitlist: number
}

type CardMeta = {
  href: string
  badge: React.ReactNode
}

const EMPTY: ApiBuckets = {
  upcoming: [],
  pending: [],
  waitlist: [],
  prebooked: [],
  past: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function isBookingLike(value: unknown): value is BookingLike {
  return isRecord(value) && typeof value.id === 'string'
}

function isWaitlistLike(value: unknown): value is WaitlistLike {
  return isRecord(value) && typeof value.id === 'string'
}

function readBookingArray(value: unknown): BookingLike[] {
  if (!Array.isArray(value)) return []
  return value.filter(isBookingLike)
}

function readWaitlistArray(value: unknown): WaitlistLike[] {
  if (!Array.isArray(value)) return []
  return value.filter(isWaitlistLike)
}

function normalizeBuckets(input: unknown): ApiBuckets {
  if (!isRecord(input)) return EMPTY

  const prebooked = readBookingArray(input.prebooked)
  const confirmedFallback = readBookingArray(input.confirmed)

  return {
    upcoming: readBookingArray(input.upcoming),
    pending: readBookingArray(input.pending),
    waitlist: readWaitlistArray(input.waitlist),
    prebooked: prebooked.length > 0 ? prebooked : confirmedFallback,
    past: readBookingArray(input.past),
  }
}

function bookingTitle(booking: BookingLike | null | undefined): string {
  return booking?.display?.title || booking?.display?.baseName || 'Appointment'
}

function isPrebookedSource(source: unknown): boolean {
  const normalized = sourceUpper(source)
  return normalized === 'AFTERCARE' || normalized === 'PREBOOKED'
}

function isCompleted(booking: BookingLike): boolean {
  return statusUpper(booking.status) === 'COMPLETED'
}

function firstChar(value: string): string {
  return value.trim().charAt(0).toUpperCase()
}

function bookingSearchText(booking: BookingLike): string {
  return [
    bookingTitle(booking),
    booking.professional?.businessName || '',
    bookingLocationLabel(booking),
    statusUpper(booking.status),
    sourceUpper(booking.source),
    booking.display?.baseName || '',
    booking.display?.title || '',
  ]
    .join(' ')
    .toLowerCase()
}

function waitlistSearchText(waitlist: WaitlistLike): string {
  return [
    waitlist.service?.name || '',
    waitlist.professional?.businessName || '',
    waitlistLocationLabel(waitlist.professional),
    waitlist.notes || '',
    'waitlist',
  ]
    .join(' ')
    .toLowerCase()
}

function loadStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()

    const values = parsed
      .map((item) => (typeof item === 'string' ? item : String(item)))
      .filter((item) => item.trim().length > 0)

    return new Set(values)
  } catch {
    return new Set()
  }
}

function saveStringSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)))
  } catch {
    // ignore storage failures
  }
}

function parseTime(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  return null
}

function getBookingCardMeta(params: {
  booking: BookingLike
  activeTab: TabKey | null
  recentlyApprovedIds: Set<string>
}): CardMeta {
  const { booking, activeTab, recentlyApprovedIds } = params
  const status = statusUpper(booking.status)
  const recentlyApproved = recentlyApprovedIds.has(booking.id)

  const href =
    activeTab === 'aftercare'
      ? `/client/bookings/${encodeURIComponent(booking.id)}?step=aftercare`
      : booking.hasPendingConsultationApproval
        ? `/client/bookings/${encodeURIComponent(booking.id)}?step=consult`
        : booking.hasUnreadAftercare || isCompleted(booking)
          ? `/client/bookings/${encodeURIComponent(booking.id)}?step=aftercare`
          : `/client/bookings/${encodeURIComponent(booking.id)}?step=overview`

  let badge: React.ReactNode = null
  if (recentlyApproved) {
    badge = <Badge label="Recently approved" variant="success" />
  } else if (booking.hasPendingConsultationApproval) {
    badge = <Badge label="Action required" variant="accent" />
  } else if (status === 'PENDING') {
    badge = <Badge label="Requested" variant="accent" />
  } else if (status === 'ACCEPTED') {
    badge = <Badge label="Confirmed" variant="success" />
  } else if (status === 'COMPLETED') {
    badge = <Badge label="Completed" variant="default" />
  }

  return { href, badge }
}

function HeroThumb(props: { title: string; subtitle?: string | null }) {
  const primary = firstChar(props.title)
  const secondary = firstChar(props.subtitle || '') || primary

  return (
    <div
      className={cn(
        'relative h-[74px] w-[74px] shrink-0 overflow-hidden rounded-card border border-white/10 bg-bgPrimary',
      )}
    >
      <div className="absolute inset-0 opacity-70 [background:radial-gradient(60px_60px_at_20%_20%,rgba(255,255,255,0.10),transparent_60%),radial-gradient(80px_80px_at_80%_70%,rgba(255,255,255,0.06),transparent_55%)]" />
      <div className="absolute inset-0 bg-surfaceGlass/30" />
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-baseline gap-1">
          <span className="text-[20px] font-black tracking-tight text-textPrimary">
            {primary}
          </span>
          <span className="text-[13px] font-black tracking-tight text-textSecondary">
            {secondary}
          </span>
        </div>
      </div>
    </div>
  )
}

function TopTabs(props: {
  tab: TabKey
  setTab: (key: TabKey) => void
  counts: Counts
  hasUnreadAftercare: boolean
}) {
  const items: Array<{ k: TabKey; label: string; count: number; dot?: boolean }> =
    [
      { k: 'upcoming', label: 'Upcoming', count: props.counts.upcoming },
      {
        k: 'aftercare',
        label: 'Aftercare',
        count: props.counts.aftercare,
        dot: props.hasUnreadAftercare,
      },
      {
        k: 'pending',
        label: 'Pending',
        count: props.counts.pending,
        dot: props.counts.pending > 0,
      },
      { k: 'waitlist', label: 'Waitlist', count: props.counts.waitlist },
    ]

  const activeIndex = Math.max(0, items.findIndex((item) => item.k === props.tab))
  const indicatorStyle = { transform: `translateX(${activeIndex * 100}%)` }

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-xl">
        <div
          className={cn(
            'relative rounded-full border border-white/10 bg-bgSecondary p-1',
            'shadow-[0_10px_30px_rgba(0,0,0,0.35)]',
          )}
        >
          <div className="pointer-events-none absolute inset-0 rounded-full [background:radial-gradient(700px_180px_at_30%_0%,rgba(255,255,255,0.14),transparent_60%)]" />

          <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
            <div className="relative h-full">
              <div
                style={indicatorStyle}
                className={cn(
                  'absolute left-0 top-0 h-full w-1/4 rounded-full',
                  'border border-white/15 bg-bgPrimary',
                  'shadow-[0_12px_35px_rgba(0,0,0,0.45)]',
                  'transition-transform duration-300 ease-out',
                  '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.10)]',
                )}
              />
            </div>
          </div>

          <div className="relative flex items-center justify-between">
            {items.map((item) => {
              const active = props.tab === item.k

              return (
                <button
                  key={item.k}
                  type="button"
                  onClick={() => props.setTab(item.k)}
                  className={cn(
                    'relative z-10 flex w-1/4 items-center justify-center gap-2 rounded-full px-3 py-2',
                    'whitespace-nowrap text-[12px] font-black outline-none transition',
                    'focus-visible:ring-2 focus-visible:ring-accentPrimary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bgPrimary',
                    active
                      ? 'text-textPrimary'
                      : 'text-textPrimary/90 hover:text-textPrimary',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.dot ? (
                    <span className="relative inline-flex">
                      <span className="h-1.5 w-1.5 rounded-full bg-accentPrimary" />
                      <span className="absolute -inset-2 rounded-full bg-accentPrimary/15 blur-md" />
                    </span>
                  ) : null}

                  <span
                    className={cn(
                      'transition-opacity',
                      active ? 'opacity-100' : 'opacity-90',
                    )}
                  >
                    {item.label}
                  </span>

                  <span
                    className={cn(
                      'inline-flex items-center justify-center rounded-full px-1.5 py-0.5',
                      'text-[11px] font-black leading-none transition',
                      active
                        ? 'border border-white/15 bg-bgSecondary text-textPrimary'
                        : 'border border-white/8 bg-bgPrimary text-textPrimary/85',
                    )}
                  >
                    {item.count > 99 ? '99+' : String(item.count)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchBar(props: {
  value: string
  onChange: (value: string) => void
  onClear: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="tovis-glass rounded-full border border-white/10 bg-bgSecondary px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            placeholder="Search your bookings…"
            className={cn(
              'w-full bg-transparent text-[13px] font-semibold outline-none',
              'text-textPrimary placeholder:text-textSecondary/70',
            )}
            aria-label="Search bookings"
          />

          {props.value.trim() ? (
            <button
              type="button"
              onClick={props.onClear}
              className={cn(
                'rounded-full border border-white/10 bg-bgPrimary px-2.5 py-1',
                'text-[11px] font-black text-textPrimary transition hover:border-white/20',
              )}
            >
              Clear
            </button>
          ) : null}

          <span
            className="ml-1 pointer-events-none text-[13px] text-textSecondary/80"
            aria-hidden
          >
            ⌕
          </span>
        </div>
      </div>
    </div>
  )
}

function BookingHeroCard(props: {
  booking: BookingLike
  badge?: React.ReactNode
  href: string
}) {
  const router = useRouter()

  const title = bookingTitle(props.booking)
  const when = prettyWhen(props.booking.scheduledFor, props.booking.timeZone)
  const proLabel = props.booking.professional?.businessName || 'Professional'
  const location = bookingLocationLabel(props.booking)

  const goToBooking = () => {
    router.push(props.href)
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={goToBooking}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          goToBooking()
        }
      }}
      className={cn(
        'group cursor-pointer rounded-card border border-white/10 bg-bgSecondary p-4 transition',
        'hover:border-white/20 hover:bg-surfaceGlass/40',
        'focus-visible:ring-2 focus-visible:ring-accentPrimary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bgPrimary',
      )}
    >
      <div className="flex gap-4">
        <HeroThumb title={title} subtitle={proLabel} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-black text-textPrimary">
                {title}
              </div>
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                {when}
              </div>
            </div>

            <div className="shrink-0">{props.badge}</div>
          </div>

          <div className="mt-2 text-[13px] text-textPrimary">
            <span
              className="font-black"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ProProfileLink
                proId={props.booking.professional?.id ?? null}
                label={proLabel}
                className="text-textPrimary"
              />
            </span>

            {location ? (
              <span className="text-textSecondary"> · {location}</span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isPrebookedSource(props.booking.source) ? (
              <Badge label="Prebooked" variant="default" />
            ) : null}
            {props.booking.hasUnreadAftercare ? (
              <Badge label="New aftercare" variant="accent" />
            ) : null}
            {props.booking.hasPendingConsultationApproval ? (
              <Badge label="Action required" variant="accent" />
            ) : null}

            <span className="ml-auto text-[12px] font-black text-textPrimary transition group-hover:translate-x-0.5">
              View →
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function WaitlistHeroCard(props: { waitlist: WaitlistLike }) {
  const serviceName = props.waitlist.service?.name || 'Service'
  const proLabel = props.waitlist.professional?.businessName || 'Professional'
  const location = waitlistLocationLabel(props.waitlist.professional)

  return (
    <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="flex gap-4">
        <HeroThumb title={serviceName} subtitle={proLabel} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-black text-textPrimary">
                {serviceName}
              </div>
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                Waitlist entry
              </div>
            </div>

            <Badge label="Watching" variant="default" />
          </div>

          <div className="mt-2 text-[13px] text-textPrimary">
            <span className="font-black text-textPrimary">{proLabel}</span>
            {location ? (
              <span className="text-textSecondary"> · {location}</span>
            ) : null}
          </div>

          {props.waitlist.notes ? (
            <div className="mt-2 line-clamp-2 text-[12px] font-semibold text-textSecondary">
              {props.waitlist.notes}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ConsultationApprovalBanner(props: {
  approvals: BookingLike[]
  searchActive: boolean
}) {
  const router = useRouter()

  if (props.approvals.length === 0) return null

  const count = props.approvals.length
  const first = props.approvals[0]
  const firstHref = `/client/bookings/${encodeURIComponent(first.id)}?step=consult`

  return (
    <div className="mx-auto w-full max-w-xl">
      <div
        className={cn(
          'rounded-card border border-white/10 bg-accentPrimary p-4 text-bgPrimary',
          'shadow-[0_18px_60px_rgba(0,0,0,0.35)]',
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-black">
              Action required: consultation approval
              {count === 1 ? '' : 's'}
            </div>

            <div className="mt-1 text-[12px] font-semibold opacity-95">
              {count === 1
                ? 'Your pro sent a consultation proposal. Approve or reject to continue.'
                : `You have ${count} consultation proposals waiting. Approve or reject each one.`}
              {props.searchActive ? ' (Search is on — this banner ignores tabs.)' : ''}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(firstHref)}
              className={cn(
                'inline-flex items-center rounded-full border border-bgPrimary/30 bg-bgPrimary px-4 py-2',
                'text-[12px] font-black text-textPrimary transition hover:bg-surfaceGlass',
              )}
            >
              Review now →
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {props.approvals.slice(0, 3).map((booking) => {
            const href = `/client/bookings/${encodeURIComponent(booking.id)}?step=consult`
            const title = bookingTitle(booking)
            const when = prettyWhen(booking.scheduledFor, booking.timeZone)

            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => router.push(href)}
                className={cn(
                  'inline-flex items-center rounded-full border border-bgPrimary/30 bg-bgPrimary/15 px-3 py-1.5',
                  'text-[11px] font-black text-bgPrimary transition hover:bg-bgPrimary/25',
                )}
                title="Open consultation"
              >
                <span className="truncate">
                  {title} · {when}
                </span>
              </button>
            )
          })}

          {props.approvals.length > 3 ? (
            <span className="inline-flex items-center rounded-full border border-bgPrimary/30 bg-bgPrimary/15 px-3 py-1.5 text-[11px] font-black text-bgPrimary">
              +{props.approvals.length - 3} more
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function ClientBookingsDashboard() {
  const [buckets, setBuckets] = useState<ApiBuckets>(EMPTY)
  const [tab, setTab] = useState<TabKey>('upcoming')
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()

  const [recentlyApprovedIds, setRecentlyApprovedIds] = useState<Set<string>>(
    new Set(),
  )
  const [didPickDefaultTab, setDidPickDefaultTab] = useState(false)

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMessage(null)

      const response = await fetch('/api/client/bookings', { cache: 'no-store' })
      const payload: unknown = await response.json().catch(() => ({}))
      const apiResponse: ApiResponse = isRecord(payload) ? payload : {}

      if (!response.ok) {
        throw new Error(apiResponse.error || 'Failed to load bookings.')
      }

      const nextBuckets = normalizeBuckets(apiResponse.buckets)
      setBuckets(nextBuckets)

      const previousPendingIds = loadStringSet('tovis:client:pendingIds')
      const currentPendingIds = new Set(nextBuckets.pending.map((booking) => booking.id))
      const currentUpcomingIds = new Set(
        nextBuckets.upcoming.map((booking) => booking.id),
      )

      const movedToUpcoming = new Set<string>()
      for (const id of previousPendingIds) {
        if (!currentPendingIds.has(id) && currentUpcomingIds.has(id)) {
          movedToUpcoming.add(id)
        }
      }

      setRecentlyApprovedIds(movedToUpcoming)
      saveStringSet('tovis:client:pendingIds', currentPendingIds)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load bookings.'
      setErrorMessage(message)
      setBuckets(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const aftercareBookings = useMemo(() => {
    const completed = buckets.past.filter((booking) => isCompleted(booking))
    const unreadNonCompleted = buckets.past.filter(
      (booking) => Boolean(booking.hasUnreadAftercare) && !isCompleted(booking),
    )

    const seenIds = new Set<string>()
    const merged: BookingLike[] = []

    for (const booking of [...unreadNonCompleted, ...completed]) {
      if (seenIds.has(booking.id)) continue
      seenIds.add(booking.id)
      merged.push(booking)
    }

    return merged
  }, [buckets.past])

  const hasUnreadAftercare = useMemo(() => {
    return aftercareBookings.some((booking) => Boolean(booking.hasUnreadAftercare))
  }, [aftercareBookings])

  const counts = useMemo<Counts>(() => {
    return {
      upcoming: buckets.upcoming.length + buckets.prebooked.length,
      aftercare: aftercareBookings.length,
      pending: buckets.pending.length,
      waitlist: buckets.waitlist.length,
    }
  }, [
    buckets.pending.length,
    buckets.prebooked.length,
    buckets.upcoming.length,
    buckets.waitlist.length,
    aftercareBookings.length,
  ])

  useEffect(() => {
    if (didPickDefaultTab) return
    setTab(hasUnreadAftercare ? 'aftercare' : 'upcoming')
    setDidPickDefaultTab(true)
  }, [didPickDefaultTab, hasUnreadAftercare])

  const upcomingFeed = useMemo(() => {
    return [...buckets.upcoming, ...buckets.prebooked]
  }, [buckets.prebooked, buckets.upcoming])

  const tabBookings = useMemo(() => {
    if (tab === 'upcoming') return upcomingFeed
    if (tab === 'pending') return buckets.pending
    if (tab === 'aftercare') return aftercareBookings
    return []
  }, [aftercareBookings, buckets.pending, tab, upcomingFeed])

  const approvalBookings = useMemo(() => {
    const allBookings = [...upcomingFeed, ...buckets.pending, ...aftercareBookings]
    const seenIds = new Set<string>()
    const approvals: BookingLike[] = []

    for (const booking of allBookings) {
      if (!booking.id || seenIds.has(booking.id)) continue
      seenIds.add(booking.id)

      if (Boolean(booking.hasPendingConsultationApproval)) {
        approvals.push(booking)
      }
    }

    approvals.sort((left, right) => {
      const leftTime = parseTime(left.scheduledFor)
      const rightTime = parseTime(right.scheduledFor)

      if (leftTime === null && rightTime === null) return 0
      if (leftTime === null) return 1
      if (rightTime === null) return -1
      return leftTime - rightTime
    })

    return approvals
  }, [aftercareBookings, buckets.pending, upcomingFeed])

  const searchedResults = useMemo(() => {
    if (!query) return null

    const allBookings = [...upcomingFeed, ...buckets.pending, ...aftercareBookings]
    const seenIds = new Set<string>()
    const filteredBookings: BookingLike[] = []

    for (const booking of allBookings) {
      if (seenIds.has(booking.id)) continue
      seenIds.add(booking.id)

      if (bookingSearchText(booking).includes(query)) {
        filteredBookings.push(booking)
      }
    }

    const filteredWaitlist = buckets.waitlist.filter((waitlist) =>
      waitlistSearchText(waitlist).includes(query),
    )

    return {
      bookings: filteredBookings,
      waitlist: filteredWaitlist,
    }
  }, [aftercareBookings, buckets.pending, buckets.waitlist, query, upcomingFeed])

  if (loading) {
    return (
      <div className="text-[13px] font-semibold text-textSecondary">
        Loading…
      </div>
    )
  }

  if (errorMessage) {
    return (
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary">
        <div className="text-[14px] font-black">Couldn’t load your bookings</div>
        <div className="mt-1 text-[13px] text-textSecondary">{errorMessage}</div>

        <button
          type="button"
          onClick={() => void reload()}
          className={cn(
            'mt-3 inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2',
            'text-[12px] font-black text-textPrimary transition hover:border-white/20',
          )}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <section className="flex h-full flex-col gap-4">
      <TopTabs
        tab={tab}
        setTab={setTab}
        counts={counts}
        hasUnreadAftercare={hasUnreadAftercare}
      />

      <SearchBar
        value={search}
        onChange={setSearch}
        onClear={() => setSearch('')}
      />

      <ConsultationApprovalBanner
        approvals={approvalBookings}
        searchActive={Boolean(query)}
      />

      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div className="text-sm font-black">Last-minute</div>
          <div className="text-xs font-semibold text-textSecondary">
            Next 48 hours · if you’re feeling reckless ✨
          </div>
        </div>
        <LastMinuteOpenings />
      </section>

      <div className="looksNoScrollbar min-h-0 flex-1 overflow-y-auto pb-6">
        {searchedResults ? (
          <div className="grid gap-3">
            <div className="px-0.5 text-[12px] font-semibold text-textSecondary/85">
              {searchedResults.bookings.length + searchedResults.waitlist.length > 0
                ? `Results: ${searchedResults.bookings.length + searchedResults.waitlist.length}`
                : 'No results'}
            </div>

            {searchedResults.bookings.map((booking) => {
              const meta = getBookingCardMeta({
                booking,
                activeTab: null,
                recentlyApprovedIds,
              })

              return (
                <BookingHeroCard
                  key={booking.id}
                  booking={booking}
                  badge={meta.badge}
                  href={meta.href}
                />
              )
            })}

            {searchedResults.waitlist.map((waitlist) => (
              <WaitlistHeroCard key={waitlist.id} waitlist={waitlist} />
            ))}

            {searchedResults.bookings.length === 0 &&
            searchedResults.waitlist.length === 0 ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
                Try searching a service name, your pro, or “pending”.
              </div>
            ) : null}
          </div>
        ) : tab === 'waitlist' ? (
          <div className="grid gap-3">
            {buckets.waitlist.length > 0 ? (
              buckets.waitlist.map((waitlist) => (
                <WaitlistHeroCard key={waitlist.id} waitlist={waitlist} />
              ))
            ) : (
              <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
                No waitlist entries right now.
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {tabBookings.length > 0 ? (
              tabBookings.map((booking) => {
                const meta = getBookingCardMeta({
                  booking,
                  activeTab: tab,
                  recentlyApprovedIds,
                })

                return (
                  <BookingHeroCard
                    key={booking.id}
                    booking={booking}
                    badge={meta.badge}
                    href={meta.href}
                  />
                )
              })
            ) : (
              <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
                {tab === 'upcoming'
                  ? 'No upcoming bookings yet. Go scroll Looks like a responsible adult.'
                  : tab === 'pending'
                    ? 'No pending requests right now.'
                    : 'Nothing here yet.'}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}