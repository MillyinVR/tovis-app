// app/offerings/[id]/_bookingPanel/useBookingPanel.ts
'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { BookingPanelProps, ServiceLocationType, WaitlistPayload } from './types'

import { errorFromResponse } from './api'
import { redirectToLogin, normalizeLocationType, clearHoldParamsOnly } from './url'
import {
  clamp,
  addDays,
  ymdFromDateInTz,
  isoToYMDInTz,
  startOfMonthUtcFromYMD,
  addMonthsUtc,
  buildMonthGrid,
  formatSlotLabel,
  defaultWaitlistDesiredISO,
} from './time'
import { clearHoldAndParams, createHoldForSelectedSlot, fetchHoldById } from './holds'
import { fetchDayAvailability } from './availability'
import { postWaitlist } from './waitlist'

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

function isHoldish409(res: Response, data: any) {
  if (res.status !== 409) return false
  const code = String(data?.code || '').toUpperCase()
  const msg = String(data?.error || '').toLowerCase()
  return code.startsWith('HOLD_') || msg.includes('hold')
}

export function useBookingPanel(props: BookingPanelProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL state (single source for "there is a hold")
  const holdIdFromUrl = (searchParams?.get('holdId') || '').trim() || null
  const scheduledForFromUrl = (searchParams?.get('scheduledFor') || '').trim() || null
  const holdUntilFromUrl = searchParams?.get('holdUntil') || ''
  const hasHold = Boolean(holdIdFromUrl)

  // optional flow signals
  const openingId = (searchParams?.get('openingId') || '').trim() || null
  const aftercareTokenFromUrl = (searchParams?.get('token') || '').trim() || null
  const rebookOfBookingIdFromUrl = (searchParams?.get('rebookOfBookingId') || '').trim() || null

  const requestedLocationFromUrl = normalizeLocationType(searchParams?.get('locationType'))

  const initialEffectiveLocationType = useMemo(() => {
    const requested = props.defaultLocationType ?? requestedLocationFromUrl
    return pickEffectiveLocationType({
      requested,
      offersInSalon: props.offersInSalon,
      offersMobile: props.offersMobile,
    })
  }, [props.defaultLocationType, requestedLocationFromUrl, props.offersInSalon, props.offersMobile])

  const [locationType, setLocationType] = useState<ServiceLocationType | null>(initialEffectiveLocationType)

  useEffect(() => {
    setLocationType((prev) => {
      const next = pickEffectiveLocationType({
        requested: prev ?? initialEffectiveLocationType,
        offersInSalon: props.offersInSalon,
        offersMobile: props.offersMobile,
      })
      return next
    })
  }, [props.offersInSalon, props.offersMobile, initialEffectiveLocationType])

  const [scheduledForFromHold, setScheduledForFromHold] = useState<string | null>(null)
  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const holdTickRef = useRef<number | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  const [success, setSuccess] = useState<string | null>(null)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [waitlistBusy, setWaitlistBusy] = useState(false)
  const [waitlistSuccess, setWaitlistSuccess] = useState<string | null>(null)

  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [availableSlots, setAvailableSlots] = useState<string[]>([])
  const [apiTimeZone, setApiTimeZone] = useState<string | null>(null)

  // Source-of-truth timezone for slot display.
  const proTz =
    props.professionalTimeZone ||
    apiTimeZone ||
    searchParams?.get('proTimeZone') ||
    'America/Los_Angeles'

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
      salonPriceStartingAt: props.salonPriceStartingAt ?? null,
      salonDurationMinutes: props.salonDurationMinutes ?? null,
      mobilePriceStartingAt: props.mobilePriceStartingAt ?? null,
      mobileDurationMinutes: props.mobileDurationMinutes ?? null,
    })
  }, [
    mode,
    props.salonPriceStartingAt,
    props.salonDurationMinutes,
    props.mobilePriceStartingAt,
    props.mobileDurationMinutes,
  ])

  const displayPrice = useMemo(() => {
    const n = Number(modeFields.price)
    if (!Number.isFinite(n)) return '0'
    return n.toFixed(0)
  }, [modeFields.price])

  const displayDuration = useMemo(() => {
    const d = Number(modeFields.durationMinutes)
    return Number.isFinite(d) && d > 0 ? d : 60
  }, [modeFields.durationMinutes])

  const normalizedSource = useMemo(() => String(props.source).trim().toUpperCase(), [props.source])

  const todayYMDInProTz = useMemo(() => ymdFromDateInTz(new Date(), proTz), [proTz])
  const maxYMDInProTz = useMemo(() => ymdFromDateInTz(addDays(new Date(), 365), proTz), [proTz])

  // When a hold exists, it locks scheduledFor. Prefer server-hydrated state.
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
    if (props.defaultScheduledForISO) {
      const ymd = isoToYMDInTz(props.defaultScheduledForISO, proTz)
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

  async function clearAnyHold(reason?: string) {
    if (!holdIdFromUrl) {
      // still clear URL params if stray
      clearHoldParamsOnly(router, searchParams)
      setHoldUntil(null)
      setScheduledForFromHold(null)
      return
    }

    try {
      await clearHoldAndParams({ holdId: holdIdFromUrl, router, searchParams })
    } catch {
      // ignore
    } finally {
      clearHoldParamsOnly(router, searchParams)
      setHoldUntil(null)
      setScheduledForFromHold(null)
      if (reason) setError(reason)
    }
  }

  async function refreshAvailabilityForCurrentSelection() {
    // Triggers the availability effect by touching selectedYMD
    setSelectedYMD((prev) => (prev ? String(prev) : prev))
    router.refresh()
  }

  // hydrate holdUntil from URL if present
  useEffect(() => {
    const ms = Number(holdUntilFromUrl)
    if (Number.isFinite(ms) && ms > Date.now()) setHoldUntil(ms)
    else if (!holdIdFromUrl) setHoldUntil(null)
  }, [holdUntilFromUrl, holdIdFromUrl])

  // fetch hold (server truth)
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

        if (h.missing) {
          setHoldUntil(null)
          setScheduledForFromHold(null)
          clearHoldParamsOnly(router, searchParams)
          return
        }

        setHoldUntil(h.holdUntilMs)
        setNowMs(Date.now())
        setScheduledForFromHold(h.scheduledForISO)

        // Hold dictates locationType. This is important.
        if (h.locationType) setLocationType(h.locationType)
      } catch (e: any) {
        if (cancelled) return
        setHoldUntil(null)
        setScheduledForFromHold(null)
        await clearAnyHold('Your hold is no longer valid. Please pick another time.')
      }
    }

    void hydrateHold()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdIdFromUrl])

  // tick while hold exists
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

  // expire behavior
  useEffect(() => {
    if (!holdUntil) return
    if (nowMs < holdUntil) return
    void clearAnyHold('Your hold expired. Please pick another time.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMs, holdUntil])

  // best-effort cleanup on unmount if booking wasn't created
  useEffect(() => {
    return () => {
      if (createdBookingId) return
      if (!holdIdFromUrl) return
      const ms = Number(holdUntilFromUrl)
      if (!Number.isFinite(ms) || ms <= Date.now()) return
      void fetch(`/api/holds/${encodeURIComponent(holdIdFromUrl)}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [createdBookingId, holdIdFromUrl, holdUntilFromUrl])

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

  // Load day availability
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

        // If hold exists, lock UI selection to the held ISO.
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

        const { timeZone, slots } = await fetchDayAvailability({
          professionalId: props.professionalId,
          serviceId: props.serviceId,
          locationType,
          ymd: selectedYMD,
        })

        if (cancelled) return

        setApiTimeZone(timeZone)
        setAvailableSlots(slots)

        const preferred = props.defaultScheduledForISO
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

    void loadDay()
    return () => {
      cancelled = true
    }
  }, [
    props.professionalId,
    props.serviceId,
    locationType,
    selectedYMD,
    hasHold,
    lockedIso,
    props.defaultScheduledForISO,
    todayYMDInProTz,
    maxYMDInProTz,
  ])

  const finalScheduledForISO = useMemo(() => (hasHold ? lockedIso : selectedSlotISO), [hasHold, lockedIso, selectedSlotISO])

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
    const where = props.locationLabel ? ` · ${props.locationLabel}` : ''
    const modeLabel = mode ? ` · ${mode === 'SALON' ? 'In-salon' : 'Mobile'}` : ''
    return `${prettyTimePro}${modeLabel} · ${durLabel} · ${priceLabel}${where} · ${proTz}`
  }, [prettyTimePro, displayDuration, displayPrice, props.locationLabel, proTz, mode])

  const missingHeldScheduledFor = Boolean(hasHold && !lockedIso)
  const missingLocationType = Boolean(!locationType)
  const canSubmit = Boolean(!missingHeldScheduledFor && !missingLocationType && confirmChecked && !loading && finalScheduledForISO)

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

    if (!props.isLoggedInAsClient) {
      redirectToLogin(router, 'waitlist')
      return
    }

    const desiredISO = lockedIso || finalScheduledForISO || props.defaultScheduledForISO || defaultWaitlistDesiredISO(proTz)

    const payload: WaitlistPayload = {
      professionalId: props.professionalId,
      serviceId: props.serviceId,
      mediaId: props.mediaId || null,
      desiredFor: desiredISO || null,
      flexibilityMinutes: 60,
      preferredTimeBucket: null,
      notes: null,
    }

    setWaitlistBusy(true)
    try {
      await postWaitlist(payload)
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
    if (loading || submittingRef.current) return

    setError(null)
    setSuccess(null)
    setWaitlistSuccess(null)

    if (!props.isLoggedInAsClient) {
      redirectToLogin(router, 'book')
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

    submittingRef.current = true
    setLoading(true)

    const holdUntilFromUrlMs = (() => {
      const n = Number(holdUntilFromUrl)
      return Number.isFinite(n) ? n : null
    })()
    const holdUntilMs = holdUntil ?? holdUntilFromUrlMs

    const now = Date.now()
    const hasValidHold = Boolean(holdIdFromUrl) && Boolean(lockedIso) && holdUntilMs != null && holdUntilMs > now

    let effectiveHoldId: string | null = holdIdFromUrl

    try {
      if (!hasValidHold) {
        const h = await createHoldForSelectedSlot({
          offeringId: props.offeringId,
          scheduledFor: finalScheduledForISO,
          locationType,
          router,
          searchParams,
          previousHoldId: holdIdFromUrl,
        })
        effectiveHoldId = h.holdId
        setHoldUntil(h.holdUntilMs)
        setNowMs(Date.now())
        setScheduledForFromHold(h.scheduledFor)
      }

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId: props.offeringId,
          holdId: effectiveHoldId,
          scheduledFor: finalScheduledForISO, // ignored by server
          locationType,
          source: normalizedSource,

          mediaId: props.mediaId || null,
          openingId: openingId || undefined,
          aftercareToken: aftercareTokenFromUrl || undefined,
          rebookOfBookingId: rebookOfBookingIdFromUrl || undefined,
        }),
      })

      const data = await (await import('./api')).safeJson(res)

      if (res.status === 401) {
        redirectToLogin(router, 'book')
        return
      }

      if (!res.ok || !data?.ok) {
        // Auto-recover from hold issues instead of nuking the user's hope.
        if (isHoldish409(res, data)) {
          await clearAnyHold('That time changed. Please pick a slot again.')
          setSelectedSlotISO(null)
          setConfirmChecked(false)
          await refreshAvailabilityForCurrentSelection()
          return
        }

        // Normal failures: clear hold, show error
        await clearHoldAndParams({ holdId: effectiveHoldId || null, router, searchParams }).catch(() => {})
        setError(errorFromResponse(res, data))
        return
      }

      const bookingId = data?.booking?.id ? String(data.booking.id) : null
      setCreatedBookingId(bookingId)

      clearHoldParamsOnly(router, searchParams)
      setHoldUntil(null)
      setScheduledForFromHold(null)

      setSuccess('Booked. You’re officially on the calendar.')
      router.refresh()

      if (props.redirectOnSuccess !== false) {
        setTimeout(() => router.push('/client'), 700)
      }
    } catch (err: any) {
      await clearHoldAndParams({ holdId: effectiveHoldId || null, router, searchParams }).catch(() => {})
      setError(err?.message || 'Network error while creating booking.')
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  const calendarHref = createdBookingId ? `/api/calendar?bookingId=${encodeURIComponent(createdBookingId)}` : null
  const showWaitlistCTA = !success && (!hasHold || !holdUntil)
  const showModeToggle = Boolean(props.offersInSalon && props.offersMobile)

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

  async function onPickDate(ymd: string) {
    // Date change should always invalidate an existing hold.
    if (hasHold) await clearAnyHold()
    setSelectedYMD(ymd)
    setSelectedSlotISO(null)
    setConfirmChecked(false)
    setError(null)
  }

  async function onChangeSlot(iso: string | null) {
    // Slot change should always invalidate an existing hold.
    if (hasHold) await clearAnyHold()
    setSelectedSlotISO(iso)
    setConfirmChecked(false)
    setError(null)
    if (!iso || !locationType) return

    try {
      const h = await createHoldForSelectedSlot({
        offeringId: props.offeringId,
        scheduledFor: iso,
        locationType,
        router,
        searchParams,
        previousHoldId: holdIdFromUrl,
      })
      setHoldUntil(h.holdUntilMs)
      setNowMs(Date.now())
      setScheduledForFromHold(h.scheduledFor)
    } catch (err: any) {
      setError(err?.message || 'Failed to hold that time.')
    }
  }

  async function onSwitchMode(next: ServiceLocationType) {
    // Mode switch must clear old hold, because the server requires hold.locationType === body.locationType.
    if (hasHold) await clearAnyHold()
    setLocationType(next)
    setSelectedSlotISO(null)
    setConfirmChecked(false)
    setError(null)
  }

  return {
    proTz,
    viewerTz,
    hasHold,
    holdLabel,
    holdUrgent,
    locationType,
    mode,
    displayPrice,
    displayDuration,

    todayYMD: todayYMDInProTz,
    maxYMD: maxYMDInProTz,

    monthStartUtc,
    setMonthStartUtc,
    monthLabel,
    gridDays,
    selectedYMD,
    selectedSlotISO,
    availableSlots,
    availabilityBusy,
    availabilityError,

    prettyTimePro,
    viewerTimeLine,
    reviewLine,

    error,
    loading,
    success,
    confirmChecked,
    createdBookingId,
    copied,

    waitlistBusy,
    waitlistSuccess,

    missingHeldScheduledFor,
    canSubmit,
    showWaitlistCTA,
    showModeToggle,
    calendarHref,

    setConfirmChecked,
    copyShareLink,
    joinWaitlist,
    handleSubmit,
    onPickDate,
    onChangeSlot,
    onSwitchMode,
    canGoPrevMonth,
    canGoNextMonth,
    addMonthsUtc,
    formatSlotLabel,
    ymdWithinRange,
    setError,
  }
}
