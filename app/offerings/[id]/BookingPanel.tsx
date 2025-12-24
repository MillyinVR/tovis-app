// app/offerings/[id]/BookingPanel.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { FormEvent } from 'react'

type BookingSource = 'DISCOVERY' | 'REQUESTED' | 'AFTERCARE'
type ServiceLocationType = 'SALON' | 'MOBILE'

type BookingPanelProps = {
  offeringId: string
  professionalId: string
  serviceId: string

  mediaId?: string | null

  offersInSalon: boolean
  offersMobile: boolean

  salonPriceStartingAt?: number | null
  salonDurationMinutes?: number | null
  mobilePriceStartingAt?: number | null
  mobileDurationMinutes?: number | null

  defaultLocationType?: ServiceLocationType | null

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

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function pickEffectiveLocationType(args: {
  requested: ServiceLocationType | null
  offersInSalon: boolean
  offersMobile: boolean
}): ServiceLocationType | null {
  const { requested, offersInSalon, offersMobile } = args
  if (requested === 'SALON' && offersInSalon) return 'SALON'
  if (requested === 'MOBILE' && offersMobile) return 'MOBILE'
  if (offersInSalon) return 'SALON'
  if (offersMobile) return 'MOBILE'
  return null
}

function pickModeFields(args: {
  locationType: ServiceLocationType
  salonPriceStartingAt?: number | null
  salonDurationMinutes?: number | null
  mobilePriceStartingAt?: number | null
  mobileDurationMinutes?: number | null
}) {
  const { locationType } = args
  const price = locationType === 'MOBILE' ? args.mobilePriceStartingAt ?? null : args.salonPriceStartingAt ?? null
  const duration = locationType === 'MOBILE' ? args.mobileDurationMinutes ?? null : args.salonDurationMinutes ?? null

  const durationMinutes = Number(duration ?? 0)
  const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 60

  const priceNum = Number(price ?? NaN)
  const safePrice = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0

  return { price: safePrice, durationMinutes: safeDuration }
}

function formatSlotLabel(isoUtc: string, timeZone: string) {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return isoUtc
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function isoToYMDInTz(isoUtc: string, timeZone: string): string | null {
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const y = map.year
  const m = map.month
  const day = map.day
  if (!y || !m || !day) return null
  return `${y}-${m}-${day}`
}

function ymdFromDateInTz(dateUtc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}`
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

function startOfMonthUtcFromYMD(ymd: string) {
  const [y, m] = ymd.split('-').map((x) => Number(x))
  return new Date(Date.UTC(y, (m || 1) - 1, 1, 12, 0, 0, 0))
}

function addMonthsUtc(d: Date, months: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12, 0, 0, 0))
}

function buildMonthGrid(args: { monthStartUtc: Date; proTz: string }) {
  const { monthStartUtc, proTz } = args
  const monthKey = ymdFromDateInTz(monthStartUtc, proTz).slice(0, 7)

  const monthStartYMD = ymdFromDateInTz(monthStartUtc, proTz)
  const monthStartLocalNoonUtc = new Date(
    Date.UTC(
      Number(monthStartYMD.slice(0, 4)),
      Number(monthStartYMD.slice(5, 7)) - 1,
      Number(monthStartYMD.slice(8, 10)),
      12,
      0,
      0,
      0,
    ),
  )

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: proTz, weekday: 'short' })
    .format(monthStartLocalNoonUtc)
    .toLowerCase()

  const map: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }
  const idx =
    weekday.startsWith('mon')
      ? map.mon
      : weekday.startsWith('tue')
        ? map.tue
        : weekday.startsWith('wed')
          ? map.wed
          : weekday.startsWith('thu')
            ? map.thu
            : weekday.startsWith('fri')
              ? map.fri
              : weekday.startsWith('sat')
                ? map.sat
                : map.sun

  const gridStartUtc = addDays(monthStartUtc, -idx)

  const days: { ymd: string; inMonth: boolean; dateUtc: Date }[] = []
  for (let i = 0; i < 42; i++) {
    const dUtc = addDays(gridStartUtc, i)
    const ymd = ymdFromDateInTz(dUtc, proTz)
    const inMonth = ymd.slice(0, 7) === monthKey
    days.push({ ymd, inMonth, dateUtc: dUtc })
  }

  return days
}

// Pure URL cleanup (no async, no hold deletion)
function clearHoldParams(router: ReturnType<typeof useRouter>, searchParams: ReturnType<typeof useSearchParams>) {
  if (typeof window === 'undefined') return
  const qs = new URLSearchParams(searchParams?.toString() || '')
  qs.delete('holdId')
  qs.delete('holdUntil')
  qs.delete('scheduledFor')
  // NOTE: do NOT delete locationType here. That’s a user choice.
  router.replace(`${window.location.pathname}?${qs.toString()}`, { scroll: false })
}

// Optional: delete hold, then clear URL params (use when you intentionally want to free the slot)
async function clearHoldAndParams(args: {
  holdId: string | null
  router: ReturnType<typeof useRouter>
  searchParams: ReturnType<typeof useSearchParams>
}) {
  const { holdId, router, searchParams } = args
  if (holdId) {
    await deleteHoldById(holdId).catch(() => {})
  }
  clearHoldParams(router, searchParams)
}

function parseHoldResponse(data: any): {
  holdId: string
  holdUntilMs: number
  scheduledForISO: string
  locationType?: ServiceLocationType | null
} {
  const hold = data?.hold
  const holdId = typeof hold?.id === 'string' ? hold.id : ''
  const expiresAtIso = typeof hold?.expiresAt === 'string' ? hold.expiresAt : ''
  const scheduledForIso = typeof hold?.scheduledFor === 'string' ? hold.scheduledFor : ''
  const locationType = normalizeLocationType(hold?.locationType)

  const holdUntilMs = expiresAtIso ? new Date(expiresAtIso).getTime() : NaN
  if (!holdId || !scheduledForIso || !Number.isFinite(holdUntilMs)) {
    throw new Error('Hold response was missing fields.')
  }

  return { holdId, holdUntilMs, scheduledForISO: scheduledForIso, locationType }
}

async function deleteHoldById(holdId: string) {
  const res = await fetch(`/api/holds/${encodeURIComponent(holdId)}`, { method: 'DELETE' })
  if (res.ok) return
  const data = await safeJson(res)
  const msg = data?.error || `Failed to delete hold (${res.status}).`
  const err: any = new Error(msg)
  err.status = res.status
  throw err
}

async function createHoldForSelectedSlot(args: {
  offeringId: string
  scheduledFor: string
  locationType: ServiceLocationType
  router: ReturnType<typeof useRouter>
  searchParams: ReturnType<typeof useSearchParams>
  previousHoldId?: string | null
}) {
  const { offeringId, scheduledFor, locationType, router, searchParams, previousHoldId } = args

  // ✅ Delete old hold before creating a new one
  if (previousHoldId) {
    try {
      await deleteHoldById(previousHoldId)
    } catch {
      // don’t hard-fail; holds also expire server-side
    }
  }

  const res = await fetch('/api/holds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offeringId, scheduledFor, locationType }),
  })

  const data = await safeJson(res)
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to hold slot.')

  const parsed = parseHoldResponse(data)

  if (typeof window !== 'undefined') {
    const qs = new URLSearchParams(searchParams?.toString() || '')
    qs.set('holdId', parsed.holdId)
    qs.set('holdUntil', String(parsed.holdUntilMs))
    qs.set('scheduledFor', parsed.scheduledForISO)
    qs.set('locationType', locationType)
    router.replace(`${window.location.pathname}?${qs.toString()}`, { scroll: false })
  }

  return { holdId: parsed.holdId, holdUntilMs: parsed.holdUntilMs, scheduledFor: parsed.scheduledForISO }
}

async function fetchHoldById(holdId: string) {
  const res = await fetch(`/api/holds/${encodeURIComponent(holdId)}`, { method: 'GET' })
  const data = await safeJson(res)

  if (!res.ok || !data?.ok) {
    const msg = data?.error || `Failed to load hold (${res.status}).`
    const err: any = new Error(msg)
    err.status = res.status
    throw err
  }

  const parsed = parseHoldResponse(data)
  return {
    scheduledForISO: parsed.scheduledForISO,
    holdUntilMs: parsed.holdUntilMs,
    locationType: parsed.locationType ?? null,
  }
}

export default function BookingPanel(props: BookingPanelProps) {
  const {
    offeringId,
    professionalId,
    serviceId,
    mediaId = null,

    offersInSalon,
    offersMobile,
    salonPriceStartingAt = null,
    salonDurationMinutes = null,
    mobilePriceStartingAt = null,
    mobileDurationMinutes = null,
    defaultLocationType = null,

    isLoggedInAsClient,
    defaultScheduledForISO = null,
    serviceName = null,
    professionalName = null,
    locationLabel = null,
    professionalTimeZone = null,
    source,
  } = props

  const router = useRouter()
  const searchParams = useSearchParams()

  const holdIdFromUrl = (searchParams?.get('holdId') || '').trim() || null
  const scheduledForFromUrl = (searchParams?.get('scheduledFor') || '').trim() || null
  const holdUntilFromUrl = searchParams?.get('holdUntil') || ''
  const hasHold = Boolean(holdIdFromUrl)

  const openingId = (searchParams?.get('openingId') || '').trim() || null

  const requestedLocationFromUrl = normalizeLocationType(searchParams?.get('locationType'))
  const initialEffectiveLocationType = useMemo(() => {
    const requested = defaultLocationType ?? requestedLocationFromUrl
    return pickEffectiveLocationType({ requested, offersInSalon, offersMobile })
  }, [defaultLocationType, requestedLocationFromUrl, offersInSalon, offersMobile])

  const [locationType, setLocationType] = useState<ServiceLocationType | null>(initialEffectiveLocationType)

  useEffect(() => {
    setLocationType((prev) => {
      const next = pickEffectiveLocationType({
        requested: prev ?? initialEffectiveLocationType,
        offersInSalon,
        offersMobile,
      })
      return next
    })
  }, [offersInSalon, offersMobile, initialEffectiveLocationType])

  // -----------------------
  // Hold truth (server wins)
  // -----------------------
  const [scheduledForFromHold, setScheduledForFromHold] = useState<string | null>(null)

  // -----------------------
  // Hold countdown
  // -----------------------
  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const holdTickRef = useRef<number | null>(null)

  const [error, setError] = useState<string | null>(null)

  // Fast initial paint: if URL has a future holdUntil, show it immediately.
  useEffect(() => {
    const ms = Number(holdUntilFromUrl)
    if (Number.isFinite(ms) && ms > Date.now()) setHoldUntil(ms)
    else if (!holdIdFromUrl) setHoldUntil(null)
  }, [holdUntilFromUrl, holdIdFromUrl])

  // Hydrate hold from server (prevents URL editing from lying)
  useEffect(() => {
    let cancelled = false

    async function hydrateHold() {
      if (!holdIdFromUrl) {
        setScheduledForFromHold(null)
        return
      }

      try {
        const h = await fetchHoldById(holdIdFromUrl)
        if (cancelled) return

        setHoldUntil(h.holdUntilMs)
        setNowMs(Date.now())
        setScheduledForFromHold(h.scheduledForISO)

        // ✅ server-truth locationType wins if present
        if (h.locationType) {
          setLocationType(h.locationType)
        }

        // Normalize URL to server truth (only if different)
        if (typeof window !== 'undefined') {
          const qs = new URLSearchParams(searchParams?.toString() || '')
          const urlScheduled = (qs.get('scheduledFor') || '').trim() || null
          const urlHoldUntil = Number(qs.get('holdUntil') || '')
          const urlLoc = normalizeLocationType(qs.get('locationType'))

          const needsFix =
            urlScheduled !== h.scheduledForISO ||
            !(Number.isFinite(urlHoldUntil) && urlHoldUntil === h.holdUntilMs) ||
            (h.locationType && urlLoc !== h.locationType)

          if (needsFix) {
            qs.set('scheduledFor', h.scheduledForISO)
            qs.set('holdUntil', String(h.holdUntilMs))
            if (h.locationType) qs.set('locationType', h.locationType)
            router.replace(`${window.location.pathname}?${qs.toString()}`, { scroll: false })
          }
        }
      } catch (e: any) {
        if (cancelled) return
        setHoldUntil(null)
        setScheduledForFromHold(null)
        clearHoldParams(router, searchParams)
        setError(e?.message || 'Your hold is no longer valid. Please pick another time.')
      }
    }

    hydrateHold()
    return () => {
      cancelled = true
    }
  }, [holdIdFromUrl, router, searchParams])

  // Tick
  useEffect(() => {
    if (!holdUntil) return
    setNowMs(Date.now())

    if (holdTickRef.current) window.clearInterval(holdTickRef.current)
    holdTickRef.current = window.setInterval(() => setNowMs(Date.now()), 500)

    return () => {
      if (holdTickRef.current) window.clearInterval(holdTickRef.current)
      holdTickRef.current = null
    }
  }, [holdUntil])

  // Expire behavior
  useEffect(() => {
    if (!holdUntil) return
    if (nowMs < holdUntil) return

    setHoldUntil(null)
    setScheduledForFromHold(null)
    clearHoldParams(router, searchParams)
    setError('Your hold expired. Please pick another time.')
  }, [nowMs, holdUntil, router, searchParams])

  const holdLabel = useMemo(() => {
    if (!holdUntil) return null
    const remaining = clamp(holdUntil - nowMs, 0, 60 * 60 * 1000)
    const s = Math.floor(remaining / 1000)
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }, [holdUntil, nowMs])

  const holdUrgent = useMemo(() => {
    if (!holdUntil) return false
    return holdUntil - nowMs <= 2 * 60_000
  }, [holdUntil, nowMs])

  // submit/success/etc
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // waitlist
  const [waitlistBusy, setWaitlistBusy] = useState(false)
  const [waitlistSuccess, setWaitlistSuccess] = useState<string | null>(null)

  // availability
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [apiTimeZone, setApiTimeZone] = useState<string | null>(null)

  const proTz = professionalTimeZone || apiTimeZone || searchParams?.get('proTimeZone') || 'America/Los_Angeles'

  const viewerTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null
    } catch {
      return null
    }
  }, [])

  const mode = locationType
  const modeFields = useMemo(() => {
    if (!mode) return { price: 0, durationMinutes: 60 }
    return pickModeFields({
      locationType: mode,
      salonPriceStartingAt,
      salonDurationMinutes,
      mobilePriceStartingAt,
      mobileDurationMinutes,
    })
  }, [mode, salonPriceStartingAt, salonDurationMinutes, mobilePriceStartingAt, mobileDurationMinutes])

  const displayPrice = useMemo(() => {
    const n = Number(modeFields.price)
    if (!Number.isFinite(n)) return '0'
    return n.toFixed(0)
  }, [modeFields.price])

  const displayDuration = useMemo(() => {
    const d = Number(modeFields.durationMinutes)
    return Number.isFinite(d) && d > 0 ? d : 60
  }, [modeFields.durationMinutes])

  const normalizedSource = useMemo(() => String(source).toUpperCase(), [source])

  // Date picker window
  const todayYMDInProTz = useMemo(() => ymdFromDateInTz(new Date(), proTz), [proTz])
  const maxYMDInProTz = useMemo(() => ymdFromDateInTz(addDays(new Date(), 365), proTz), [proTz])

  // When a hold exists, lock to server-truth (fallback to URL only briefly)
  const lockedIso = useMemo(() => {
    if (!hasHold) return null
    return scheduledForFromHold || scheduledForFromUrl || null
  }, [hasHold, scheduledForFromHold, scheduledForFromUrl])

  const lockedYmdFromHold = useMemo(() => {
    if (!lockedIso) return null
    return isoToYMDInTz(lockedIso, proTz)
  }, [lockedIso, proTz])

  const initialMonthStartUtc = useMemo(() => {
    const ymd = lockedYmdFromHold || todayYMDInProTz
    return startOfMonthUtcFromYMD(ymd)
  }, [lockedYmdFromHold, todayYMDInProTz])

  const [monthStartUtc, setMonthStartUtc] = useState<Date>(initialMonthStartUtc)

  const [selectedYMD, setSelectedYMD] = useState<string | null>(() => {
    if (lockedYmdFromHold) return lockedYmdFromHold
    if (defaultScheduledForISO) {
      const ymd = isoToYMDInTz(defaultScheduledForISO, proTz)
      if (ymd) return ymd
    }
    return todayYMDInProTz
  })

  const [selectedSlotISO, setSelectedSlotISO] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedYMD) return
    setMonthStartUtc(startOfMonthUtcFromYMD(selectedYMD))
  }, [selectedYMD])

  const gridDays = useMemo(() => buildMonthGrid({ monthStartUtc, proTz }), [monthStartUtc, proTz])

  function ymdWithinRange(ymd: string) {
    return ymd >= todayYMDInProTz && ymd <= maxYMDInProTz
  }

  // Fetch day availability
  useEffect(() => {
    let cancelled = false

    async function loadDay() {
      setAvailabilityError(null)
      setAvailabilityBusy(true)

      try {
        if (!locationType) {
          setAvailableSlots([])
          setSelectedSlotISO(null)
          return
        }

        // Holds lock the time
        if (hasHold && lockedIso) {
          setAvailableSlots([])
          setSelectedSlotISO(lockedIso)
          setConfirmChecked(false)
          return
        }

        if (!selectedYMD) {
          setAvailableSlots([])
          setSelectedSlotISO(null)
          return
        }

        if (!ymdWithinRange(selectedYMD)) {
          setAvailableSlots([])
          setSelectedSlotISO(null)
          setAvailabilityError('That date is outside the booking window.')
          return
        }

        const qs = new URLSearchParams()
        qs.set('professionalId', professionalId)
        qs.set('serviceId', serviceId)
        qs.set('locationType', locationType)
        qs.set('date', selectedYMD)
        qs.set('stepMinutes', '5')
        qs.set('bufferMinutes', '10')

        const res = await fetch(`/api/availability/day?${qs.toString()}`)
        const data = await safeJson(res)

        if (!res.ok) throw new Error(data?.error || `Failed to load day availability (${res.status}).`)
        if (!data?.ok) throw new Error(data?.error || 'Failed to load day availability.')

        const tz = typeof data?.timeZone === 'string' ? data.timeZone : null
        const slots = Array.isArray(data?.slots) ? data.slots : []

        if (cancelled) return

        setApiTimeZone(tz)
        setAvailableSlots(slots)

        const preferred = defaultScheduledForISO
        if (preferred && slots.includes(preferred)) setSelectedSlotISO(preferred)
        else setSelectedSlotISO(slots[0] ?? null)

        setConfirmChecked(false)
      } catch (e: any) {
        if (cancelled) return
        setAvailableSlots([])
        setSelectedSlotISO(null)
        setAvailabilityError(e?.message || 'Failed to load day availability.')
      } finally {
        if (!cancelled) setAvailabilityBusy(false)
      }
    }

    loadDay()
    return () => {
      cancelled = true
    }
  }, [
    professionalId,
    serviceId,
    locationType,
    selectedYMD,
    hasHold,
    lockedIso,
    defaultScheduledForISO,
    todayYMDInProTz,
    maxYMDInProTz,
  ])

  const finalScheduledForISO = useMemo(
    () => (hasHold ? lockedIso : selectedSlotISO),
    [hasHold, lockedIso, selectedSlotISO],
  )

  const prettyTimePro = useMemo(() => {
    if (!finalScheduledForISO) return null
    return formatSlotLabel(finalScheduledForISO, proTz)
  }, [finalScheduledForISO, proTz])

  const viewerTimeLine = useMemo(() => {
    if (!finalScheduledForISO || !viewerTz) return null
    if (viewerTz === proTz) return null
    const utc = new Date(finalScheduledForISO)
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
  }, [finalScheduledForISO, viewerTz, proTz])

  const reviewLine = useMemo(() => {
    if (!prettyTimePro) return null
    const durLabel = `${displayDuration} min`
    const priceLabel = `Starting at $${displayPrice}`
    const where = locationLabel ? ` · ${locationLabel}` : ''
    const modeLabel = mode ? ` · ${mode === 'SALON' ? 'In-salon' : 'Mobile'}` : ''
    return `${prettyTimePro}${modeLabel} · ${durLabel} · ${priceLabel}${where} · ${proTz}`
  }, [prettyTimePro, displayDuration, displayPrice, locationLabel, proTz, mode])

  const missingHeldScheduledFor = Boolean(hasHold && !lockedIso)
  const missingLocationType = Boolean(!locationType)

  const canSubmit = Boolean(
    !missingHeldScheduledFor &&
      !missingLocationType &&
      confirmChecked &&
      !loading &&
      ['DISCOVERY', 'REQUESTED', 'AFTERCARE'].includes(normalizedSource) &&
      finalScheduledForISO,
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

    const desiredISO = lockedIso || finalScheduledForISO || new Date(Date.now() + 2 * 60 * 60_000).toISOString()

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

    if (!locationType) {
      setError('Missing booking location type. Please pick in-salon or mobile.')
      return
    }

    if (!confirmChecked) {
      setError('Please confirm the time works for you.')
      return
    }

    if (!finalScheduledForISO) {
      setError('Please pick an available time.')
      return
    }

    setLoading(true)
    try {
      // Ensure we have a hold (server-truth wins)
      let effectiveHoldId = holdIdFromUrl
      let effectiveScheduledFor = lockedIso

      if (!effectiveHoldId || !effectiveScheduledFor) {
        const h = await createHoldForSelectedSlot({
          offeringId,
          scheduledFor: finalScheduledForISO, // ✅ FIX
          locationType,
          router,
          searchParams,
          previousHoldId: holdIdFromUrl,
        })

        effectiveHoldId = h.holdId
        effectiveScheduledFor = h.scheduledFor
        setHoldUntil(h.holdUntilMs)
        setNowMs(Date.now())
        setScheduledForFromHold(h.scheduledFor)
      }

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId,
          scheduledFor: effectiveScheduledFor,
          holdId: effectiveHoldId,
          source: normalizedSource,
          locationType,
          mediaId: mediaId || null,
          openingId: openingId || null,
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
      setTimeout(() => router.push('/client'), 900)
    } catch (err: any) {
      setError(err?.message || 'Network error while creating booking.')
    } finally {
      setLoading(false)
    }
  }

  const calendarHref = createdBookingId ? `/api/calendar?bookingId=${encodeURIComponent(createdBookingId)}` : null
  const showWaitlistCTA = !success && (!hasHold || !holdUntil)
  const showModeToggle = Boolean(offersInSalon && offersMobile)

  const monthLabel = useMemo(() => {
    const d = new Date(monthStartUtc.getTime())
    return new Intl.DateTimeFormat(undefined, { timeZone: proTz, month: 'long', year: 'numeric' }).format(d)
  }, [monthStartUtc, proTz])

  function canGoPrevMonth() {
    const prev = addMonthsUtc(monthStartUtc, -1)
    const prevKey = ymdFromDateInTz(prev, proTz).slice(0, 7)
    const minKey = todayYMDInProTz.slice(0, 7)
    return prevKey >= minKey
  }

  function canGoNextMonth() {
    const next = addMonthsUtc(monthStartUtc, +1)
    const nextKey = ymdFromDateInTz(next, proTz).slice(0, 7)
    const maxKey = maxYMDInProTz.slice(0, 7)
    return nextKey <= maxKey
  }

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
            href="/client"
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
            {copied ? 'Link copied' : 'Copy booking link'}
          </button>

          <div style={{ fontSize: 12, color: '#6b7280' }}>You’ll thank yourself later.</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          {showModeToggle ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#111' }}>Appointment type</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={loading || hasHold}
                  onClick={() => {
                    if (hasHold) return
                    setLocationType('SALON')
                    setConfirmChecked(false)
                    setError(null)
                    clearHoldParams(router, searchParams)
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: locationType === 'SALON' ? '2px solid #111' : '1px solid #ddd',
                    background: '#fff',
                    fontWeight: 900,
                    cursor: loading || hasHold ? 'default' : 'pointer',
                    opacity: loading || hasHold ? 0.7 : 1,
                  }}
                >
                  In-salon
                </button>
                <button
                  type="button"
                  disabled={loading || hasHold}
                  onClick={() => {
                    if (hasHold) return
                    setLocationType('MOBILE')
                    setConfirmChecked(false)
                    setError(null)
                    clearHoldParams(router, searchParams)
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: locationType === 'MOBILE' ? '2px solid #111' : '1px solid #ddd',
                    background: '#fff',
                    fontWeight: 900,
                    cursor: loading || hasHold ? 'default' : 'pointer',
                    opacity: loading || hasHold ? 0.7 : 1,
                  }}
                >
                  Mobile
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Pricing is always <span style={{ fontWeight: 900 }}>starting at</span>.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#6b7280' }}>{locationType === 'MOBILE' ? 'Mobile appointment' : 'In-salon appointment'}</div>
          )}

          {!locationType ? (
            <div style={{ fontSize: 12, color: '#b91c1c' }}>
              This offering has no valid appointment type enabled. (No salon or mobile.)
            </div>
          ) : null}

          {/* Calendar */}
          <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, background: '#fff' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <button
                type="button"
                disabled={hasHold || !canGoPrevMonth()}
                onClick={() => setMonthStartUtc((d) => addMonthsUtc(d, -1))}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid #ddd',
                  background: '#fff',
                  fontWeight: 900,
                  cursor: hasHold ? 'default' : 'pointer',
                  opacity: hasHold || !canGoPrevMonth() ? 0.5 : 1,
                }}
                title={hasHold ? 'Date is locked while a hold exists.' : undefined}
              >
                ‹
              </button>

              <div style={{ fontWeight: 900, color: '#111' }}>{monthLabel}</div>

              <button
                type="button"
                disabled={hasHold || !canGoNextMonth()}
                onClick={() => setMonthStartUtc((d) => addMonthsUtc(d, +1))}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid #ddd',
                  background: '#fff',
                  fontWeight: 900,
                  cursor: hasHold ? 'default' : 'pointer',
                  opacity: hasHold || !canGoNextMonth() ? 0.5 : 1,
                }}
                title={hasHold ? 'Date is locked while a hold exists.' : undefined}
              >
                ›
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 6,
                marginBottom: 6,
                fontSize: 11,
                color: '#6b7280',
              }}
            >
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} style={{ textAlign: 'center', fontWeight: 900 }}>
                  {d}
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {gridDays.map((d) => {
                const isSelected = selectedYMD === d.ymd
                const disabled = hasHold || !ymdWithinRange(d.ymd)
                const dayNum = Number(d.ymd.slice(8, 10))
                return (
                  <button
                    key={d.ymd}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (hasHold) return
                      setSelectedYMD(d.ymd)
                      setConfirmChecked(false)
                      setError(null)
                      clearHoldParams(router, searchParams)
                    }}
                    style={{
                      padding: '10px 0',
                      borderRadius: 10,
                      border: isSelected ? '2px solid #111' : '1px solid #eee',
                      background: d.inMonth ? '#fff' : '#fafafa',
                      color: disabled ? '#9ca3af' : '#111',
                      fontWeight: 900,
                      cursor: disabled ? 'default' : 'pointer',
                      opacity: disabled ? 0.5 : 1,
                      textAlign: 'center',
                    }}
                    title={!ymdWithinRange(d.ymd) ? 'Outside booking window' : undefined}
                  >
                    {dayNum}
                  </button>
                )
              })}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
              Booking window: {todayYMDInProTz} → {maxYMDInProTz} (pro timezone)
            </div>
          </div>

          {/* Times */}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 14, color: '#111' }}>
              Select a time (timezone: <span style={{ fontWeight: 900 }}>{proTz}</span>)
            </div>

            {availabilityBusy ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>Loading availability…</div>
            ) : availabilityError ? (
              <div style={{ fontSize: 12, color: '#b91c1c' }}>{availabilityError}</div>
            ) : hasHold ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>Time is locked while the slot is held.</div>
            ) : availableSlots.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                No available times for this day. Pick another day or join the waitlist.
              </div>
            ) : (
              <select
                value={selectedSlotISO ?? ''}
                onChange={async (e) => {
                  if (hasHold) return
                  const iso = e.target.value || null
                  setSelectedSlotISO(iso)
                  setConfirmChecked(false)
                  setError(null)

                  if (!iso || !locationType) return

                  try {
                    const h = await createHoldForSelectedSlot({
                      offeringId,
                      scheduledFor: iso,
                      locationType,
                      router,
                      searchParams,
                      previousHoldId: holdIdFromUrl, // ✅ IMPORTANT
                    })
                    setHoldUntil(h.holdUntilMs)
                    setNowMs(Date.now())
                    setScheduledForFromHold(h.scheduledFor)
                  } catch (err: any) {
                    setError(err?.message || 'Failed to hold that time.')
                  }
                }}
                disabled={loading || hasHold}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  opacity: hasHold ? 0.7 : 1,
                }}
                title={hasHold ? 'This time is locked because a slot is being held.' : undefined}
              >
                {availableSlots.map((iso) => (
                  <option key={iso} value={iso}>
                    {formatSlotLabel(iso, proTz)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {missingHeldScheduledFor ? (
            <div style={{ fontSize: 12, color: '#b91c1c' }}>
              Hold is present but scheduledFor is missing. Go back and pick a slot again.
            </div>
          ) : null}

          {hasHold && (!holdIdFromUrl || !holdUntil) ? (
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
              onChange={(e) => setConfirmChecked(e.target.checked)}
              disabled={!finalScheduledForISO || loading || !locationType || (hasHold && (!holdIdFromUrl || !holdUntil))}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 900 }}>I’m confirming this time works for me</div>
              <div style={{ color: '#6b7280', marginTop: 2 }}>Tiny step. Big reduction in “oops, wrong day.”</div>
            </div>
          </label>

          {error ? <p style={{ color: '#b91c1c', fontSize: 13, margin: 0 }}>{error}</p> : null}
          {waitlistSuccess ? (
            <p style={{ color: '#166534', fontSize: 13, margin: 0, fontWeight: 800 }}>{waitlistSuccess}</p>
          ) : null}

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
            {loading ? 'Booking…' : holdLabel ? `Confirm now · Starting at $${displayPrice}` : `Confirm booking · Starting at $${displayPrice}`}
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

          {!isLoggedInAsClient ? (
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              You’ll need to log in as a client to complete your booking.
            </p>
          ) : null}

          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
            {holdLabel ? 'If the hold expires, the time might disappear.' : 'Pick a date, pick a time, and you’re done.'}
          </p>
        </form>
      )}
    </section>
  )
}
