// app/client/ClientBookingsDashboard.tsx
'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import LastMinuteOpenings from './components/LastMinuteOpenings'

import type { BookingLike, WaitlistLike } from './components/_helpers'
import {
  Badge,
  prettyWhen,
  bookingLocationLabel,
  waitlistLocationLabel,
  statusUpper,
  sourceUpper,
} from './components/_helpers'
import ProProfileLink from './components/ProProfileLink'

type ApiBuckets = {
  upcoming: BookingLike[]
  pending: BookingLike[]
  waitlist: WaitlistLike[]
  prebooked: BookingLike[]
  past: BookingLike[]
}

type TabKey = 'upcoming' | 'aftercare' | 'pending' | 'waitlist'

const EMPTY: ApiBuckets = { upcoming: [], pending: [], waitlist: [], prebooked: [], past: [] }

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function normalizeBuckets(input: unknown): ApiBuckets {
  const b = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    upcoming: asArray<BookingLike>(b.upcoming),
    pending: asArray<BookingLike>(b.pending),
    waitlist: asArray<WaitlistLike>(b.waitlist),
    prebooked: asArray<BookingLike>(b.prebooked).length
      ? asArray<BookingLike>(b.prebooked)
      : asArray<BookingLike>(b.confirmed),
    past: asArray<BookingLike>(b.past),
  }
}

function bookingTitle(b: BookingLike | null | undefined) {
  return b?.display?.title || b?.display?.baseName || 'Appointment'
}

function isPrebookedSource(source: unknown) {
  const s = sourceUpper(source)
  return s === 'AFTERCARE' || s === 'PREBOOKED'
}

function isCompleted(b: BookingLike) {
  // (your API uses COMPLETED; keep it consistent with your helper)
  return statusUpper(b.status) === 'COMPLETED'
}

function firstChar(s: string) {
  return (s || '').trim().charAt(0).toUpperCase()
}

function HeroThumb({ title, subtitle }: { title: string; subtitle?: string | null }) {
  const a = firstChar(title)
  const b = firstChar(subtitle || '') || a

  return (
    <div
      className={cx(
        'relative h-[74px] w-[74px] shrink-0 overflow-hidden rounded-card border border-white/10 bg-bgPrimary'
      )}
    >
      <div className="absolute inset-0 opacity-70 [background:radial-gradient(60px_60px_at_20%_20%,rgba(255,255,255,0.10),transparent_60%),radial-gradient(80px_80px_at_80%_70%,rgba(255,255,255,0.06),transparent_55%)]" />
      <div className="absolute inset-0 bg-surfaceGlass/30" />

      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-baseline gap-1">
          <span className="text-[20px] font-black tracking-tight text-textPrimary">{a}</span>
          <span className="text-[13px] font-black tracking-tight text-textSecondary">{b}</span>
        </div>
      </div>
    </div>
  )
}

