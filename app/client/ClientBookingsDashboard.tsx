'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

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

  const prebooked =
    asArray<BookingLike>(b.prebooked).length > 0 ? asArray<BookingLike>(b.prebooked) : asArray<BookingLike>(b.confirmed)

  return { upcoming, pending, waitlist, prebooked, past }
}

function nextStatusBadge(b: BookingLike) {
  const s = statusUpper(b.status)
  if (s === 'ACCEPTED') return <Badge label="Confirmed" bg="#ecfeff" color="#155e75" />
  if (s === 'PENDING') return <Badge label="Requested" bg="#fef9c3" color="#854d0e" />
  if (s === 'COMPLETED') return <Badge label="Completed" bg="#d1fae5" color="#065f46" />
  if (s === 'CANCELLED') return <Badge label="Cancelled" bg="#fee2e2" color="#991b1b" />
  return <Badge label={s || 'Unknown'} bg="#f3f4f6" color="#111827" />
}

export default function ClientBookingsDashboard() {
  const searchParams = useSearchParams()

  const [buckets, setBuckets] = useState<Buckets>(EMPTY_BUCKETS)
  const [tab, setTab] = useState<TabKey>('upcoming')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

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

  // ✅ Deep link: /client?tab=waitlist
  useEffect(() => {
    const t = (searchParams?.get('tab') || '').toLowerCase().trim()
    if (!t) return
    if (t === 'upcoming' || t === 'pending' || t === 'waitlist' || t === 'prebooked' || t === 'past') {
      setTab(t as TabKey)
    }
  }, [searchParams])

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

  if (loading) return <div style={{ color: '#6b7280', fontSize: 13 }}>Loading your bookings…</div>

  if (err) {
    return (
      <div style={{ border: '1px solid #fee2e2', background: '#fff1f2', padding: 14, borderRadius: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Couldn’t load your bookings</div>
        <div style={{ color: '#7f1d1d', fontSize: 13 }}>{err}</div>

        <button
          type="button"
          onClick={reload}
          style={{
            marginTop: 10,
            border: '1px solid #ddd',
            borderRadius: 999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 900,
            background: '#fff',
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
      <div style={{ border: '1px solid #eee', borderRadius: 16, padding: 16, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 900 }}>Next appointment</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {counts.pending ? `${counts.pending} pending request${counts.pending === 1 ? '' : 's'}` : 'All caught up'}
          </div>
        </div>

        {nextAppt ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              {nextAppt.service?.name || 'Appointment'}
              <span style={{ fontSize: 13, fontWeight: 700, color: '#6b7280' }}> · {prettyWhen(nextAppt.scheduledFor)}</span>
            </div>

            <div style={{ color: '#111', fontSize: 13 }}>
              <span style={{ fontWeight: 900 }}>{nextAppt.professional?.businessName || 'Professional'}</span>
              {locationLabel(nextAppt.professional) ? <span style={{ color: '#6b7280' }}> · {locationLabel(nextAppt.professional)}</span> : null}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
              {sourceUpper(nextAppt.source) === 'AFTERCARE' ? <Badge label="Prebooked" bg="#eef2ff" color="#1e3a8a" /> : null}
              {nextStatusBadge(nextAppt)}

              <a
                href={`/api/calendar?bookingId=${encodeURIComponent(nextAppt.id)}`}
                style={{
                  marginLeft: 'auto',
                  textDecoration: 'none',
                  border: '1px solid #ddd',
                  borderRadius: 999,
                  padding: '8px 12px',
                  fontSize: 12,
                  fontWeight: 900,
                  color: '#111',
                  background: '#fff',
                }}
              >
                Add to calendar
              </a>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
            No upcoming appointments yet. Go scroll Looks like a responsible adult.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '8px 12px',
              borderRadius: 999,
              border: '1px solid #ddd',
              background: tab === key ? '#111' : '#fff',
              color: tab === key ? '#fff' : '#111',
              fontSize: 12,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {/* Section container */}
      <div style={{ border: '1px solid #eee', borderRadius: 16, background: '#fff', padding: 14 }}>
        {tab === 'upcoming' ? <UpcomingBookings items={buckets.upcoming} /> : null}
        {tab === 'pending' ? <PendingBookings items={buckets.pending} /> : null}
        {tab === 'waitlist' ? <WaitlistBookings items={buckets.waitlist} onChanged={reload} /> : null}
        {tab === 'prebooked' ? <PrebookedBookings items={buckets.prebooked} /> : null}
        {tab === 'past' ? <PastBookings items={buckets.past} /> : null}

        {tab === 'upcoming' && buckets.upcoming.length === 0 ? <div style={{ color: '#6b7280', fontSize: 13 }}>No upcoming bookings.</div> : null}
        {tab === 'pending' && buckets.pending.length === 0 ? <div style={{ color: '#6b7280', fontSize: 13 }}>No pending requests.</div> : null}
        {tab === 'waitlist' && buckets.waitlist.length === 0 ? <div style={{ color: '#6b7280', fontSize: 13 }}>No waitlist entries.</div> : null}
        {tab === 'prebooked' && buckets.prebooked.length === 0 ? <div style={{ color: '#6b7280', fontSize: 13 }}>No prebooked appointments yet.</div> : null}
        {tab === 'past' && buckets.past.length === 0 ? <div style={{ color: '#6b7280', fontSize: 13 }}>No history yet.</div> : null}
      </div>
    </section>
  )
}
