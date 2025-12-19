// app/(main)/booking/AvailabilityDrawer.tsx
'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { UI_SIZES } from '../ui/layoutConstants'

type DrawerContext = {
  mediaId: string
  professionalId: string
  serviceId?: string | null
} | null

type ProCard = {
  id: string
  businessName: string | null
  avatarUrl: string | null
  location: string | null
  offeringId: string | null
  price: number | null
  durationMinutes: number | null
  slots: string[]
  isCreator?: boolean
  timeZone?: string | null
}

type AvailabilityResponse = {
  mediaId: string | null
  serviceId: string | null
  timeZone?: string | null
  primaryPro: ProCard
  otherPros: ProCard[]
  waitlistSupported: boolean
}

const FOOTER_HEIGHT = UI_SIZES.footerHeight

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

/**
 * Format a UTC ISO slot in the PROFESSIONAL timezone.
 */
function fmtSlotInTimeZone(iso: string, timeZone: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Invalid time'
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function fmtFullInTimeZone(iso: string, timeZone: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function getViewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

function fmtInViewerTz(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * timezone helpers (same logic used in BookingPanel rewrite)
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

/**
 * datetime-local returns "YYYY-MM-DDTHH:mm" (no timezone).
 * Interpret it as PROFESSIONAL timezone and convert to UTC ISO.
 */
function toISOFromDatetimeLocalInTimeZone(value: string, timeZone: string): string | null {
  if (!value) return null
  const p = parseDatetimeLocal(value)
  if (!p) return null
  const utc = zonedTimeToUtc({ ...p, timeZone })
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString()
}

export default function AvailabilityDrawer({
  open,
  onClose,
  context,
}: {
  open: boolean
  onClose: () => void
  context: DrawerContext
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AvailabilityResponse | null>(null)

  const [selected, setSelected] = useState<{
    proId: string
    offeringId: string
    slotISO: string
    proTimeZone: string
    holdId: string
  } | null>(null)

  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const [holding, setHolding] = useState(false)

  // ✅ Waitlist UI
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [desired, setDesired] = useState('') // datetime-local
  const [flexMinutes, setFlexMinutes] = useState(60)
  const [waitlistNotes, setWaitlistNotes] = useState('')
  const [waitlistPosting, setWaitlistPosting] = useState(false)
  const [waitlistMsg, setWaitlistMsg] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const holdTimerRef = useRef<number | null>(null)

  const viewerTz = useMemo(() => getViewerTimeZone(), [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      if (holdTimerRef.current) window.clearInterval(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  // Fetch availability when opened
  useEffect(() => {
    if (!open || !context) return

    setSelected(null)
    setHoldUntil(null)
    setHolding(false)

    setWaitlistOpen(false)
    setDesired('')
    setFlexMinutes(60)
    setWaitlistNotes('')
    setWaitlistMsg(null)
    setWaitlistPosting(false)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setData(null)

    const qs = new URLSearchParams({
      professionalId: context.professionalId,
      mediaId: context.mediaId,
    })
    if (context.serviceId) qs.set('serviceId', context.serviceId)

    fetch(`/api/availability?${qs.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await safeJson(res)
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
        setData(body as AvailabilityResponse)
      })
      .catch((e: any) => {
        if (e?.name === 'AbortError') return
        setError(e?.message || 'Failed to load availability')
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null
        setLoading(false)
      })
  }, [open, context])

  const primary = data?.primaryPro ?? null
  const others = data?.otherPros ?? []

  // appointment timezone: prefer primaryPro.timeZone, then top-level, then viewer, then fallback
  const appointmentTz = useMemo(() => {
    return primary?.timeZone || data?.timeZone || viewerTz || 'America/Los_Angeles'
  }, [primary?.timeZone, data?.timeZone, viewerTz])

  // Hold countdown label
  const holdLabel = useMemo(() => {
    if (!holdUntil) return null
    const remaining = Math.max(0, holdUntil - Date.now())
    const s = Math.floor(remaining / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }, [holdUntil])

  // Run timer while holding
  useEffect(() => {
    if (!holdUntil) return
    if (holdTimerRef.current) window.clearInterval(holdTimerRef.current)

    holdTimerRef.current = window.setInterval(() => {
      setHoldUntil((prev) => {
        if (!prev) return prev
        if (Date.now() >= prev) {
          setSelected(null)
          return null
        }
        return prev
      })
    }, 500)

    return () => {
      if (holdTimerRef.current) window.clearInterval(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [holdUntil])

  async function onPickSlot(proId: string, offeringId: string | null, slotISO: string, proTimeZone?: string | null) {
    if (!offeringId) return
    if (holding) return

    const tz = proTimeZone || appointmentTz

    setError(null)
    setWaitlistOpen(false)
    setWaitlistMsg(null)

    // clear existing countdown while we create the hold
    setSelected(null)
    setHoldUntil(null)

    setHolding(true)
    try {
      const res = await fetch('/api/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId,
          scheduledFor: slotISO, // already UTC ISO
        }),
      })

      const body = await safeJson(res)
      if (!res.ok) throw new Error(body?.error || `Hold failed (${res.status})`)

      const holdId = typeof body?.holdId === 'string' ? body.holdId : null
      const holdUntilMs = typeof body?.holdUntil === 'number' ? body.holdUntil : null

      if (!holdId || !holdUntilMs) {
        throw new Error('Hold response missing holdId/holdUntil.')
      }

      setSelected({ proId, offeringId, slotISO, proTimeZone: tz, holdId })
      setHoldUntil(holdUntilMs)
    } catch (e: any) {
      setError(e?.message || 'Failed to hold slot. Try another time.')
    } finally {
      setHolding(false)
    }
  }

  // IMPORTANT: prefer serviceId returned by API (it’s the “truth”)
  const effectiveServiceId = data?.serviceId ?? context?.serviceId ?? null
  const canWaitlist = Boolean(data?.waitlistSupported && context?.professionalId && effectiveServiceId)
  const noPrimarySlots = Boolean(primary && (!primary.slots || primary.slots.length === 0))

  async function submitWaitlist() {
    if (!context || !data?.waitlistSupported) return

    if (!effectiveServiceId) {
      setWaitlistMsg('This look is missing a service link, so waitlist can’t be created yet.')
      return
    }
    if (waitlistPosting) return

    setWaitlistPosting(true)
    setWaitlistMsg(null)

    try {
      // interpret desired as appointment timezone (primary pro)
      const desiredISO = desired ? toISOFromDatetimeLocalInTimeZone(desired, appointmentTz) : null

      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professionalId: context.professionalId,
          serviceId: effectiveServiceId,
          mediaId: context.mediaId,
          desiredFor: desiredISO,
          flexibilityMinutes: flexMinutes,
          notes: waitlistNotes?.trim() || null,
        }),
      })

      const body = await safeJson(res)
      if (!res.ok) throw new Error(body?.error || `Waitlist failed (${res.status})`)

      setWaitlistMsg('You’re on the waitlist. We’ll notify you if something opens up.')
      setWaitlistOpen(false)
    } catch (e: any) {
      setWaitlistMsg(e?.message || 'Failed to join waitlist.')
    } finally {
      setWaitlistPosting(false)
    }
  }

  if (!open || !context) return null

  const continueHref =
  selected?.offeringId && holdUntil
    ? `/offerings/${selected.offeringId}?scheduledFor=${encodeURIComponent(selected.slotISO)}` +
      `&mediaId=${encodeURIComponent(context.mediaId)}` +
      `&holdUntil=${encodeURIComponent(String(holdUntil))}` +
      `&proTimeZone=${encodeURIComponent(selected.proTimeZone)}` +
      `&holdId=${encodeURIComponent(selected.holdId)}` +
      `&source=${encodeURIComponent('DISCOVERY')}`
    : null

  const showLocalHint = Boolean(viewerTz && viewerTz !== appointmentTz)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
        }}
      />

      {/* Sheet */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: FOOTER_HEIGHT,
          height: `calc(100dvh - ${FOOTER_HEIGHT}px)`,
          background: '#fff',
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          overflow: 'hidden',
          fontFamily: 'system-ui',
          boxShadow: '0 -10px 30px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 900 }}>View availability</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <div className="looksNoScrollbar" style={{ overflowY: 'auto', padding: 12, paddingBottom: 16 }}>
          {loading ? (
            <div style={{ color: '#6b7280' }}>Loading…</div>
          ) : error ? (
            <div style={{ color: '#ef4444' }}>{error}</div>
          ) : !data || !primary ? (
            <div style={{ color: '#6b7280' }}>No availability found.</div>
          ) : (
            <>
              {/* Primary / creator */}
              <div
                style={{
                  border: '1px solid #eee',
                  borderRadius: 14,
                  padding: 12,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 999,
                    background: '#eee',
                    overflow: 'hidden',
                    flex: '0 0 auto',
                  }}
                >
                  {primary.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={primary.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Link href={`/professionals/${primary.id}`} style={{ fontWeight: 900, color: '#111', textDecoration: 'none' }}>
                      {primary.businessName || 'Professional'}
                    </Link>

                    <span
                      title="Original creator"
                      style={{
                        fontSize: 12,
                        padding: '4px 8px',
                        borderRadius: 999,
                        background: '#FEF3C7',
                        border: '1px solid #F59E0B',
                      }}
                    >
                      ⭐ Creator
                    </span>

                    {primary.location ? <span style={{ fontSize: 12, color: '#6b7280' }}>{primary.location}</span> : null}
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                    {effectiveServiceId ? 'Matched to this service' : 'No service linked yet (similar pros hidden)'}
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                    Times shown in <strong>{appointmentTz}</strong>
                    {showLocalHint ? <span> · Your timezone: {viewerTz}</span> : null}
                  </div>
                </div>
              </div>

              {/* Slots */}
              <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>Available times</div>
                  {holdLabel ? (
                    <div style={{ fontSize: 12, color: '#111' }}>
                      Slot on hold: <strong>{holdLabel}</strong>
                    </div>
                  ) : holding ? (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Holding…</div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Pick a time</div>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {primary.slots?.length ? (
                    primary.slots.map((iso) => {
                      const isSelected = selected?.proId === primary.id && selected?.slotISO === iso
                      const title = fmtFullInTimeZone(iso, appointmentTz)

                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => onPickSlot(primary.id, primary.offeringId, iso, primary.timeZone)}
                          disabled={!primary.offeringId || holding}
                          style={{
                            borderRadius: 999,
                            border: '1px solid #ddd',
                            padding: '8px 10px',
                            fontSize: 12,
                            cursor: !primary.offeringId || holding ? 'not-allowed' : 'pointer',
                            background: isSelected ? '#111' : '#fff',
                            color: isSelected ? '#fff' : '#111',
                            opacity: !primary.offeringId || holding ? 0.5 : 1,
                          }}
                          title={title}
                        >
                          {fmtSlotInTimeZone(iso, appointmentTz)}
                        </button>
                      )
                    })
                  ) : (
                    <div style={{ color: '#6b7280', fontSize: 13 }}>
                      No open slots right now.
                      {canWaitlist ? ' Join the waitlist below.' : null}
                    </div>
                  )}
                </div>

                {showLocalHint && selected?.slotISO ? (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                    Your local time for this slot: <strong style={{ color: '#111' }}>{fmtInViewerTz(selected.slotISO)}</strong>
                  </div>
                ) : null}

                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {continueHref ? (
                    <Link
                      href={continueHref}
                      style={{
                        background: '#111',
                        color: '#fff',
                        padding: '10px 12px',
                        borderRadius: 12,
                        textDecoration: 'none',
                        fontWeight: 900,
                        fontSize: 13,
                      }}
                    >
                      Continue
                    </Link>
                  ) : (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Pick a slot to continue.</div>
                  )}

                  <div style={{ fontSize: 12, color: '#6b7280' }}>Takes ~10 seconds.</div>
                </div>
              </div>

              {/* Waitlist */}
              {canWaitlist ? (
                <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ fontWeight: 900 }}>Waitlist</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {noPrimarySlots ? 'No slots, get notified' : 'Can’t make this time? Get notified'}
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    Preferred times are in <strong>{appointmentTz}</strong>
                    {showLocalHint ? <span> · Your timezone: {viewerTz}</span> : null}
                  </div>

                  {waitlistMsg ? (
                    <div style={{ marginTop: 10, fontSize: 13, color: waitlistMsg.includes('waitlist') ? '#166534' : '#b91c1c' }}>
                      {waitlistMsg}
                    </div>
                  ) : null}

                  {!waitlistOpen ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setWaitlistOpen(true)
                          setWaitlistMsg(null)
                          setSelected(null)
                          setHoldUntil(null)
                        }}
                        style={{
                          border: 'none',
                          background: '#111',
                          color: '#fff',
                          padding: '10px 12px',
                          borderRadius: 12,
                          fontWeight: 900,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Join waitlist
                      </button>

                      <div style={{ fontSize: 12, color: '#6b7280' }}>You’ll only get pinged if it matches your window.</div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                      <label style={{ fontSize: 12, color: '#111' }}>
                        Preferred date/time (optional)
                        <input
                          type="datetime-local"
                          value={desired}
                          onChange={(e) => setDesired(e.target.value)}
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid #ddd',
                          }}
                        />
                      </label>

                      <label style={{ fontSize: 12, color: '#111' }}>
                        Flexibility window
                        <select
                          value={flexMinutes}
                          onChange={(e) => setFlexMinutes(Number(e.target.value))}
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid #ddd',
                            background: '#fff',
                          }}
                        >
                          <option value={30}>± 30 minutes</option>
                          <option value={60}>± 1 hour</option>
                          <option value={120}>± 2 hours</option>
                          <option value={240}>± 4 hours</option>
                        </select>
                      </label>

                      <label style={{ fontSize: 12, color: '#111' }}>
                        Notes (optional)
                        <input
                          value={waitlistNotes}
                          onChange={(e) => setWaitlistNotes(e.target.value)}
                          placeholder="Ex: after 5pm, weekends, prefer shorter appointment"
                          style={{
                            width: '100%',
                            marginTop: 4,
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid #ddd',
                          }}
                        />
                      </label>

                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={submitWaitlist}
                          disabled={waitlistPosting}
                          style={{
                            border: 'none',
                            background: '#111',
                            color: '#fff',
                            padding: '10px 12px',
                            borderRadius: 12,
                            fontWeight: 900,
                            fontSize: 13,
                            cursor: waitlistPosting ? 'default' : 'pointer',
                            opacity: waitlistPosting ? 0.7 : 1,
                          }}
                        >
                          {waitlistPosting ? 'Joining…' : 'Confirm waitlist'}
                        </button>

                        <button
                          type="button"
                          onClick={() => setWaitlistOpen(false)}
                          style={{
                            border: '1px solid #ddd',
                            background: '#fff',
                            color: '#111',
                            padding: '10px 12px',
                            borderRadius: 12,
                            fontWeight: 800,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>

                        <div style={{ fontSize: 12, color: '#6b7280' }}>This is the “future you” move.</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Similar pros */}
              {effectiveServiceId ? (
                <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Other pros near you</div>

                  {others.length ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {others.map((p) => {
                        const pTz = p.timeZone || appointmentTz
                        const showPtzHint = Boolean(viewerTz && viewerTz !== pTz)

                        return (
                          <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, display: 'grid', gap: 10 }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <div style={{ width: 38, height: 38, borderRadius: 999, background: '#eee', overflow: 'hidden', flex: '0 0 auto' }}>
                                {p.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={p.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : null}
                              </div>

                              <div style={{ minWidth: 0, flex: 1 }}>
                                <Link href={`/professionals/${p.id}`} style={{ fontWeight: 900, color: '#111', textDecoration: 'none' }}>
                                  {p.businessName || 'Professional'}
                                </Link>
                                {p.location ? <div style={{ fontSize: 12, color: '#6b7280' }}>{p.location}</div> : null}

                                <div style={{ fontSize: 12, color: '#6b7280' }}>
                                  Times shown in <strong>{pTz}</strong>
                                  {showPtzHint ? <span> · Your timezone: {viewerTz}</span> : null}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {(p.slots || []).slice(0, 4).map((iso) => (
                                <button
                                  key={iso}
                                  type="button"
                                  onClick={() => onPickSlot(p.id, p.offeringId, iso, p.timeZone || appointmentTz)}
                                  disabled={!p.offeringId || holding}
                                  style={{
                                    borderRadius: 999,
                                    border: '1px solid #ddd',
                                    padding: '8px 10px',
                                    fontSize: 12,
                                    cursor: !p.offeringId || holding ? 'not-allowed' : 'pointer',
                                    background: selected?.proId === p.id && selected?.slotISO === iso ? '#111' : '#fff',
                                    color: selected?.proId === p.id && selected?.slotISO === iso ? '#fff' : '#111',
                                    opacity: !p.offeringId || holding ? 0.5 : 1,
                                  }}
                                  title={fmtFullInTimeZone(iso, pTz)}
                                >
                                  {fmtSlotInTimeZone(iso, pTz)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={{ color: '#6b7280', fontSize: 13 }}>No similar pros found yet.</div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <style jsx global>{`
        .looksNoScrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .looksNoScrollbar::-webkit-scrollbar {
          display: none;
          width: 0;
          height: 0;
        }
      `}</style>
    </div>
  )
}
