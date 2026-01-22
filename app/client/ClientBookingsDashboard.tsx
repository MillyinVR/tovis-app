// app/client/ClientBookingsDashboard.tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import UpcomingBookings from './components/UpcomingBookings'
import PendingBookings from './components/PendingBookings'
import WaitlistBookings from './components/WaitlistBookings'
import PrebookedBookings from './components/PrebookedBookings'
import PastBookings from './components/PastBookings'

import type { BookingLike, WaitlistLike } from './components/_helpers'
import { Badge, prettyWhen, locationLabel, sourceUpper, statusUpper } from './components/_helpers'

type Buckets = {
  upcoming: BookingLike[]
  pending: BookingLike[]
  waitlist: WaitlistLike[]
  prebooked: BookingLike[]
  past: BookingLike[]
}

type TabKey = keyof Buckets

const EMPTY_BUCKETS: Buckets = {
  upcoming: [],
  pending: [],
  waitlist: [],
  prebooked: [],
  past: [],
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'pending', label: 'Pending' },
  { key: 'waitlist', label: 'Waitlist' },
  { key: 'prebooked', label: 'Prebooked' },
  { key: 'past', label: 'Past' },
]

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function normalizeBuckets(input: unknown): Buckets {
  const b = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  const upcoming = asArray<BookingLike>(b.upcoming)
  const pending = asArray<BookingLike>(b.pending)
  const waitlist = asArray<WaitlistLike>(b.waitlist)
  const past = asArray<BookingLike>(b.past)

  // Backward compat: older code used buckets.confirmed
  const prebooked = asArray<BookingLike>(b.prebooked).length ? asArray<BookingLike>(b.prebooked) : asArray<BookingLike>(b.confirmed)

  return { upcoming, pending, waitlist, prebooked, past }
}

function normalizeTabKey(raw: string): TabKey | null {
  const t = raw.toLowerCase().trim()
  if (t === 'upcoming' || t === 'pending' || t === 'waitlist' || t === 'prebooked' || t === 'past') return t
  return null
}

type BadgeVariant = 'default' | 'danger' | 'accent' | 'success'

function badgeForStatus(b: BookingLike): { label: string; variant: BadgeVariant } {
  const s = statusUpper(b.status)

  if (s === 'ACCEPTED') return { label: 'Confirmed', variant: 'success' }
  if (s === 'PENDING') return { label: 'Requested', variant: 'accent' }
  if (s === 'COMPLETED') return { label: 'Completed', variant: 'default' }
  if (s === 'CANCELLED') return { label: 'Cancelled', variant: 'danger' }

  return { label: s || 'Unknown', variant: 'default' }
}

function isPrebookedSource(source: unknown) {
  // You mentioned Option 2 / no legacy users, so this can be strict.
  // Keeping AFTERCARE because your code already uses it.
  const s = sourceUpper(source)
  return s === 'AFTERCARE' || s === 'PREBOOKED'
}

