'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FormEvent } from 'react'

type BookingSource = 'DISCOVERY' | 'REQUESTED' | 'AFTERCARE'

type BookingPanelProps = {
  offeringId: string
  professionalId: string
  serviceId: string
  mediaId?: string | null

  price: number
  durationMinutes: number
  isLoggedInAsClient: boolean
  defaultScheduledForISO?: string | null

  serviceName?: string | null
  professionalName?: string | null
  locationLabel?: string | null

  professionalTimeZone?: string | null
  source: BookingSource
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

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
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

/** TZ helpers */
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

function zonedTimeToUtc(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}) {
  const { year, month, day, hour, minute, timeZone } = args
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)
  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)
  return guess
}

function parseDatetimeLocal(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) }
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
  professionalId,
  serviceId,
  mediaId = null,
  price,
  durationMinutes,
  isLoggedInAsClient,
  defaultScheduledForISO = null,
  serviceName = null,
  professionalName = null,
  locationLabel = null,
  professionalTimeZone = null,
  source,
}: BookingPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

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
  const scheduledForFromUrl = (searchParams?.get('scheduledFor') || '').trim() || null

  const hasHold = Boolean(holdId)

  // The held slot is the truth. If there's a hold, scheduledFor MUST come from the URL.
  const scheduledForISO = hasHold ? scheduledForFromUrl : defaultScheduledForISO

  const [dateTime, setDateTime] = useState('') // datetime-local in proTz
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [confirmChecked, setConfirmChecked] = useState(false)
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const holdTimerRef = useRef<number | null>(null)

  // waitlist state
  const [waitlistBusy, setWaitlistBusy] = useState(false)
  const [waitlistSuccess, setWaitlistSuccess] = useState<string | null>(null)

  const displayPrice = useMemo(() => {
    const n = Number(price)
    if (!Number.isFinite(n)) return '0'
    return n.toFixed(0)
  }, [price])

  // Seed datetime-local from scheduledForISO in pro tz.
  // Important: do not stomp user input if there's no scheduledForISO.
  useEffect(() => {
    const next = toDatetimeLocalFromISOInTimeZone(scheduledForISO, proTz)
    if (next) setDateTime(next)
    setConfirmChecked(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledForISO, proTz])

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

  // Source is now strongly typed; keep an uppercase string for API payload consistency
  const normalizedSource = useMemo(() => source.toUpperCase(), [source])

  const missingHeldScheduledFor = Boolean(hasHold && !scheduledForFromUrl)

  const canSubmit = Boolean(
    !missingHeldScheduledFor &&
      confirmChecked &&
      !loading &&
      (!hasHold || (holdId && holdUntil)) &&
      ['DISCOVERY', 'REQUESTED', 'AFTERCARE'].includes(normalizedSource) &&
      (hasHold ? scheduledForFromUrl : toISOFromDatetimeLocalInTimeZone(dateTime, proTz)),
  )

  async function copyShareLink() {
    try {
      if (!createdBookingId) return
      if (typeof window === 'undefined') return
      const url = `${window.location.origin}/client/bookings/${createdBookingId}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  async function joinWaitlist() {
    setError(null)
    setWaitlistSuccess(null)

    if (!isLoggedInAsClient) {
      redirectToLogin(router, 'waitlist')
      return
    }

    const desiredISO =
      scheduledForFromUrl ||
      toISOFromDatetimeLocalInTimeZone(dateTime, proTz) ||
      new Date(Date.now() + 2 * 60 * 60_000).toISOString()

    setWaitlistBusy(true)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professionalId,
          serviceId,
          mediaId: mediaId || null,
          desiredFor: desiredISO,
          flexibilityMinutes: 60,
          preferredTimeBucket: null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Failed to join waitlist (${res.status}).`)

      setWaitlistSuccess('Added to waitlist.')
      router.push('/client?tab=waitlist')
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to join waitlist.')
    } finally {
      setWaitlistBusy(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setSuccess(null)
    setWaitlistSuccess(null)

    if (!isLoggedInAsClient) {
      redirectToLogin(router, 'book')
      return
    }

    if (!['DISCOVERY', 'REQUESTED', 'AFTERCARE'].includes(normalizedSource)) {
      setError('Missing booking source. Please go back and try again.')
      return
    }

    if (hasHold) {
      if (!holdId || !holdUntil) {
        setError('Your hold expired. Please go back and pick a slot again.')
        return
      }
      if (!scheduledForFromUrl) {
        setError('Missing scheduled time for this hold. Please go back and pick a slot again.')
        return
      }
    }

    if (!confirmChecked) {
      setError('Please confirm the time works for you.')
      return
    }

    const finalScheduledForISO = hasHold ? scheduledForFromUrl! : toISOFromDatetimeLocalInTimeZone(dateTime, proTz)

    if (!finalScheduledForISO) {
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
          scheduledFor: finalScheduledForISO,
          holdId: hasHold ? holdId : null,
          source: normalizedSource,
          locationType: 'SALON', // or 'MOBILE' from the page/query
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
      router.refresh()
      setTimeout(() => {
        router.push('/client')
      }, 900)
    } catch (err) {
      console.error(err)
      setError('Network error while creating booking.')
    } finally {
      setLoading(false)
    }
  }

  const calendarHref = createdBookingId ? `/api/calendar?bookingId=${encodeURIComponent(createdBookingId)}` : null
  const showWaitlistCTA = !success && (!hasHold || !holdUntil)

  return (
    <section style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, alignSelf: 'flex-start', background: '#fff' }}>
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>{success ? 'You’re booked' : 'Confirm your booking'}</h2>

      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, background: success ? '#f0fdf4' : '#fafafa', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>{success ? 'Confirmed' : 'Review'}</div>

          {holdLabel && !success ? (
            <div style={{ fontSize: 12, fontWeight: 900, color: holdUrgent ? '#b91c1c' : '#111' }}>Slot held for {holdLabel}</div>
          ) : !success ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>Confirm and book</div>
          ) : (
            <div style={{ fontSize: 12, color: '#166534', fontWeight: 900 }}>Done</div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
          <div style={{ fontSize: 14, color: '#111', fontWeight: 900 }}>{serviceName || 'Service'}</div>

          <div style={{ fontSize: 13, color: '#111' }}>
            <span style={{ fontWeight: 800 }}>{professionalName || 'Professional'}</span>
            {reviewLine ? <span> · {reviewLine}</span> : <span style={{ color: '#6b7280' }}> · Missing time</span>}
          </div>

          {viewerTimeLine ? <div style={{ fontSize: 12, color: '#6b7280' }}>{viewerTimeLine}</div> : null}

          <div style={{ fontSize: 12, color: success ? '#166534' : '#6b7280' }}>
            {success ? 'Nice. Future You can’t pretend this never happened.' : holdLabel ? 'Finish booking before the hold expires.' : `Times are shown in the appointment timezone: ${proTz}.`}
          </div>
        </div>
      </div>

      {success && createdBookingId ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <a href="/client" style={{ textDecoration: 'none', background: '#111', color: '#fff', padding: '10px 12px', borderRadius: 12, fontWeight: 900, fontSize: 13, textAlign: 'center' }}>
            View my bookings
          </a>

          {calendarHref ? (
            <a href={calendarHref} style={{ textDecoration: 'none', border: '1px solid #ddd', background: '#fff', color: '#111', padding: '10px 12px', borderRadius: 12, fontWeight: 900, fontSize: 13, textAlign: 'center' }}>
              Add to calendar
            </a>
          ) : null}

          <button type="button" onClick={copyShareLink} style={{ border: '1px solid #ddd', background: '#fff', color: '#111', padding: '10px 12px', borderRadius: 12, fontWeight: 900, fontSize: 13, cursor: 'pointer' }}>
            {copied ? 'Link copied' : 'Copy booking link'}
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
                if (hasHold) return
                setDateTime(e.target.value)
                setConfirmChecked(false)
              }}
              style={{ width: '100%', marginTop: 4, padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd', opacity: hasHold ? 0.7 : 1 }}
              disabled={loading || hasHold}
              title={hasHold ? 'This time is locked because a slot is being held.' : undefined}
            />
          </label>

          {missingHeldScheduledFor ? <div style={{ fontSize: 12, color: '#b91c1c' }}>Hold is present but scheduledFor is missing. Go back and pick a slot again.</div> : null}

          {hasHold && (!holdId || !holdUntil) ? <div style={{ fontSize: 12, color: '#b91c1c' }}>No valid hold found. Go back and pick a slot again.</div> : null}

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: '#111', padding: 12, borderRadius: 12, border: '1px solid #eee', background: '#fff' }}>
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              disabled={!dateTime || loading || (hasHold && (!holdId || !holdUntil))}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 900 }}>I’m confirming this time works for me</div>
              <div style={{ color: '#6b7280', marginTop: 2 }}>Tiny step. Big reduction in “oops, wrong day.”</div>
            </div>
          </label>

          {error ? <p style={{ color: '#b91c1c', fontSize: 13, margin: 0 }}>{error}</p> : null}
          {waitlistSuccess ? <p style={{ color: '#166534', fontSize: 13, margin: 0, fontWeight: 800 }}>{waitlistSuccess}</p> : null}

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

          {showWaitlistCTA ? (
            <button
              type="button"
              onClick={joinWaitlist}
              disabled={waitlistBusy || loading}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #ddd',
                background: '#fff',
                color: '#111',
                fontSize: 13,
                fontWeight: 900,
                cursor: waitlistBusy ? 'default' : 'pointer',
                opacity: waitlistBusy ? 0.7 : 1,
              }}
            >
              {waitlistBusy ? 'Joining waitlist…' : 'No time works? Join waitlist'}
            </button>
          ) : null}

          {!isLoggedInAsClient ? <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>You’ll need to log in as a client to complete your booking.</p> : null}

          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{holdLabel ? 'If the hold expires, the time might disappear.' : 'Confirm it, and you’re done.'}</p>
        </form>
      )}
    </section>
  )
}
