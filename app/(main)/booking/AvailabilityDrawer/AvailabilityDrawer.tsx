// app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx 

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  AvailabilityOffering,
  AvailabilitySummaryResponse,
  BookingSource,
  DrawerContext,
  SelectedHold,
  ServiceLocationType,
} from './types'

import { STICKY_CTA_H } from './constants'
import DrawerShell from './components/DrawerShell'
import ProCard from './components/ProCard'
import AppointmentTypeToggle from './components/AppointmentTypeToggle'
import ServiceContextCard from './components/ServiceContextCard'
import SlotChips from './components/SlotChips'
import WaitlistPanel from './components/WaitlistPanel'
import OtherPros from './components/OtherPros'
import StickyCTA from './components/StickyCTA'
import DebugPanel from './components/DebugPanel'
import DayScroller from './components/DayScroller'
import MobileAddressSelector from './components/MobileAddressSelector'
import ClientAddressCreateModal from './components/ClientAddressCreateModal'

import { safeJson } from './utils/safeJson'
import { redirectToLogin } from './utils/authRedirect'
import { parseHoldResponse, deleteHoldById } from './utils/hold'
import { useAvailability } from './hooks/useAvailability'
import { useHoldTimer } from './hooks/useHoldTimer'
import { useDebugFlag } from './hooks/useDebugFlag'
import { useDaySlots } from './hooks/useDaySlots'
import { useMobileAddresses } from './hooks/useMobileAddresses'
import { shouldPrefetchForSelectedIndex } from './utils/availabilityWindow'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'
import { dateTimeLocalToUtcIso } from '@/lib/bookingDateTimeClient'

const FALLBACK_TZ = 'UTC' as const
const MOBILE_ADDRESS_REQUIRED_MESSAGE =
  'Select a saved service address before viewing mobile availability.'

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

const EMPTY_DAYS: Array<{ date: string; slotCount: number }> = []

type ConfirmHoldSelection = {
  holdId: string
  offeringId: string
  locationType: ServiceLocationType
  slotISO: string
  bookingSource: BookingSource
  mediaId: string | null
}
type BookingErrorUiAction =
  | 'REFRESH_AVAILABILITY'
  | 'PICK_NEW_SLOT'
  | 'ADD_SERVICE_ADDRESS'
  | 'FIX_LOCATION_CONFIG'
  | 'FIX_OFFERING_CONFIG'
  | 'FIX_WORKING_HOURS'
  | 'CONTACT_SUPPORT'
  | 'NONE'

type ParsedBookingApiError = {
  status: number
  code: string | null
  message: string | null
  retryable: boolean | null
  uiAction: BookingErrorUiAction | null
  developerMessage: string | null
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function parseBookingApiError(
  raw: unknown,
  status: number,
): ParsedBookingApiError | null {
  if (!isRecord(raw)) return null

  const topLevelError =
    typeof raw.error === 'string' && raw.error.trim() ? raw.error.trim() : null

  const code =
    typeof raw.code === 'string' && raw.code.trim() ? raw.code.trim() : null

  const retryable =
    typeof raw.retryable === 'boolean' ? raw.retryable : null

  const uiAction =
    raw.uiAction === 'REFRESH_AVAILABILITY' ||
    raw.uiAction === 'PICK_NEW_SLOT' ||
    raw.uiAction === 'ADD_SERVICE_ADDRESS' ||
    raw.uiAction === 'FIX_LOCATION_CONFIG' ||
    raw.uiAction === 'FIX_OFFERING_CONFIG' ||
    raw.uiAction === 'FIX_WORKING_HOURS' ||
    raw.uiAction === 'CONTACT_SUPPORT' ||
    raw.uiAction === 'NONE'
      ? raw.uiAction
      : null

  const developerMessage =
    typeof raw.message === 'string' && raw.message.trim()
      ? raw.message.trim()
      : null

  return {
    status,
    code,
    message: topLevelError,
    retryable,
    uiAction,
    developerMessage,
  }
}

function getBookingUiMessage(
  parsed: ParsedBookingApiError | null,
  fallback: string,
): string {
  if (!parsed) return fallback

  switch (parsed.code) {
    case 'CLIENT_SERVICE_ADDRESS_REQUIRED':
    case 'CLIENT_SERVICE_ADDRESS_INVALID':
    case 'HOLD_MISSING_CLIENT_ADDRESS':
      return parsed.message ?? 'Choose a mobile service address before continuing.'

    case 'HOLD_EXPIRED':
      return parsed.message ?? 'That hold expired. Please pick a new slot.'

    case 'HOLD_NOT_FOUND':
    case 'HOLD_MISMATCH':
    case 'TIME_BLOCKED':
    case 'TIME_BOOKED':
    case 'TIME_HELD':
    case 'TIME_NOT_AVAILABLE':
    case 'STEP_MISMATCH':
    case 'OUTSIDE_WORKING_HOURS':
    case 'ADVANCE_NOTICE_REQUIRED':
    case 'MAX_DAYS_AHEAD_EXCEEDED':
      return parsed.message ?? fallback

    default:
      return parsed.message ?? fallback
  }
}

function periodOfHour(h: number): Period {
  if (h < 12) return 'MORNING'
  if (h < 17) return 'AFTERNOON'
  return 'EVENING'
}

function getViewerTimeZoneClient(): string {
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    return sanitizeTimeZone(raw, FALLBACK_TZ)
  } catch {
    return FALLBACK_TZ
  }
}