export default function ClientBookingsDashboard() {
  const searchParams = useSearchParams()
  const tabParam = searchParams?.get('tab') || ''

  const [buckets, setBuckets] = useState<Buckets>(EMPTY_BUCKETS)
  const [tab, setTab] = useState<TabKey>('upcoming')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // Apply deep link once, then stop overriding user clicks.
  const [didInitTab, setDidInitTab] = useState(false)

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setErr(null)

      const res = await fetch('/api/client/bookings', { cache: 'no-store' })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to load bookings.')

      setBuckets(normalizeBuckets(data?.buckets))
    } catch (e: any) {
      setErr(e?.message || 'Failed to load bookings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (didInitTab) return
    const parsed = normalizeTabKey(tabParam)
    if (parsed) setTab(parsed)
    setDidInitTab(true)
  }, [tabParam, didInitTab])

  const counts = useMemo(() => {
    return {
      upcoming: buckets.upcoming.length,
      pending: buckets.pending.length,
      waitlist: buckets.waitlist.length,
      prebooked: buckets.prebooked.length,
      past: buckets.past.length,
    }
  }, [buckets])

  const nextAppt = useMemo<BookingLike | null>(() => {
    return buckets.upcoming.length ? buckets.upcoming[0] : null
  }, [buckets.upcoming])

  // If any booking requires consult approval, we surface a "Action required" CTA in the Next card
  const nextNeedsConsultApproval = Boolean(nextAppt?.hasPendingConsultationApproval)

  if (loading) return <div className="text-textSecondary" style={{ fontSize: 13 }}>Loading your bookings…</div>

  if (err) {
    return (
      <div className="border border-surfaceGlass/10 bg-bgSecondary text-textPrimary" style={{ padding: 14, borderRadius: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Couldn’t load your bookings</div>
        <div className="text-textSecondary" style={{ fontSize: 13 }}>{err}</div>

        <button
          type="button"
          onClick={reload}
          className="border border-surfaceGlass/15 bg-bgPrimary text-textPrimary"
          style={{
            marginTop: 10,
            borderRadius: 999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 900,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      {/* Next appointment card */}
      <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div className="text-textSecondary" style={{ fontSize: 13, fontWeight: 900 }}>
            Next appointment
          </div>
          <div className="text-textSecondary" style={{ fontSize: 12 }}>
            {counts.pending ? `${counts.pending} pending item${counts.pending === 1 ? '' : 's'}` : 'All caught up'}
          </div>
        </div>

        {nextAppt ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <div className="text-textPrimary" style={{ fontSize: 18, fontWeight: 900 }}>
              {nextAppt.service?.name || 'Appointment'}
              <span className="text-textSecondary" style={{ fontSize: 13, fontWeight: 700 }}>
                {' '}
                · {prettyWhen(nextAppt.scheduledFor)}
              </span>
            </div>

            <div className="text-textPrimary" style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 900 }}>{nextAppt.professional?.businessName || 'Professional'}</span>
              {locationLabel(nextAppt.professional) ? (
                <span className="text-textSecondary"> · {locationLabel(nextAppt.professional)}</span>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
              {isPrebookedSource(nextAppt.source) ? (
                <Badge label="Prebooked" variant="default" />
              ) : null}

              {nextNeedsConsultApproval ? (
                <Badge label="Action required" variant="accent" />
              ) : null}

              {(() => {
                const s = badgeForStatus(nextAppt)
                return <Badge label={s.label} variant={s.variant} />
              })()}

              {nextNeedsConsultApproval ? (
                <a
                  href={`/client/bookings/${encodeURIComponent(nextAppt.id)}?step=consult`}
                  className="bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover"
                  style={{
                    marginLeft: 'auto',
                    textDecoration: 'none',
                    borderRadius: 999,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  Review &amp; approve
                </a>
              ) : (
                <a
                  href={`/api/calendar?bookingId=${encodeURIComponent(nextAppt.id)}`}
                  className="border border-surfaceGlass/15 bg-bgPrimary text-textPrimary"
                  style={{
                    marginLeft: 'auto',
                    textDecoration: 'none',
                    borderRadius: 999,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  Add to calendar
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="text-textSecondary" style={{ marginTop: 10, fontSize: 13 }}>
            No upcoming appointments yet. Go scroll Looks like a responsible adult.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(({ key, label }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                active
                  ? 'bg-accentPrimary text-bgPrimary'
                  : 'border border-surfaceGlass/15 bg-bgPrimary text-textPrimary'
              }
              style={{
                padding: '8px 12px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {label} ({counts[key]})
            </button>
          )
        })}
      </div>

      {/* Section container */}
      <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ borderRadius: 16, padding: 14 }}>
        {tab === 'upcoming' ? <UpcomingBookings items={buckets.upcoming} /> : null}

        {/* pending needs reload after approve/reject */}
        {tab === 'pending' ? <PendingBookings items={buckets.pending} onChanged={reload} /> : null}

        {tab === 'waitlist' ? <WaitlistBookings items={buckets.waitlist} onChanged={reload} /> : null}
        {tab === 'prebooked' ? <PrebookedBookings items={buckets.prebooked} /> : null}
        {tab === 'past' ? <PastBookings items={buckets.past} /> : null}

        {tab === 'upcoming' && buckets.upcoming.length === 0 ? (
          <div className="text-textSecondary" style={{ fontSize: 13 }}>No upcoming bookings.</div>
        ) : null}
        {tab === 'pending' && buckets.pending.length === 0 ? (
          <div className="text-textSecondary" style={{ fontSize: 13 }}>No pending items.</div>
        ) : null}
        {tab === 'waitlist' && buckets.waitlist.length === 0 ? (
          <div className="text-textSecondary" style={{ fontSize: 13 }}>No waitlist entries.</div>
        ) : null}
        {tab === 'prebooked' && buckets.prebooked.length === 0 ? (
          <div className="text-textSecondary" style={{ fontSize: 13 }}>No prebooked appointments yet.</div>
        ) : null}
        {tab === 'past' && buckets.past.length === 0 ? (
          <div className="text-textSecondary" style={{ fontSize: 13 }}>No history yet.</div>
        ) : null}
      </div>
    </section>
  )
}
