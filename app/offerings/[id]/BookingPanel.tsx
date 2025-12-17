'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type BookingPanelProps = {
  offeringId: string
  price: number
  durationMinutes: number
  isLoggedInAsClient: boolean
  defaultScheduledForISO?: string | null

  serviceName?: string | null
  professionalName?: string | null
  locationLabel?: string | null

  professionalTimeZone?: string | null
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/'
  if (!trimmed.startsWith('/')) return '/'
  if (trimmed.startsWith('//')) return '/'
  return trimmed
}

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  if (res.status === 409) return 'That time was just taken or your hold expired. Please pick another slot.'
  return `Request failed (${res.status}).`
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/**
 * TZ helpers
 */
function getZonedParts(dateUtc: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function getTimeZoneOffsetMinutes(dateUtc: Date, timeZone: string) {
  const z = getZonedParts(dateUtc, timeZone)
  const asIfUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asIfUtc - dateUtc.getTime()) / 60_000)
}

function zonedTimeToUtc(args: { year: number; month: number; day: number; hour: number; minute: number; timeZone: string }) {
  const { year, month, day, hour, minute, timeZone } = args
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)

  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) {
    guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)
  }

  return guess
}

function parseDatetimeLocal(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
  }
}

function toDatetimeLocalFromISOInTimeZone(iso: string | null | undefined, timeZone: string) {
  if (!iso || typeof iso !== 'string') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const z = getZonedParts(d, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${z.year}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}`
}

function toISOFromDatetimeLocalInTimeZone(value: string, timeZone: string): string | null {
  const p = parseDatetimeLocal(value)
  if (!p) return null
  const utc = zonedTimeToUtc({ ...p, timeZone })
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString()
}

function formatPrettyInTimeZone(valueDatetimeLocal: string, timeZone: string) {
  const p = parseDatetimeLocal(valueDatetimeLocal)
  if (!p) return null
  const utc = zonedTimeToUtc({ ...p, timeZone })
  if (Number.isNaN(utc.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(utc)
}

export default function BookingPanel({
  offeringId,
  price,
  durationMinutes,
  isLoggedInAsClient,
  defaultScheduledForISO = null,
  serviceName = null,
  professionalName = null,
  locationLabel = null,
  professionalTimeZone = null,
}: BookingPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Standardize: proTimeZone query param from AvailabilityDrawer
  const proTz = professionalTimeZone || searchParams?.get('proTimeZone') || 'America/Los_Angeles'

  const viewerTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null
    } catch {
      return null
    }
  }, [])

  const holdId = (searchParams?.get('holdId') || '').trim() || null
  const holdUntilParam = searchParams?.get('holdUntil') || ''

  const [dateTime, setDateTime] = useState('') // datetime-local, interpreted in proTz
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [confirmChecked, setConfirmChecked] = useState(false)
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const touchedRef = useRef(false)

  const displayPrice = useMemo(() => {
    const n = Number(price)
    if (!Number.isFinite(n)) return '0'
    return n.toFixed(0)
  }, [price])

  // seed the datetime-local from scheduledFor (UTC iso) in pro tz
  useEffect(() => {
    if (dateTime) return
    const next = toDatetimeLocalFromISOInTimeZone(defaultScheduledForISO, proTz)
    if (!next) return
    setDateTime(next)
  }, [defaultScheduledForISO, dateTime, proTz])

  useEffect(() => {
    const ms = Number(holdUntilParam)
    if (Number.isFinite(ms) && ms > Date.now()) {
      setHoldUntil(ms)
      return
    }
    setHoldUntil(null)
  }, [holdUntilParam])

  useEffect(() => {
    if (!holdUntil) return
    if (holdTimerRef.current) window.clearInterval(holdTimerRef.current)

    holdTimerRef.current = window.setInterval(() => {
      setHoldUntil((prev) => {
        if (!prev) return prev
        if (Date.now() >= prev) return null
        return prev
      })
    }, 500)

    return () => {
      if (holdTimerRef.current) window.clearInterval(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [holdUntil])

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!touchedRef.current || success) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [success])

  const prettyTimePro = useMemo(() => formatPrettyInTimeZone(dateTime, proTz), [dateTime, proTz])

  const viewerTimeLine = useMemo(() => {
    if (!dateTime || !viewerTz) return null
    if (viewerTz === proTz) return null
    const p = parseDatetimeLocal(dateTime)
    if (!p) return null
    const utc = zonedTimeToUtc({ ...p, timeZone: proTz })
    if (Number.isNaN(utc.getTime())) return null
    const local = new Intl.DateTimeFormat(undefined, {
      timeZone: viewerTz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(utc)
    return `Your local time: ${local}`
  }, [dateTime, viewerTz, proTz])

  const reviewLine = useMemo(() => {
    if (!prettyTimePro) return null
    const dur = Number(durationMinutes)
    const durLabel = Number.isFinite(dur) && dur > 0 ? `${dur} min` : null
    const priceLabel = `$${displayPrice}`
    const where = locationLabel ? ` · ${locationLabel}` : ''
    const durPart = durLabel ? ` · ${durLabel}` : ''
    return `${prettyTimePro}${durPart} · ${priceLabel}${where} · ${proTz}`
  }, [prettyTimePro, durationMinutes, displayPrice, locationLabel, proTz])

  const holdLabel = useMemo(() => {
    if (!holdUntil) return null
    const remaining = clamp(holdUntil - Date.now(), 0, 60 * 60 * 1000)
    const s = Math.floor(remaining / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }, [holdUntil])

  const holdUrgent = useMemo(() => {
    if (!holdUntil) return false
    return holdUntil - Date.now() <= 2 * 60_000
  }, [holdUntil])

  const canSubmit = Boolean(dateTime && confirmChecked && !loading && holdId && holdUntil)

  const bookingShareUrl = useMemo(() => {
    if (!createdBookingId) return null
    if (typeof window === 'undefined') return null
    return `${window.location.origin}/booking/${createdBookingId}`
  }, [createdBookingId])

  async function copyShareLink() {
    try {
      if (!bookingShareUrl) return
      await navigator.clipboard.writeText(bookingShareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setSuccess(null)

    if (!isLoggedInAsClient) {
      redirectToLogin(router, 'book')
      return
    }

    if (!holdId || !holdUntil) {
      setError('Your hold expired. Please go back and pick a slot again.')
      return
    }

    if (!confirmChecked) {
      setError('Please confirm the time works for you.')
      return
    }

    const scheduledForISO = toISOFromDatetimeLocalInTimeZone(dateTime, proTz)
    if (!scheduledForISO) {
      setError('Please choose a valid date and time.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId,
          scheduledFor: scheduledForISO,
          holdId,
          // source: 'DISCOVERY', // optional
          // mediaId: searchParams?.get('mediaId') || null, // only if Booking model has mediaId
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'book')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      const bookingId = data?.booking?.id ? String(data.booking.id) : null
      setCreatedBookingId(bookingId)

      setSuccess('Booked. You’re officially on the calendar.')
      touchedRef.current = false
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error while creating booking.')
    } finally {
      setLoading(false)
    }
  }

  const calendarHref = createdBookingId ? `/api/calendar?bookingId=${encodeURIComponent(createdBookingId)}` : null

  return (
    <section
      style={{
        border: '1px solid #eee',
        borderRadius: 12,
        padding: 16,
        alignSelf: 'flex-start',
        background: '#fff',
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>{success ? 'You’re booked' : 'Confirm your booking'}</h2>

      <div
        style={{
          border: '1px solid #eee',
          borderRadius: 12,
          padding: 12,
          background: success ? '#f0fdf4' : '#fafafa',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>{success ? 'Confirmed' : 'Review'}</div>

          {holdLabel && !success ? (
            <div style={{ fontSize: 12, fontWeight: 900, color: holdUrgent ? '#b91c1c' : '#111' }}>
              Slot held for {holdLabel}
            </div>
          ) : !success ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>Pick a time and confirm</div>
          ) : (
            <div style={{ fontSize: 12, color: '#166534', fontWeight: 900 }}>Done</div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
          <div style={{ fontSize: 14, color: '#111', fontWeight: 900 }}>{serviceName || 'Service'}</div>

          <div style={{ fontSize: 13, color: '#111' }}>
            <span style={{ fontWeight: 800 }}>{professionalName || 'Professional'}</span>
            {reviewLine ? <span> · {reviewLine}</span> : <span style={{ color: '#6b7280' }}> · Pick a time below</span>}
          </div>

          {viewerTimeLine ? <div style={{ fontSize: 12, color: '#6b7280' }}>{viewerTimeLine}</div> : null}

          <div style={{ fontSize: 12, color: success ? '#166534' : '#6b7280' }}>
            {success
              ? 'Nice. Future You can’t pretend this never happened.'
              : holdLabel
                ? 'Finish booking before the hold expires.'
                : `Times are shown in the appointment timezone: ${proTz}.`}
          </div>
        </div>
      </div>

      {success && createdBookingId ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <a
            href="/client/bookings"
            style={{
              textDecoration: 'none',
              background: '#111',
              color: '#fff',
              padding: '10px 12px',
              borderRadius: 12,
              fontWeight: 900,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            View my bookings
          </a>

          {calendarHref ? (
            <a
              href={calendarHref}
              style={{
                textDecoration: 'none',
                border: '1px solid #ddd',
                background: '#fff',
                color: '#111',
                padding: '10px 12px',
                borderRadius: 12,
                fontWeight: 900,
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              Add to calendar
            </a>
          ) : null}

          <button
            type="button"
            onClick={copyShareLink}
            style={{
              border: '1px solid #ddd',
              background: '#fff',
              color: '#111',
              padding: '10px 12px',
              borderRadius: 12,
              fontWeight: 900,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {copied ? 'Link copied' : 'Share'}
          </button>

          <div style={{ fontSize: 12, color: '#6b7280' }}>You’ll thank yourself later.</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <label style={{ fontSize: 14, color: '#111' }}>
            Date &amp; time (appointment timezone: <span style={{ fontWeight: 900 }}>{proTz}</span>)
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => {
                touchedRef.current = true
                setDateTime(e.target.value)
                setConfirmChecked(false)
              }}
              style={{
                width: '100%',
                marginTop: 4,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #ddd',
              }}
              disabled={loading}
            />
          </label>

          {!holdId || !holdUntil ? (
            <div style={{ fontSize: 12, color: '#b91c1c' }}>
              No valid hold found. Go back and pick a slot again.
            </div>
          ) : null}

          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              fontSize: 13,
              color: '#111',
              padding: 12,
              borderRadius: 12,
              border: '1px solid #eee',
              background: '#fff',
            }}
          >
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => {
                touchedRef.current = true
                setConfirmChecked(e.target.checked)
              }}
              disabled={!dateTime || loading || !holdId || !holdUntil}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 900 }}>I’m confirming this time works for me</div>
              <div style={{ color: '#6b7280', marginTop: 2 }}>Tiny step. Big reduction in “oops, wrong day.”</div>
            </div>
          </label>

          {error && <p style={{ color: '#b91c1c', fontSize: 13, margin: 0 }}>{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: 'none',
              background: '#111',
              color: '#fff',
              fontSize: 14,
              fontWeight: 900,
              cursor: !canSubmit ? 'default' : 'pointer',
              opacity: !canSubmit ? 0.7 : 1,
            }}
          >
            {loading ? 'Booking…' : holdLabel ? `Confirm now · $${displayPrice}` : `Confirm booking · $${displayPrice}`}
          </button>

          {!isLoggedInAsClient && (
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              You’ll need to log in as a client to complete your booking.
            </p>
          )}

          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
            {holdLabel ? 'If the hold expires, the time might disappear.' : 'Pick a time, confirm it, and you’re done.'}
          </p>
        </form>
      )}
    </section>
  )
}