function TopTabs({
  tab,
  setTab,
  counts,
  hasUnreadAftercare,
}: {
  tab: TabKey
  setTab: (k: TabKey) => void
  counts: { upcoming: number; aftercare: number; pending: number; waitlist: number }
  hasUnreadAftercare: boolean
}) {
  const items: Array<{ k: TabKey; label: string; count: number; dot?: boolean }> = [
    { k: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { k: 'aftercare', label: 'Aftercare', count: counts.aftercare, dot: hasUnreadAftercare },
    { k: 'pending', label: 'Pending', count: counts.pending, dot: counts.pending > 0 },
    { k: 'waitlist', label: 'Waitlist', count: counts.waitlist },
  ]

  const activeIndex = Math.max(0, items.findIndex((x) => x.k === tab))
  const indicatorStyle: React.CSSProperties = { transform: `translateX(${activeIndex * 100}%)` }

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-xl">
        <div
          className={cx(
            'relative rounded-full border border-white/10 bg-bgSecondary p-1',
            'shadow-[0_10px_30px_rgba(0,0,0,0.35)]'
          )}
        >
          {/* spec highlight */}
          <div className="pointer-events-none absolute inset-0 rounded-full [background:radial-gradient(700px_180px_at_30%_0%,rgba(255,255,255,0.14),transparent_60%)]" />

          {/* sliding active pill */}
          <div className="pointer-events-none absolute inset-y-1 left-1 right-1">
            <div className="relative h-full">
              <div
                style={indicatorStyle}
                className={cx(
                  'absolute left-0 top-0 h-full w-1/4 rounded-full',
                  'border border-white/15 bg-bgPrimary',
                  'shadow-[0_12px_35px_rgba(0,0,0,0.45)]',
                  'transition-transform duration-300 ease-out',
                  '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.10)]'
                )}
              />
            </div>
          </div>

          {/* tabs (centered, one row, no truncation) */}
          <div className="relative flex items-center justify-between">
            {items.map((it) => {
              const active = tab === it.k
              return (
                <button
                  key={it.k}
                  type="button"
                  onClick={() => setTab(it.k)}
                  className={cx(
                    'relative z-10 flex w-1/4 items-center justify-center gap-2',
                    'rounded-full px-3 py-2',
                    'outline-none transition',
                    'focus-visible:ring-2 focus-visible:ring-accentPrimary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bgPrimary',
                    // your note: dim chip border slightly + bump label opacity on inactive tabs
                    active ? 'text-textPrimary' : 'text-textPrimary/90 hover:text-textPrimary',
                    'whitespace-nowrap text-[12px] font-black'
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  {/* dot */}
                  {it.dot ? (
                    <span className="relative inline-flex">
                      <span className="h-1.5 w-1.5 rounded-full bg-accentPrimary" />
                      <span className="absolute -inset-2 rounded-full bg-accentPrimary/15 blur-md" />
                    </span>
                  ) : null}

                  <span
                    className={cx(
                      'transition-opacity',
                      active ? 'opacity-100' : 'opacity-90' // bumped vs previous
                    )}
                  >
                    {it.label}
                  </span>

                  <span
                    className={cx(
                      'inline-flex items-center justify-center rounded-full px-1.5 py-0.5',
                      'text-[11px] font-black leading-none transition',
                      active
                        ? 'border border-white/15 bg-bgSecondary text-textPrimary'
                        : 'border border-white/8 bg-bgPrimary text-textPrimary/85' // dimmer border, clearer label
                    )}
                  >
                    {it.count > 99 ? '99+' : String(it.count)}
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

function SearchBar({
  value,
  onChange,
  onClear,
}: {
  value: string
  onChange: (v: string) => void
  onClear: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="tovis-glass rounded-full border border-white/10 bg-bgSecondary px-3 py-2">
        <div className="flex items-center gap-2">
          {/* input */}
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search your bookings…"
            className={[
              'w-full bg-transparent text-[13px] font-semibold',
              'text-textPrimary placeholder:text-textSecondary/70',
              'outline-none',
            ].join(' ')}
            aria-label="Search bookings"
          />

          {/* clear (only when active) */}
          {value.trim() ? (
            <button
              type="button"
              onClick={onClear}
              className={[
                'rounded-full border border-white/10 bg-bgPrimary px-2.5 py-1',
                'text-[11px] font-black text-textPrimary transition hover:border-white/20',
              ].join(' ')}
            >
              Clear
            </button>
          ) : null}

          {/* search icon on the RIGHT */}
          <span
            className="ml-1 text-[13px] text-textSecondary/80 pointer-events-none"
            aria-hidden
          >
            ⌕
          </span>
        </div>
      </div>
    </div>
  )
}


function BookingHeroCard({
  b,
  badge,
  href,
}: {
  b: BookingLike
  badge?: React.ReactNode
  href: string
}) {
  const router = useRouter()

  const title = bookingTitle(b)
  const when = prettyWhen(b.scheduledFor, b.timeZone)
  const proLabel = b.professional?.businessName || 'Professional'
  const loc = bookingLocationLabel(b)

  const go = () => router.push(href)

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
        }
      }}
      className={cx(
        'group cursor-pointer rounded-card border border-white/10 bg-bgSecondary p-4 transition',
        'hover:border-white/20 hover:bg-surfaceGlass/40',
        'focus-visible:ring-2 focus-visible:ring-accentPrimary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bgPrimary'
      )}
    >
      <div className="flex gap-4">
        <HeroThumb title={title} subtitle={proLabel} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-black text-textPrimary">{title}</div>
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">{when}</div>
            </div>
            <div className="shrink-0">{badge}</div>
          </div>

          <div className="mt-2 text-[13px] text-textPrimary">
            <span
              className="font-black"
              onClick={(e) => {
                // allow clicking pro link without triggering card navigation
                e.stopPropagation()
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <ProProfileLink proId={b.professional?.id ?? null} label={proLabel} className="text-textPrimary" />
            </span>
            {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isPrebookedSource(b.source) ? <Badge label="Prebooked" variant="default" /> : null}
            {b.hasUnreadAftercare ? <Badge label="New aftercare" variant="accent" /> : null}
            {b.hasPendingConsultationApproval ? <Badge label="Action required" variant="accent" /> : null}

            <span className="ml-auto text-[12px] font-black text-textPrimary transition group-hover:translate-x-0.5">
              View →
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function WaitlistHeroCard({ w }: { w: WaitlistLike }) {
  const svc = w.service?.name || 'Service'
  const pro = w.professional?.businessName || 'Professional'
  const loc = waitlistLocationLabel(w.professional)

  return (
    <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="flex gap-4">
        <HeroThumb title={svc} subtitle={pro} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-black text-textPrimary">{svc}</div>
              <div className="mt-1 text-[12px] font-semibold text-textSecondary">Waitlist entry</div>
            </div>
            <Badge label="Watching" variant="default" />
          </div>

          <div className="mt-2 text-[13px] text-textPrimary">
            <span className="font-black text-textPrimary">{pro}</span>
            {loc ? <span className="text-textSecondary"> · {loc}</span> : null}
          </div>

          {w.notes ? <div className="mt-2 line-clamp-2 text-[12px] font-semibold text-textSecondary">{w.notes}</div> : null}
        </div>
      </div>
    </div>
  )
}

function loadStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    if (Array.isArray(arr)) return new Set(arr.map((x) => String(x)))
    return new Set()
  } catch {
    return new Set()
  }
}

function saveStringSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)))
  } catch {
    // ignore
  }
}

function bookingSearchText(b: BookingLike) {
  const parts = [
    bookingTitle(b),
    b.professional?.businessName || '',
    bookingLocationLabel(b),
    statusUpper(b.status),
    sourceUpper(b.source),
    // optional: any display crumbs you might have
    b.display?.baseName || '',
    b.display?.title || '',
  ]
  return parts.join(' ').toLowerCase()
}

function waitlistSearchText(w: WaitlistLike) {
  const parts = [
    w.service?.name || '',
    w.professional?.businessName || '',
    waitlistLocationLabel(w.professional),
    w.notes || '',
    'waitlist',
  ]
  return parts.join(' ').toLowerCase()
}

export default function ClientBookingsDashboard() {
  const [buckets, setBuckets] = useState<ApiBuckets>(EMPTY)
  const [tab, setTab] = useState<TabKey>('upcoming')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()

  const [recentlyApprovedIds, setRecentlyApprovedIds] = useState<Set<string>>(new Set())
  const [didPickDefaultTab, setDidPickDefaultTab] = useState(false)

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setErr(null)

      const res = await fetch('/api/client/bookings', { cache: 'no-store' })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to load bookings.')

      const next = normalizeBuckets(data?.buckets)
      setBuckets(next)

      // recently approved: pending -> upcoming
      const prevPending = loadStringSet('tovis:client:pendingIds')
      const nowPending = new Set(next.pending.map((b) => b.id))
      const nowUpcomingIds = new Set(next.upcoming.map((b) => b.id))

      const moved = new Set<string>()
      for (const id of prevPending) {
        if (!nowPending.has(id) && nowUpcomingIds.has(id)) moved.add(id)
      }

      setRecentlyApprovedIds(moved)
      saveStringSet('tovis:client:pendingIds', nowPending)
    } catch (e: any) {
      setErr(e?.message || 'Failed to load bookings.')
      setBuckets(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const aftercareBookings = useMemo(() => {
    const past = buckets.past || []
    const completed = past.filter((b) => isCompleted(b))
    const unread = past.filter((b) => Boolean(b.hasUnreadAftercare) && !isCompleted(b))

    const seen = new Set<string>()
    const merged: BookingLike[] = []
    for (const b of [...unread, ...completed]) {
      if (seen.has(b.id)) continue
      seen.add(b.id)
      merged.push(b)
    }
    return merged
  }, [buckets.past])

  const hasUnreadAftercare = useMemo(
    () => aftercareBookings.some((b) => Boolean(b.hasUnreadAftercare)),
    [aftercareBookings]
  )

  const counts = useMemo(() => {
    return {
      upcoming: buckets.upcoming.length + buckets.prebooked.length,
      aftercare: aftercareBookings.length,
      pending: buckets.pending.length,
      waitlist: buckets.waitlist.length,
    }
  }, [
    buckets.upcoming.length,
    buckets.prebooked.length,
    aftercareBookings.length,
    buckets.pending.length,
    buckets.waitlist.length,
  ])

  useEffect(() => {
    if (didPickDefaultTab) return
    setTab(hasUnreadAftercare ? 'aftercare' : 'upcoming')
    setDidPickDefaultTab(true)
  }, [hasUnreadAftercare, didPickDefaultTab])

  const upcomingFeed = useMemo(
    () => [...buckets.upcoming, ...buckets.prebooked],
    [buckets.upcoming, buckets.prebooked]
  )

  const tabBookings = useMemo(() => {
    if (tab === 'upcoming') return upcomingFeed
    if (tab === 'pending') return buckets.pending
    if (tab === 'aftercare') return aftercareBookings
    return []
  }, [tab, upcomingFeed, buckets.pending, aftercareBookings])

  // ✅ Global search across ALL buckets (not just the selected tab)
  const searchedBookings = useMemo(() => {
    if (!q) return null

    const allBookings: Array<{ kind: 'booking'; item: BookingLike }> = [
      ...upcomingFeed.map((b) => ({ kind: 'booking' as const, item: b })),
      ...buckets.pending.map((b) => ({ kind: 'booking' as const, item: b })),
      ...aftercareBookings.map((b) => ({ kind: 'booking' as const, item: b })),
    ]

    // de-dupe by id (since a booking could appear in multiple derived lists)
    const seen = new Set<string>()
    const filteredBookings: BookingLike[] = []
    for (const row of allBookings) {
      const b = row.item
      if (seen.has(b.id)) continue
      seen.add(b.id)
      if (bookingSearchText(b).includes(q)) filteredBookings.push(b)
    }

    const filteredWaitlist = buckets.waitlist.filter((w) => waitlistSearchText(w).includes(q))

    return { bookings: filteredBookings, waitlist: filteredWaitlist }
  }, [q, upcomingFeed, buckets.pending, aftercareBookings, buckets.waitlist])

  if (loading) return <div className="text-[13px] font-semibold text-textSecondary">Loading…</div>

  if (err) {
    return (
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary">
        <div className="text-[14px] font-black">Couldn’t load your bookings</div>
        <div className="mt-1 text-[13px] text-textSecondary">{err}</div>

        <button
          type="button"
          onClick={reload}
          className={cx(
            'mt-3 inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2',
            'text-[12px] font-black text-textPrimary transition hover:border-white/20'
          )}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <section className="flex h-full flex-col gap-4">
      {/* fixed: tabs */}
      <TopTabs tab={tab} setTab={setTab} counts={counts} hasUnreadAftercare={hasUnreadAftercare} />

      {/* fixed: search (replaces helper line) */}
      <SearchBar value={search} onChange={setSearch} onClear={() => setSearch('')} />

      {/* fixed: last-minute */}
      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div className="text-sm font-black">Last-minute</div>
          <div className="text-xs font-semibold text-textSecondary">Next 48 hours · if you’re feeling reckless ✨</div>
        </div>
        <LastMinuteOpenings />
      </section>

      {/* scroll: hero feed ONLY */}
      <div className="min-h-0 flex-1 overflow-y-auto looksNoScrollbar pb-6">
        {/* If searching, show global results across everything */}
        {searchedBookings ? (
          <div className="grid gap-3">
            <div className="px-0.5 text-[12px] font-semibold text-textSecondary/85">
              {searchedBookings.bookings.length + searchedBookings.waitlist.length > 0
                ? `Results: ${searchedBookings.bookings.length + searchedBookings.waitlist.length}`
                : 'No results'}
            </div>

            {searchedBookings.bookings.map((b) => {
              const status = statusUpper(b.status)
              const recentlyApproved = recentlyApprovedIds.has(b.id)

              const href =
                b.hasPendingConsultationApproval
                  ? `/client/bookings/${encodeURIComponent(b.id)}?step=consult`
                  : b.hasUnreadAftercare || isCompleted(b)
                    ? `/client/bookings/${encodeURIComponent(b.id)}?step=aftercare`
                    : `/client/bookings/${encodeURIComponent(b.id)}?step=overview`

              let badge: React.ReactNode = null
              if (recentlyApproved) badge = <Badge label="Recently approved" variant="success" />
              else if (b.hasPendingConsultationApproval) badge = <Badge label="Action required" variant="accent" />
              else if (status === 'PENDING') badge = <Badge label="Requested" variant="accent" />
              else if (status === 'ACCEPTED') badge = <Badge label="Confirmed" variant="success" />
              else if (status === 'COMPLETED') badge = <Badge label="Completed" variant="default" />

              return <BookingHeroCard key={b.id} b={b} badge={badge} href={href} />
            })}

            {searchedBookings.waitlist.map((w) => (
              <WaitlistHeroCard key={w.id} w={w} />
            ))}

            {searchedBookings.bookings.length === 0 && searchedBookings.waitlist.length === 0 ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
                Try searching a service name, your pro, or “pending”.
              </div>
            ) : null}
          </div>
        ) : tab === 'waitlist' ? (
          <div className="grid gap-3">
            {buckets.waitlist.length ? (
              buckets.waitlist.map((w) => <WaitlistHeroCard key={w.id} w={w} />)
            ) : (
              <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
                No waitlist entries right now.
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {tabBookings.length ? (
              tabBookings.map((b) => {
                const status = statusUpper(b.status)
                const recentlyApproved = recentlyApprovedIds.has(b.id)

                const href =
                  tab === 'aftercare'
                    ? `/client/bookings/${encodeURIComponent(b.id)}?step=aftercare`
                    : b.hasPendingConsultationApproval
                      ? `/client/bookings/${encodeURIComponent(b.id)}?step=consult`
                      : `/client/bookings/${encodeURIComponent(b.id)}?step=overview`

                let badge: React.ReactNode = null
                if (recentlyApproved) badge = <Badge label="Recently approved" variant="success" />
                else if (b.hasPendingConsultationApproval) badge = <Badge label="Action required" variant="accent" />
                else if (status === 'PENDING') badge = <Badge label="Requested" variant="accent" />
                else if (status === 'ACCEPTED') badge = <Badge label="Confirmed" variant="success" />
                else if (status === 'COMPLETED') badge = <Badge label="Completed" variant="default" />

                return <BookingHeroCard key={b.id} b={b} badge={badge} href={href} />
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