function fmtInTz(isoUtc: string, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, FALLBACK_TZ)
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return isoUtc

  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function fmtSelectedLine(isoUtc: string, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, FALLBACK_TZ)
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return isoUtc

  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function hourInTz(isoUtc: string, timeZone: string): number | null {
  const tz = sanitizeTimeZone(timeZone, FALLBACK_TZ)
  const d = new Date(isoUtc)
  if (Number.isNaN(d.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d)

  const hh = parts.find((p) => p.type === 'hour')?.value
  const n = hh ? Number(hh) : NaN
  return Number.isFinite(n) ? n : null
}

function ymdInTz(timeZone: string): string | null {
  const tz = sanitizeTimeZone(timeZone, FALLBACK_TZ)
  const d = new Date()

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (!y || !m || !day) return null
  return `${y}-${m}-${day}`
}

function resolveBookingSource(context: DrawerContext): BookingSource {
  if (context.source) return context.source
  if (context.mediaId) return 'DISCOVERY'
  return 'REQUESTED'
}

type AvailabilitySummaryOk = Extract<
  AvailabilitySummaryResponse,
  { ok: true; mode: 'SUMMARY' }
>

function isSummary(
  data: AvailabilitySummaryResponse | null,
): data is AvailabilitySummaryOk {
  return Boolean(data && data.ok === true && data.mode === 'SUMMARY')
}

const FALLBACK_OFFERING: AvailabilityOffering = {
  id: '',
  offersInSalon: true,
  offersMobile: true,
  salonDurationMinutes: null,
  mobileDurationMinutes: null,
  salonPriceStartingAt: null,
  mobilePriceStartingAt: null,
}

function resolveAppointmentTimeZone(args: {
  summaryTimeZone?: unknown
  primaryProTimeZone?: unknown
}) {
  const s =
    typeof args.summaryTimeZone === 'string'
      ? args.summaryTimeZone.trim()
      : ''
  if (s && isValidIanaTimeZone(s)) return s

  const p =
    typeof args.primaryProTimeZone === 'string'
      ? args.primaryProTimeZone.trim()
      : ''
  if (p && isValidIanaTimeZone(p)) return p

  return FALLBACK_TZ
}

function buildDayScrollerModel(
  days: Array<{ date: string; slotCount: number }>,
  appointmentTz: string,
) {
  return days.map((d) => {
    let anchor = new Date(`${d.date}T12:00:00.000Z`)

    try {
      anchor = new Date(
        dateTimeLocalToUtcIso(`${d.date}T12:00:00`, appointmentTz),
      )
    } catch {
      // fail-soft for display only
    }

    const top = new Intl.DateTimeFormat(undefined, {
      timeZone: appointmentTz,
      weekday: 'short',
    }).format(anchor)

    const bottom = new Intl.DateTimeFormat(undefined, {
      timeZone: appointmentTz,
      day: '2-digit',
    }).format(anchor)

    return { ymd: d.date, labelTop: top, labelBottom: bottom }
  })
}

function fallbackAllowedMode(args: {
  salon: boolean
  mobile: boolean
}): ServiceLocationType {
  if (args.mobile && !args.salon) return 'MOBILE'
  return 'SALON'
}

export default function AvailabilityDrawer(props: {
  open: boolean
  onClose: () => void
  context: DrawerContext
  onConfirmHold?: (selection: ConfirmHoldSelection) => void | Promise<void>
}) {

  const { open, onClose, context, onConfirmHold } = props

  const router = useRouter()
  const debug = useDebugFlag()

  const [viewerTz, setViewerTz] = useState<string>(FALLBACK_TZ)
  const [locationType, setLocationType] = useState<ServiceLocationType | null>(
    null,
  )
  const [selected, setSelected] = useState<SelectedHold | null>(null)
  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const [holding, setHolding] = useState(false)
  const [selectedDayYMD, setSelectedDayYMD] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('AFTERNOON')
  const [otherProsRequested, setOtherProsRequested] = useState(false)
  const [slotRetryKey, setSlotRetryKey] = useState(0)

  const otherProsRef = useRef<HTMLDivElement | null>(null)
  const selectedHoldIdRef = useRef<string | null>(null)

  useEffect(() => {
    setViewerTz(getViewerTimeZoneClient())
  }, [])

  useEffect(() => {
    selectedHoldIdRef.current = selected?.holdId ?? null
  }, [selected?.holdId])

  const requestedMobileAddressGate = locationType === 'MOBILE'

  const {
    mobileAddresses,
    loadingMobileAddresses,
    mobileAddressesError,
    selectedClientAddressId,
    setSelectedClientAddressId,
    addressCreateOpen,
    setAddressCreateOpen,
    handleAddressSaved,
    resetMobileAddressState,
  } = useMobileAddresses({
    open,
    mobileAddressGateRequested: requestedMobileAddressGate,
    holding,
  })

  const {
    loading,
    loadingMore,
    refreshing,
    error: availabilityError,
    data,
    hasMoreDays,
    loadMore,
    setError,
    refresh,
  } = useAvailability(
    open,
    context,
    locationType,
    selectedClientAddressId,
    true,
  )

  const summary = isSummary(data) ? data : null
  const primary = summary?.primaryPro ?? null
  const others = summary?.otherPros ?? []
  const days = summary?.availableDays ?? EMPTY_DAYS
  const offering: AvailabilityOffering = summary?.offering ?? FALLBACK_OFFERING

  const forcedMobileOnlyGate =
    !summary && availabilityError === MOBILE_ADDRESS_REQUIRED_MESSAGE

  const allowed = useMemo(() => {
    if (summary?.offering) {
      return {
        salon: Boolean(summary.offering.offersInSalon),
        mobile: Boolean(summary.offering.offersMobile),
      }
    }

    if (forcedMobileOnlyGate) {
      return {
        salon: false,
        mobile: true,
      }
    }

    return {
      salon: Boolean(FALLBACK_OFFERING.offersInSalon),
      mobile: Boolean(FALLBACK_OFFERING.offersMobile),
    }
  }, [summary?.offering, forcedMobileOnlyGate])

  const mobileAddressGateRequested =
    locationType === 'MOBILE' ||
    summary?.locationType === 'MOBILE' ||
    forcedMobileOnlyGate

  const activeLocationType: ServiceLocationType = mobileAddressGateRequested
    ? 'MOBILE'
    : locationType ?? summary?.locationType ?? fallbackAllowedMode(allowed)

  const { label: holdLabel, urgent: holdUrgent, expired: holdExpired } =
    useHoldTimer(holdUntil)

  const appointmentTz = useMemo(() => {
    const resolved = resolveAppointmentTimeZone({
      summaryTimeZone: summary?.timeZone,
      primaryProTimeZone: primary?.timeZone,
    })
    return sanitizeTimeZone(resolved, FALLBACK_TZ)
  }, [summary?.timeZone, primary?.timeZone])

  const showLocalHint = viewerTz !== appointmentTz
  const effectiveServiceId = summary?.serviceId ?? context.serviceId ?? null
  const bookingSource = resolveBookingSource(context)

  const canWaitlist = Boolean(
    summary?.waitlistSupported && context.professionalId && effectiveServiceId,
  )

  const viewProServicesHref = primary
    ? `/professionals/${encodeURIComponent(primary.id)}?tab=services`
    : '/looks'

  const statusLine = useMemo(() => {
    if (!effectiveServiceId) return 'No service linked yet.'
    return 'Matched to this service'
  }, [effectiveServiceId])

  const resolvedOfferingId = useMemo(() => {
    if (summary?.offering?.id) return summary.offering.id
    return context.offeringId ?? null
  }, [summary?.offering?.id, context.offeringId])

  const locationIdByPro = useMemo(() => {
    const map: Record<string, string> = {}
    if (!summary) return map

    map[summary.primaryPro.id] = summary.locationId
    for (const p of others) {
      map[p.id] = p.locationId
    }

    return map
  }, [summary, others])

  const daysKey = useMemo(() => {
    if (!days.length) return ''
    return days.map((d) => `${d.date}:${d.slotCount}`).join('|')
  }, [days])

  const dayScrollerDays = useMemo(
    () => buildDayScrollerModel(days, appointmentTz),
    [days, daysKey, appointmentTz],
  )

  const {
    primarySlots,
    otherSlots,
    loadingPrimarySlots,
    loadingOtherSlots,
    clearDaySlots,
    clearDaySlotCache,
    loadOtherSlots,
  } = useDaySlots({
    open,
    summary,
    selectedDayYMD,
    activeLocationType,
    effectiveServiceId,
    selectedClientAddressId,
    debug,
    holding,
    retryKey: slotRetryKey,
    setError,
  })

  const noPrimarySlots = Boolean(primary && primarySlots.length === 0)
  const hasOtherPros = others.length > 0
  const shouldRenderOtherPros = hasOtherPros && otherProsRequested

  const hardResetUi = useCallback(
    async (args?: { deleteHold?: boolean }) => {
      const holdId = selectedHoldIdRef.current

      if (args?.deleteHold && holdId) {
        await deleteHoldById(holdId).catch(() => {})
      }

      setSelected(null)
      setHoldUntil(null)
      setHolding(false)
      setError(null)
    },
    [setError],
  )

  const resetForLocationModeChange = useCallback(
    async (next: ServiceLocationType) => {
      if (next === activeLocationType) return

      await hardResetUi({ deleteHold: true })
      setLocationType(next)
      setSelectedDayYMD(null)
      setOtherProsRequested(false)
      clearDaySlots()
      clearDaySlotCache()
      setError(null)
    },
    [
      activeLocationType,
      hardResetUi,
      clearDaySlots,
      clearDaySlotCache,
      setError,
    ],
  )

  const requestOtherPros = useCallback(
    (options?: { scroll?: boolean; forceRefresh?: boolean }) => {
      if (!open) return
      if (!summary) return
      if (!selectedDayYMD) return
      if (!hasOtherPros) return

      setOtherProsRequested(true)
      void loadOtherSlots({ forceRefresh: options?.forceRefresh })

      if (options?.scroll) {
        window.requestAnimationFrame(() => {
          otherProsRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
        })
      }
    },
    [open, summary, selectedDayYMD, hasOtherPros, loadOtherSlots],
  )

    const maybeLoadMoreDays = useCallback(() => {
    if (!hasMoreDays) return
    if (loading || loadingMore || refreshing) return
    void loadMore()
  }, [hasMoreDays, loadMore, loading, loadingMore, refreshing])

  useEffect(() => {
    if (!open) return
    if (!summary) return
    if (!selectedDayYMD) return
    if (!hasMoreDays) return

    const selectedIndex = days.findIndex((d) => d.date === selectedDayYMD)
    if (
      shouldPrefetchForSelectedIndex({
        selectedIndex,
        loadedCount: days.length,
      })
    ) {
      maybeLoadMoreDays()
    }
  }, [open, summary, selectedDayYMD, hasMoreDays, days, maybeLoadMoreDays])

  useEffect(() => {
    if (!open) return
    if (!hasOtherPros) {
      setOtherProsRequested(false)
    }
  }, [open, hasOtherPros])

  useEffect(() => {
    if (!open) return
    if (!otherProsRequested) return
    if (!hasOtherPros) return
    if (activeLocationType === 'MOBILE' && !selectedClientAddressId) return

    void loadOtherSlots()
  }, [
    open,
    otherProsRequested,
    hasOtherPros,
    loadOtherSlots,
    activeLocationType,
    selectedClientAddressId,
  ])

  useEffect(() => {
    if (!open) return
    if (!forcedMobileOnlyGate) return
    if (locationType === 'MOBILE') return

    setLocationType('MOBILE')
  }, [open, forcedMobileOnlyGate, locationType])

  useEffect(() => {
    if (!open) return
    if (!mobileAddressGateRequested) return

    void hardResetUi({ deleteHold: true })
    setError(null)

    if (!selectedClientAddressId) {
      setOtherProsRequested(false)
      clearDaySlots()
    }
  }, [
    open,
    mobileAddressGateRequested,
    selectedClientAddressId,
    hardResetUi,
    clearDaySlots,
    setError,
  ])

  useEffect(() => {
    if (!open) return

    setSelectedDayYMD(null)
    setPeriod('AFTERNOON')
    setOtherProsRequested(false)
    clearDaySlots()
    clearDaySlotCache()
    resetMobileAddressState()

    void hardResetUi({ deleteHold: true })
  }, [
    open,
    context.mediaId,
    context.professionalId,
    context.serviceId,
    context.offeringId,
    context.source,
    clearDaySlots,
    clearDaySlotCache,
    resetMobileAddressState,
    hardResetUi,
  ])

  useEffect(() => {
    if (!open) return
    if (!summary) return

    if (allowed.salon && allowed.mobile) return

    if (allowed.salon && !allowed.mobile && activeLocationType !== 'SALON') {
      void resetForLocationModeChange('SALON')
      return
    }

    if (!allowed.salon && allowed.mobile && activeLocationType !== 'MOBILE') {
      void resetForLocationModeChange('MOBILE')
    }
  }, [
    open,
    summary,
    allowed.salon,
    allowed.mobile,
    activeLocationType,
    resetForLocationModeChange,
  ])

  useEffect(() => {
    if (!open) return

    const fallback = ymdInTz(appointmentTz)
    const first = days[0]?.date ?? null

    setSelectedDayYMD((cur) => {
      const nextBase = first ?? fallback
      if (!nextBase) return cur ?? null
      if (!cur) return nextBase

      if (days.length > 0) {
        const exists = days.some((d) => d.date === cur)
        return exists ? cur : nextBase
      }

      return cur
    })
  }, [open, appointmentTz, daysKey, days])

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      void hardResetUi({ deleteHold: true })
      onClose()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, hardResetUi, onClose])

  useEffect(() => {
    if (!open) return

    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!holdExpired) return
    setHoldUntil(null)
    setSelected(null)
    setError('That hold expired. Please pick a new slot.')
  }, [holdExpired, setError])

  useEffect(() => {
    if (!open) return
    if (!primarySlots.length) return

    const counts: Record<Period, number> = {
      MORNING: 0,
      AFTERNOON: 0,
      EVENING: 0,
    }

    for (const iso of primarySlots) {
      const h = hourInTz(iso, appointmentTz)
      if (h == null) continue
      counts[periodOfHour(h)] += 1
    }

    if (counts[period] > 0) return

    const preferred: Period[] = ['AFTERNOON', 'MORNING', 'EVENING']
    const next = preferred.find((p) => counts[p] > 0)
    if (next && next !== period) {
      setPeriod(next)
    }
  }, [open, primarySlots, appointmentTz, period])

  useEffect(() => {
    if (!open) return
    setOtherProsRequested(false)
  }, [open, selectedDayYMD, activeLocationType, selectedClientAddressId])

  function scrollToOtherPros() {
    requestOtherPros({ scroll: true })
  }

  async function onPickSlot(
    proId: string,
    offeringId: string | null,
    slotISO: string,
  ) {
    const effOfferingId = offeringId || resolvedOfferingId
    if (!effOfferingId || holding) return

    const locationId = locationIdByPro[proId]
    if (!locationId) {
      setError('Missing booking location for that pro. Please try again.')
      return
    }

    if (activeLocationType === 'MOBILE' && !selectedClientAddressId) {
      setError('Choose a mobile service address before selecting a time.')
      return
    }

    setError(null)

    const existingHoldId = selectedHoldIdRef.current
    if (existingHoldId) {
      await deleteHoldById(existingHoldId).catch(() => {})
    }

    setSelected(null)
    setHoldUntil(null)

    setHolding(true)
    try {
      const res = await fetch('/api/holds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          offeringId: effOfferingId,
          scheduledFor: slotISO,
          locationType: activeLocationType,
          locationId,
          clientAddressId:
            activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
        }),
      })

      const raw = await safeJson(res)

      if (res.status === 401) {
        redirectToLogin(router, 'hold')
        return
      }

      if (!res.ok) {
        const parsedError = parseBookingApiError(raw, res.status)
        throw new Error(
          getBookingUiMessage(
            parsedError,
            `Hold failed (${res.status}).`,
          ),
        )
      }

      const parsed = parseHoldResponse(raw)

      clearDaySlotCache()

      setSelected({
        proId,
        offeringId: effOfferingId,
        slotISO: parsed.scheduledForISO,
        proTimeZone: appointmentTz,
        holdId: parsed.holdId,
      })
      setHoldUntil(parsed.holdUntilMs)

      if (parsed.locationType) {
        setLocationType(parsed.locationType)
      }
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : 'Failed to hold that time. Try another slot.',
      )
    } finally {
      setHolding(false)
    }
  }

  async function onContinue() {
  if (!selected?.holdId || !selected?.offeringId || holding) return

  const payload: ConfirmHoldSelection = {
    holdId: selected.holdId,
    offeringId: selected.offeringId,
    locationType: activeLocationType,
    slotISO: selected.slotISO,
    bookingSource,
    mediaId: context.mediaId ?? null,
  }

  if (onConfirmHold) {
    try {
      await onConfirmHold(payload)
      // Do not delete the hold here; the caller/route consumes it on success.
      onClose()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not continue with that time.',
      )
    }
    return
  }

  const qs = new URLSearchParams({
    holdId: payload.holdId,
    offeringId: payload.offeringId,
    locationType: payload.locationType,
    source: payload.bookingSource,
  })

  if (payload.mediaId) {
    qs.set('mediaId', payload.mediaId)
  }

  onClose()
  router.push(`/booking/add-ons?${qs.toString()}`)
}

  const selectedLine = selected?.slotISO
    ? fmtSelectedLine(selected.slotISO, appointmentTz)
    : null

  if (!open) return null

  const waitingForMobileAddress =
    open &&
    mobileAddressGateRequested &&
    !selectedClientAddressId &&
    !loadingMobileAddresses

  const displayError =
    waitingForMobileAddress &&
    availabilityError === MOBILE_ADDRESS_REQUIRED_MESSAGE
      ? null
      : availabilityError

  const canRenderSummary = Boolean(summary && primary)
  const shouldShowLoading =
    loading && !canRenderSummary && !waitingForMobileAddress
  const shouldShowEmpty =
    !displayError &&
    !shouldShowLoading &&
    !canRenderSummary &&
    !waitingForMobileAddress

  return (
    <>
      <DrawerShell
        open={open}
        onClose={() => {
          void hardResetUi({ deleteHold: true })
          onClose()
        }}
        header={
          <>
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>

            <div className="sticky top-0 z-10 px-4 pb-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-textPrimary">
                    Availability
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
                    Pick a time. We hold it for you.
                    {holdLabel ? (
                      <span
                        className={[
                          'ml-2 font-black',
                          holdUrgent ? 'text-toneDanger' : 'text-textPrimary',
                        ].join(' ')}
                      >
                        {holdLabel}
                      </span>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void hardResetUi({ deleteHold: true })
                    onClose()
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-bgPrimary/40 text-textPrimary hover:bg-white/10"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
          </>
        }
        footer={
          <StickyCTA
            canContinue={Boolean(selected?.holdId && holdUntil)}
            loading={holding}
            onContinue={onContinue}
            selectedLine={selectedLine}
          />
        }
      >
        <div
          className="looksNoScrollbar overflow-y-auto px-4 pb-4"
          style={{ paddingBottom: STICKY_CTA_H + 14 }}
        >
          {shouldShowLoading ? (
            <div className="tovis-glass-soft rounded-card p-4">
              {/* Shimmer skeleton matching the summary card layout */}
              <div className="mb-4 flex items-center gap-3">
                <div className="avail-skeleton h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="avail-skeleton h-3 w-1/2 rounded-full" />
                  <div className="avail-skeleton h-3 w-1/3 rounded-full" />
                </div>
              </div>
              <div className="avail-skeleton mb-3 h-10 rounded-2xl" />
              <div className="mb-3 flex gap-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="avail-skeleton h-[62px] w-[86px] flex-shrink-0 rounded-2xl" />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="avail-skeleton h-10 w-16 rounded-full" />
                ))}
              </div>
            </div>
          ) : displayError ? (
            <div className="tovis-glass-soft rounded-card p-4">
              <div className="mb-3 text-sm font-semibold text-toneDanger">{displayError}</div>
              <button
                type="button"
                onClick={() => {
                  if (summary) {
                    setError(null)
                    clearDaySlotCache()
                    setSlotRetryKey((k) => k + 1)
                  } else {
                    refresh()
                  }
                }}
                className="inline-flex h-9 items-center justify-center rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] font-black text-textPrimary transition hover:bg-white/10"
              >
                Try again
              </button>
            </div>
          ) : waitingForMobileAddress ? (
            <>
              <AppointmentTypeToggle
                value="MOBILE"
                disabled={holding}
                allowed={allowed}
                offering={offering}
                onChange={(t) => {
                  void resetForLocationModeChange(t)
                }}
              />

              <MobileAddressSelector
                value={selectedClientAddressId}
                options={mobileAddresses}
                loading={loadingMobileAddresses}
                error={mobileAddressesError}
                disabled={holding}
                onChange={setSelectedClientAddressId}
                onAddAddress={() => setAddressCreateOpen(true)}
              />

              <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-textSecondary">
                Choose a service address to see mobile times.
              </div>
            </>
          ) : shouldShowEmpty ? (
            <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-textSecondary">
              No availability found.
            </div>
          ) : summary && primary ? (
            <>
              <ProCard
                pro={primary}
                appointmentTz={appointmentTz}
                viewerTz={viewerTz}
                statusLine={statusLine}
                showFallbackActions={false}
                viewProServicesHref={viewProServicesHref}
                onScrollToOtherPros={scrollToOtherPros}
              />

              <ServiceContextCard
                serviceName={summary.serviceName ?? null}
                categoryName={summary.serviceCategoryName ?? null}
                offering={offering}
                locationType={activeLocationType}
              />

              <AppointmentTypeToggle
                value={activeLocationType}
                disabled={holding}
                allowed={allowed}
                offering={offering}
                onChange={(t) => {
                  void resetForLocationModeChange(t)
                }}
              />

              {refreshing ? (
                <div className="mb-3 text-xs font-semibold text-textSecondary">
                  Refreshing availability…
                </div>
              ) : null}

              {activeLocationType === 'MOBILE' ? (
                <MobileAddressSelector
                  value={selectedClientAddressId}
                  options={mobileAddresses}
                  loading={loadingMobileAddresses}
                  error={mobileAddressesError}
                  disabled={holding}
                  onChange={setSelectedClientAddressId}
                  onAddAddress={() => setAddressCreateOpen(true)}
                />
              ) : null}

              {dayScrollerDays.length ? (
                <DayScroller
                  days={dayScrollerDays}
                  selectedYMD={selectedDayYMD}
                  onSelect={(ymd) => {
                    void hardResetUi({ deleteHold: true })
                    setSelectedDayYMD(ymd)
                  }}
                  onNearEnd={() => {
                    maybeLoadMoreDays()
                  }}
                />
              ) : null}

              {loadingMore ? (
                <div className="tovis-glass-soft mb-3 rounded-card border border-white/10 p-4">
                  <div className="avail-skeleton mb-3 h-3 w-24 rounded-full" />
                  <div className="flex gap-2 overflow-hidden">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="avail-skeleton h-[62px] w-[86px] flex-shrink-0 rounded-2xl" />
                    ))}
                  </div>
                </div>
              ) : null}

              {loadingPrimarySlots ? (
                <div className="tovis-glass-soft mb-3 rounded-card p-4">
                  <div className="avail-skeleton mb-4 h-3 w-28 rounded-full" />
                  <div className="mb-3 grid grid-cols-3 gap-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="avail-skeleton h-10 rounded-full" />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <div key={i} className="avail-skeleton h-10 w-[62px] rounded-full" />
                    ))}
                  </div>
                </div>
              ) : null}

              <SlotChips
                pro={primary}
                appointmentTz={appointmentTz}
                holding={holding}
                selected={selected}
                period={period}
                onSelectPeriod={(p) => {
                  void hardResetUi({ deleteHold: true })
                  setPeriod(p)
                }}
                slotsForDay={primarySlots}
                onPick={(proId, offeringId, slotISO) => {
                  void onPickSlot(proId, offeringId, slotISO)
                }}
              />

              {hasOtherPros && !otherProsRequested ? (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => {
                      requestOtherPros()
                    }}
                    disabled={holding || loadingOtherSlots || !selectedDayYMD}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-bgPrimary/35 px-4 text-[13px] font-black text-textPrimary transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Show other pros near you
                  </button>
                </div>
              ) : null}

              {loadingOtherSlots ? (
                <div className="mb-3 text-xs font-semibold text-textSecondary">
                  Loading more pros…
                </div>
              ) : null}

              {showLocalHint && selected?.slotISO ? (
                <div className="tovis-glass-soft mb-3 rounded-card p-3 text-[12px] font-semibold text-textSecondary">
                  You’re booking{' '}
                  <span className="font-black text-textPrimary">
                    {appointmentTz}
                  </span>{' '}
                  time.
                  <span className="ml-2">
                    Your local time:{' '}
                    <span className="font-black text-textPrimary">
                      {fmtInTz(selected.slotISO, viewerTz)}
                    </span>
                  </span>
                </div>
              ) : null}

              <WaitlistPanel
                canWaitlist={canWaitlist}
                appointmentTz={appointmentTz}
                context={context}
                effectiveServiceId={effectiveServiceId}
                noPrimarySlots={noPrimarySlots}
              />

              {shouldRenderOtherPros ? (
                <OtherPros
                  others={others.map((p) => ({
                    ...p,
                    slots: otherSlots[p.id] ?? [],
                  }))}
                  effectiveServiceId={effectiveServiceId}
                  viewerTz={viewerTz}
                  appointmentTz={appointmentTz}
                  holding={holding}
                  selected={selected}
                  onPick={(proId, offeringId, slotISO) => {
                    void onPickSlot(proId, offeringId, slotISO)
                  }}
                  setRef={(el) => {
                    otherProsRef.current = el
                  }}
                />
              ) : null}

              {debug ? (
                <DebugPanel
                  payload={{
                    bookingSource,
                    appointmentTz,
                    viewerTz,
                    selected,
                    holdUntil,
                    locationType: activeLocationType,
                    effectiveServiceId,
                    selectedDayYMD,
                    period,
                    primarySlotsCount: primarySlots.length,
                    otherProsRequested,
                    otherProsCount: others.length,
                    hasMoreDays,
                    windowStartDate: summary.windowStartDate,
                    windowEndDate: summary.windowEndDate,
                    nextStartDate: summary.nextStartDate,
                    offering,
                    allowed,
                    selectedClientAddressId,
                    mobileAddresses,
                    raw: data,
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </DrawerShell>

      <ClientAddressCreateModal
        open={open && addressCreateOpen}
        onClose={() => {
          if (holding) return
          setAddressCreateOpen(false)
        }}
        onSaved={handleAddressSaved}
      />
    </>
  )
}
