// app/client/bookings/page.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

type BookingStatus = 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | string
type BookingSource = 'REQUESTED' | 'DISCOVERY' | 'AFTERCARE' | string

type BookingCard = {
  id: string
  status: BookingStatus
  source?: BookingSource
  scheduledFor: string
  durationMinutesSnapshot?: number | null
  priceSnapshot?: any

  service?: { id: string; name: string } | null
  professional?: {
    id: string
    businessName?: string | null
    location?: string | null
    city?: string | null
    state?: string | null
  } | null
}

type WaitlistCard = {
  id: string
  createdAt: string
  notes?: string | null
  availability?: any
  service?: { id: string; name: string } | null
  professional?: {
    id: string
    businessName?: string | null
    location?: string | null
    city?: string | null
    state?: string | null
  } | null
}

type Buckets = {
  upcoming: BookingCard[]
  pending: BookingCard[]
  waitlist: WaitlistCard[]
  prebooked: BookingCard[]
  past: BookingCard[]
}

function prettyDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function proLabel(p?: BookingCard['professional'] | WaitlistCard['professional']) {
  if (!p) return 'Professional'
  return p.businessName || [p.city, p.state].filter(Boolean).join(', ') || 'Professional'
}

function whereLabel(p?: BookingCard['professional'] | WaitlistCard['professional']) {
  if (!p) return ''
  return p.location || [p.city, p.state].filter(Boolean).join(', ')
}

const TABS = ['Upcoming', 'Pending', 'Waitlist', 'Pre-booked', 'Past'] as const
type Tab = (typeof TABS)[number]

export default function ClientBookingsPage() {
  const [tab, setTab] = useState<Tab>('Upcoming')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buckets, setBuckets] = useState<Buckets>({
    upcoming: [],
    pending: [],
    waitlist: [],
    prebooked: [],
    past: [],
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        const res = await fetch('/api/client/bookings', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          setError(data?.error || 'Failed to load bookings.')
          return
        }

        if (!cancelled) {
          setBuckets(data?.buckets || buckets)
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) setError('Network error loading bookings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentList = useMemo(() => {
    switch (tab) {
      case 'Upcoming':
        return buckets.upcoming
      case 'Pending':
        return buckets.pending
      case 'Waitlist':
        return buckets.waitlist
      case 'Pre-booked':
        return buckets.prebooked
      case 'Past':
        return buckets.past
      default:
        return buckets.upcoming
    }
  }, [tab, buckets])

  const counts = useMemo(() => {
    return {
      Upcoming: buckets.upcoming.length,
      Pending: buckets.pending.length,
      Waitlist: buckets.waitlist.length,
      'Pre-booked': buckets.prebooked.length,
      Past: buckets.past.length,
    } as Record<Tab, number>
  }, [buckets])

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>My bookings</h1>
          <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: '#6b7280' }}>
            Upcoming, pending requests, waitlists, and everything you “definitely didn’t forget.”
          </p>
        </div>

        <a href="/looks" style={{ fontSize: 13, textDecoration: 'none', color: '#111', fontWeight: 800 }}>
          + Book something
        </a>
      </header>

      {/* Tabs */}
      <section
        style={{
          marginTop: 16,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          border: '1px solid #eee',
          padding: 10,
          borderRadius: 14,
          background: '#fff',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '8px 12px',
              borderRadius: 999,
              border: '1px solid #ddd',
              background: tab === t ? '#111' : '#f9f9f9',
              color: tab === t ? '#fff' : '#111',
              fontSize: 12,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            {t} {counts[t] ? `(${counts[t]})` : ''}
          </button>
        ))}
      </section>

      {/* Content */}
      <section style={{ marginTop: 14 }}>
        {loading ? (
          <div style={{ fontSize: 13, color: '#6b7280' }}>Loading…</div>
        ) : error ? (
          <div style={{ fontSize: 13, color: '#b91c1c' }}>{error}</div>
        ) : currentList.length === 0 ? (
          <div
            style={{
              border: '1px solid #eee',
              borderRadius: 14,
              padding: 16,
              background: '#fff',
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 14 }}>
              {tab === 'Upcoming'
                ? 'Nothing scheduled yet.'
                : tab === 'Pending'
                ? 'No pending requests.'
                : tab === 'Waitlist'
                ? 'No waitlists right now.'
                : tab === 'Pre-booked'
                ? 'No pre-booked appointments.'
                : 'Nothing here yet.'}
            </div>

            <div style={{ marginTop: 6, fontSize: 13, color: '#6b7280' }}>
              {tab === 'Upcoming'
                ? 'Book something now so Future You stops “getting around to it.”'
                : 'Nice. Clean slate.'}
            </div>

            {tab === 'Upcoming' ? (
              <a
                href="/looks"
                style={{
                  display: 'inline-block',
                  marginTop: 12,
                  textDecoration: 'none',
                  background: '#111',
                  color: '#fff',
                  padding: '10px 12px',
                  borderRadius: 12,
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                Browse looks
              </a>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {currentList.map((item: any) => {
              const isWaitlist = tab === 'Waitlist'
              const when = isWaitlist ? prettyDate(item.createdAt) : prettyDate(item.scheduledFor)
              const title = isWaitlist ? item?.service?.name || 'Waitlist' : item?.service?.name || 'Appointment'
              const pro = proLabel(item?.professional)
              const where = whereLabel(item?.professional)

              const status = String(item?.status || (isWaitlist ? 'WAITLIST' : '')).toUpperCase()

              return (
                <div
                  key={item.id}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 14,
                    padding: 14,
                    background: '#fff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: '#111' }}>{title}</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: '#111' }}>
                      <span style={{ fontWeight: 800 }}>{pro}</span>
                      {where ? <span style={{ color: '#6b7280' }}> · {where}</span> : null}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>
                      {isWaitlist ? `Joined: ${when}` : when}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 900,
                        padding: '6px 10px',
                        borderRadius: 999,
                        border: '1px solid #ddd',
                        background:
                          status === 'ACCEPTED'
                            ? '#ecfeff'
                            : status === 'PENDING'
                            ? '#fef9c3'
                            : status === 'COMPLETED'
                            ? '#f0fdf4'
                            : '#f3f4f6',
                        color: '#111',
                      }}
                    >
                      {isWaitlist ? 'WAITLIST' : status}
                    </div>

                    {!isWaitlist ? (
                      <a
                        href={`/booking/${encodeURIComponent(item.id)}`}
                        style={{
                          textDecoration: 'none',
                          fontSize: 12,
                          fontWeight: 900,
                          color: '#111',
                          border: '1px solid #ddd',
                          padding: '8px 10px',
                          borderRadius: 12,
                          background: '#fff',
                          textAlign: 'center',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        View details
                      </a>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          disabled
                          style={{
                            fontSize: 12,
                            fontWeight: 900,
                            border: '1px solid #ddd',
                            padding: '8px 10px',
                            borderRadius: 12,
                            background: '#fff',
                            cursor: 'not-allowed',
                            opacity: 0.6,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled
                          style={{
                            fontSize: 12,
                            fontWeight: 900,
                            border: '1px solid #ddd',
                            padding: '8px 10px',
                            borderRadius: 12,
                            background: '#fff',
                            cursor: 'not-allowed',
                            opacity: 0.6,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
