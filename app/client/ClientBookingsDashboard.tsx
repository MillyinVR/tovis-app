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

type NotificationSummary = {
  upcomingUnreadCount: number
  aftercareUnreadCount: number
  pendingUnreadCount: number
  hasAnyUnreadUpdates: boolean
}

type CardMeta = {
  href: string
  badge: React.ReactNode
  badgeKey:
    | 'none'
    | 'recentlyApproved'
    | 'actionRequired'
    | 'newAftercare'
    | 'requested'
    | 'confirmed'
    | 'completed'
}

const EMPTY: ApiBuckets = {
  upcoming: [],
  pending: [],
  waitlist: [],
  prebooked: [],
  past: [],
}

const EMPTY_NOTIFICATION_SUMMARY: NotificationSummary = {
  upcomingUnreadCount: 0,
  aftercareUnreadCount: 0,
  pendingUnreadCount: 0,
  hasAnyUnreadUpdates: false,
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
  let badgeKey: CardMeta['badgeKey'] = 'none'

  if (recentlyApproved) {
    badgeKey = 'recentlyApproved'
    badge = <Badge label="Recently approved" variant="success" />
  } else if (booking.hasPendingConsultationApproval) {
    badgeKey = 'actionRequired'
    badge = <Badge label="Action required" variant="accent" />
  } else if (booking.hasUnreadAftercare) {
    badgeKey = 'newAftercare'
    badge = <Badge label="New aftercare" variant="accent" />
  } else if (status === 'PENDING') {
    badgeKey = 'requested'
    badge = <Badge label="Requested" variant="accent" />
  } else if (status === 'ACCEPTED') {
    badgeKey = 'confirmed'
    badge = <Badge label="Confirmed" variant="success" />
  } else if (status === 'COMPLETED') {
    badgeKey = 'completed'
    badge = <Badge label="Completed" variant="default" />
  }

  return { href, badge, badgeKey }
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
  upcomingUnreadCount: number
  aftercareUnreadCount: number
  pendingUnreadCount: number
}) {
  const items: Array<{ k: TabKey; label: string; count: number; dot?: boolean }> =
    [
      {
        k: 'upcoming',
        label: 'Upcoming',
        count: props.counts.upcoming,
        dot: props.upcomingUnreadCount > 0,
      },
      {
        k: 'aftercare',
        label: 'Aftercare',
        count: props.counts.aftercare,
        dot: props.aftercareUnreadCount > 0,
      },
      {
        k: 'pending',
        label: 'Pending',
        count: props.counts.pending,
        dot: props.pendingUnreadCount > 0,
      },
      {
        k: 'waitlist',
        label: 'Waitlist',
        count: props.counts.waitlist,
      },
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
  badgeKey: CardMeta['badgeKey']
  href: string
}) {
  const router = useRouter()

  const title = bookingTitle(props.booking)
  const when = prettyWhen(props.booking.scheduledFor, props.booking.timeZone)
  const proLabel = props.booking.professional?.businessName || 'Professional'
  const location = bookingLocationLabel(props.booking)

  const showPrebookedBadge = isPrebookedSource(props.booking.source)
  const showAftercareBadge =
    props.booking.hasUnreadAftercare && props.badgeKey !== 'newAftercare'
  const showActionRequiredBadge =
    props.booking.hasPendingConsultationApproval &&
    props.badgeKey !== 'actionRequired'

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
            {showPrebookedBadge ? (
              <Badge label="Prebooked" variant="default" />
            ) : null}

            {showAftercareBadge ? (
              <Badge label="New aftercare" variant="accent" />
            ) : null}

            {showActionRequiredBadge ? (
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

function formatUpcomingDate(scheduledFor: string, timeZone: string | null): string {
  const d = new Date(scheduledFor)
  if (isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(d).toUpperCase()
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(d).toUpperCase()
  }
}

function formatUpcomingTime(scheduledFor: string, timeZone: string | null): string {
  const d = new Date(scheduledFor)
  if (isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d).toLowerCase()
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(d).toLowerCase()
  }
}

function parsePrice(raw: string | null | undefined): string | null {
  if (!raw) return null
  const n = parseFloat(raw)
  if (isNaN(n)) return null
  return `$${Math.round(n)}`
}

export default function ClientBookingsDashboard({
  displayName,
  handle,
  avatarUrl,
  memberSince,
}: {
  displayName: string
  handle: string
  avatarUrl?: string | null
  memberSince?: string | null
}) {
  const [buckets, setBuckets] = useState<ApiBuckets>(EMPTY)
  const [tab, setTab] = useState<TabKey>('upcoming')
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()

  const [recentlyApprovedIds, setRecentlyApprovedIds] = useState<Set<string>>(
    new Set(),
  )
  const [notificationSummary, setNotificationSummary] =
    useState<NotificationSummary>(EMPTY_NOTIFICATION_SUMMARY)
  const [didPickDefaultTab, setDidPickDefaultTab] = useState(false)
  const [meTab, setMeTab] = useState<'boards' | 'following' | 'history'>('history')
  const router = useRouter()

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setErrorMessage(null)

      const [bookingsResponse, notificationsResponse] = await Promise.all([
        fetch('/api/client/bookings', { cache: 'no-store' }),
        fetch('/api/client/notifications/summary', { cache: 'no-store' }),
      ])

      const bookingsPayload: unknown = await bookingsResponse.json().catch(() => ({}))
      const bookingsApiResponse: ApiResponse = isRecord(bookingsPayload)
        ? bookingsPayload
        : {}

      if (!bookingsResponse.ok) {
        throw new Error(bookingsApiResponse.error || 'Failed to load bookings.')
      }

      const notificationsPayload: unknown = await notificationsResponse
        .json()
        .catch(() => ({}))

      const notificationsData =
        isRecord(notificationsPayload) &&
        isRecord((notificationsPayload as { data?: unknown }).data)
          ? ((notificationsPayload as { data: NotificationSummary }).data ??
            EMPTY_NOTIFICATION_SUMMARY)
          : EMPTY_NOTIFICATION_SUMMARY

      const nextBuckets = normalizeBuckets(bookingsApiResponse.buckets)
      setBuckets(nextBuckets)

      setNotificationSummary({
        upcomingUnreadCount:
          typeof notificationsData.upcomingUnreadCount === 'number'
            ? notificationsData.upcomingUnreadCount
            : 0,
        aftercareUnreadCount:
          typeof notificationsData.aftercareUnreadCount === 'number'
            ? notificationsData.aftercareUnreadCount
            : 0,
        pendingUnreadCount:
          typeof notificationsData.pendingUnreadCount === 'number'
            ? notificationsData.pendingUnreadCount
            : 0,
        hasAnyUnreadUpdates:
          typeof notificationsData.hasAnyUnreadUpdates === 'boolean'
            ? notificationsData.hasAnyUnreadUpdates
            : false,
      })

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
      setNotificationSummary(EMPTY_NOTIFICATION_SUMMARY)
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

  const hasUnreadAftercare = notificationSummary.aftercareUnreadCount > 0
  const hasUnreadPending = notificationSummary.pendingUnreadCount > 0
  const hasUnreadUpcoming = notificationSummary.upcomingUnreadCount > 0

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

  if (hasUnreadPending) {
    setTab('pending')
  } else if (hasUnreadAftercare) {
    setTab('aftercare')
  } else if (hasUnreadUpcoming) {
    setTab('upcoming')
  } else {
    setTab('upcoming')
  }

  setDidPickDefaultTab(true)
}, [
  didPickDefaultTab,
  hasUnreadPending,
  hasUnreadAftercare,
  hasUnreadUpcoming,
])

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
        <div className="text-[14px] font-black">Couldn't load your bookings</div>
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="looksNoScrollbar flex-1 overflow-y-auto">

        {/* ── Profile header ── */}
        <div className="px-5 pb-5 pt-12">
          <div className="mb-5 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-widest text-textMuted">
              @{handle}
            </span>
            <button
              type="button"
              aria-label="Share profile"
              className="text-textMuted"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-white/10 bg-bgSecondary">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-bgSurface to-bgSecondary">
                  <span className="font-display italic text-[28px] font-semibold leading-none text-accentPrimary">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="font-display italic text-[26px] font-semibold leading-tight tracking-tight text-textPrimary">
                {displayName}
              </div>
              {memberSince ? (
                <div className="mt-1 text-[12px] text-textSecondary">
                  Joined {memberSince}
                </div>
              ) : null}
              <div className="mt-3 flex gap-[18px]">
                {[
                  { label: 'BOARDS', value: '0' },
                  { label: 'SAVED',  value: '0' },
                  { label: 'BOOKED', value: String(buckets.past.length) },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <div className="text-[16px] font-bold text-textPrimary">{value}</div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-textMuted">
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Upcoming mini-card ── */}
        {(() => {
          const next = buckets.upcoming[0]
          if (!next) return null
          return (
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/client/bookings/${encodeURIComponent(next.id)}?step=overview`,
                )
              }
              className="mx-5 mb-5 w-[calc(100%-2.5rem)] rounded-card border border-accentPrimary/25 bg-accentPrimary/5 p-3.5 text-left"
            >
              <div className="mb-2 font-mono text-[9px] uppercase tracking-widest text-accentPrimaryHover">
                ◆ UPCOMING · {formatUpcomingDate(next.scheduledFor, next.timeZone)}
              </div>
              <div className="flex items-center gap-3">
                <HeroThumb
                  title={bookingTitle(next)}
                  subtitle={next.professional?.businessName ?? null}
                />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-bold text-textPrimary">
                    {bookingTitle(next)}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-textSecondary">
                    {[
                      next.professional?.businessName,
                      formatUpcomingTime(next.scheduledFor, next.timeZone),
                      parsePrice(next.subtotalSnapshot ?? next.checkout?.totalAmount),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
            </button>
          )
        })()}

        {/* ── Tabs ── */}
        <div className="flex gap-6 border-b border-white/10 px-5">
          {(['boards', 'following', 'history'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setMeTab(t)}
              className={cn(
                '-mb-px pb-3 pt-1 text-[13px] font-bold capitalize transition',
                meTab === t
                  ? 'border-b-2 border-[rgb(var(--accent-primary))] text-textPrimary'
                  : 'border-b-2 border-transparent text-textMuted hover:text-textSecondary',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="px-5 pb-24 pt-4">

          {meTab === 'boards' && (
            <div>
              <button
                type="button"
                className="mb-3 flex w-full items-center gap-2 rounded-card border border-dashed border-white/[0.16] p-3.5 text-[13px] text-textMuted"
              >
                <span className="text-[18px] leading-none">+</span>
                Create new board
              </button>
              <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-8 text-center text-[13px] text-textMuted">
                Save looks to boards from the feed
              </div>
            </div>
          )}

          {meTab === 'following' && (
            <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-8 text-center text-[13px] text-textMuted">
              Pros you follow will appear here.{' '}
              <span className="font-semibold text-textSecondary">
                Discover them on the Looks feed.
              </span>
            </div>
          )}

          {meTab === 'history' && (
            buckets.past.length === 0 && buckets.prebooked.length === 0 ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary px-4 py-8 text-center text-[13px] text-textMuted">
                No history yet — your completed bookings will appear here.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-0.5">
                {[
                  ...buckets.past.map((b) => ({ booking: b, label: 'BOOKED' as const })),
                  ...buckets.prebooked.map((b) => ({ booking: b, label: 'UPCOMING' as const })),
                ].map(({ booking, label }) => {
                  const title = bookingTitle(booking)
                  const href = `/client/bookings/${encodeURIComponent(booking.id)}?step=${label === 'UPCOMING' ? 'overview' : 'aftercare'}`
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      onClick={() => router.push(href)}
                      className="relative overflow-hidden bg-bgSecondary"
                      style={{ aspectRatio: '3 / 4' }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-bgSurface to-bgPrimary" />
                      <div className="absolute inset-0 grid place-items-center">
                        <span className="font-display italic text-[36px] font-semibold text-textMuted/30">
                          {title.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bgPrimary/90 to-transparent" />
                      <div className="absolute bottom-1.5 left-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-textPrimary">
                        {label}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}

        </div>
      </div>
    </div>
  )
}