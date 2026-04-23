// app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx
'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import type {
  AvailabilityBootstrapResponse,
  AvailabilityOffering,
  BookingSource,
  DrawerContext,
  SelectedHold,
  ServiceLocationType,
} from './types'

import { asTrimmedString, getRecordProp, isRecord } from '@/lib/guards'

import AppointmentTypeToggle from './components/AppointmentTypeToggle'
import ClientAddressCreateModal from './components/ClientAddressCreateModal'
import DayScroller from './components/DayScroller'
import DebugPanel from './components/DebugPanel'
import DrawerShell from './components/DrawerShell'
import MobileAddressSelector from './components/MobileAddressSelector'
import OtherPros from './components/OtherPros'
import SlotChips from './components/SlotChips'
import StickyCTA from './components/StickyCTA'
import WaitlistPanel from './components/WaitlistPanel'

import { useAvailability } from './hooks/useAvailability'
import { useAvailabilityAlternates } from './hooks/useAvailabilityAlternates'
import { useDaySlots } from './hooks/useDaySlots'
import { useDebugFlag } from './hooks/useDebugFlag'
import { useHoldTimer } from './hooks/useHoldTimer'
import { useMobileAddresses } from './hooks/useMobileAddresses'
import {
  cancelAvailabilityMetric,
  endAvailabilityMetric,
  startAvailabilityMetric,
} from './perf/availabilityPerf'
import { redirectToLogin } from './utils/authRedirect'
import { shouldPrefetchForSelectedIndex } from './utils/availabilityWindow'
import { deleteHoldById, parseHoldResponse } from './utils/hold'
import { safeJson } from './utils/safeJson'
import { dateTimeLocalToUtcIso } from '@/lib/bookingDateTimeClient'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

const FALLBACK_TZ: 'UTC' = 'UTC'
const MOBILE_ADDRESS_REQUIRED_MESSAGE =
  'Select a saved service address before viewing mobile availability.'

const AVAILABILITY_BACKGROUND_STATUS_TEST_ID =
  'availability-background-status'
const AVAILABILITY_HOLD_CONTINUE_BUTTON_TEST_ID =
  'availability-hold-continue-button'

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

const EMPTY_DAYS: Array<{ date: string; slotCount: number }> = []

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function buildDaySwitchMetricKey(dayYMD: string) {
  return `day-switch:${dayYMD}`
}

function buildHoldRequestMetricKey(args: {
  offeringId: string
  slotISO: string
}) {
  return `hold:${args.offeringId}:${args.slotISO}`
}

function buildContinueMetricKey(holdId: string) {
  return `continue:${holdId}`
}

const DTF_KEY_PROPS: Array<keyof Intl.DateTimeFormatOptions> = [
  'timeZone',
  'weekday',
  'month',
  'day',
  'year',
  'hour',
  'minute',
  'hour12',
]

function getDtf(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const parts: string[] = [locale ?? '']
  for (const prop of DTF_KEY_PROPS) {
    parts.push(String(options[prop] ?? ''))
  }
  const key = parts.join('|')

  let fmt = dtfCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options)
    dtfCache.set(key, fmt)
  }

  return fmt
}

type DiscoveryContextIds = {
  mediaId: string | null
  lookPostId: string | null
}

type ConfirmHoldSelection = {
  holdId: string
  offeringId: string
  locationType: ServiceLocationType
  slotISO: string
  bookingSource: BookingSource
  mediaId: string | null
  lookPostId: string | null
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

type AvailabilityTelemetryEventName =
  | 'availability_drawer_opened'
  | 'availability_summary_loaded'
  | 'availability_day_slots_loaded'
  | 'availability_hold_requested'
  | 'availability_hold_succeeded'
  | 'availability_continue_clicked'

type AvailabilityTelemetryPayload = {
  professionalId?: string | null
  serviceId?: string | null
  offeringId?: string | null
  selectedDayYMD?: string | null
  slotISO?: string | null
  locationType?: ServiceLocationType | null
  bookingSource?: BookingSource
  hasOtherPros?: boolean
  dayCount?: number
  slotCount?: number
  availabilityVersion?: string | null
}

declare global {
  interface Window {
    __tovisAvailabilityTrack?: (
      eventName: AvailabilityTelemetryEventName,
      payload: AvailabilityTelemetryPayload,
    ) => void
  }
}

function trackAvailabilityEvent(
  eventName: AvailabilityTelemetryEventName,
  payload: AvailabilityTelemetryPayload,
): void {
  if (typeof window === 'undefined') return

  window.dispatchEvent(
    new CustomEvent('tovis:availability', {
      detail: { eventName, payload },
    }),
  )

  window.__tovisAvailabilityTrack?.(eventName, payload)
}

function getDiscoveryContextIds(context: DrawerContext): DiscoveryContextIds {
  return {
    mediaId: asTrimmedString(context.mediaId),
    lookPostId: asTrimmedString(context.lookPostId),
  }
}

function resolveBookingSource(context: DrawerContext): BookingSource {
  if (context.source) return context.source

  const discoveryIds = getDiscoveryContextIds(context)
  if (discoveryIds.lookPostId || discoveryIds.mediaId) return 'DISCOVERY'

  return 'REQUESTED'
}

function parseBookingUiAction(value: unknown): BookingErrorUiAction | null {
  if (
    value === 'REFRESH_AVAILABILITY' ||
    value === 'PICK_NEW_SLOT' ||
    value === 'ADD_SERVICE_ADDRESS' ||
    value === 'FIX_LOCATION_CONFIG' ||
    value === 'FIX_OFFERING_CONFIG' ||
    value === 'FIX_WORKING_HOURS' ||
    value === 'CONTACT_SUPPORT' ||
    value === 'NONE'
  ) {
    return value
  }

  return null
}

function parseBookingApiError(
  raw: unknown,
  status: number,
): ParsedBookingApiError | null {
  if (!isRecord(raw)) return null

  const retryableRaw = getRecordProp(raw, 'retryable')

  return {
    status,
    code: asTrimmedString(getRecordProp(raw, 'code')),
    message: asTrimmedString(getRecordProp(raw, 'error')),
    retryable: typeof retryableRaw === 'boolean' ? retryableRaw : null,
    uiAction: parseBookingUiAction(getRecordProp(raw, 'uiAction')),
    developerMessage: asTrimmedString(getRecordProp(raw, 'message')),
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
      return (
        parsed.message ?? 'Choose a mobile service address before continuing.'
      )

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

function shouldRefreshAvailabilityAfterBookingError(
  parsed: ParsedBookingApiError | null,
  status: number,
): boolean {
  if (
    parsed?.uiAction === 'REFRESH_AVAILABILITY' ||
    parsed?.uiAction === 'PICK_NEW_SLOT'
  ) {
    return true
  }

  switch (parsed?.code) {
    case 'HOLD_EXPIRED':
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
      return true

    default:
      return status === 409
  }
}

function periodOfHour(hour: number): Period {
  if (hour < 12) return 'MORNING'
  if (hour < 17) return 'AFTERNOON'
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

  return getDtf(undefined, {
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

  return getDtf(undefined, {
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

  const parts = getDtf('en-US', {
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

  const parts = getDtf('en-CA', {
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

type AvailabilityBootstrapOk = Extract<AvailabilityBootstrapResponse, { ok: true }>

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
  const summaryTz =
    typeof args.summaryTimeZone === 'string'
      ? args.summaryTimeZone.trim()
      : ''
  if (summaryTz && isValidIanaTimeZone(summaryTz)) return summaryTz

  const primaryTz =
    typeof args.primaryProTimeZone === 'string'
      ? args.primaryProTimeZone.trim()
      : ''
  if (primaryTz && isValidIanaTimeZone(primaryTz)) return primaryTz

  return FALLBACK_TZ
}

function buildDayScrollerModel(
  days: Array<{ date: string; slotCount: number }>,
  appointmentTz: string,
) {
  return days.map((day) => {
    let anchor = new Date(`${day.date}T12:00:00.000Z`)

    try {
      anchor = new Date(
        dateTimeLocalToUtcIso(`${day.date}T12:00:00`, appointmentTz),
      )
    } catch {
      // display-only fallback
    }

    const top = getDtf(undefined, {
      timeZone: appointmentTz,
      weekday: 'short',
    }).format(anchor)

    const bottom = getDtf(undefined, {
      timeZone: appointmentTz,
      day: '2-digit',
    }).format(anchor)

    return { ymd: day.date, labelTop: top, labelBottom: bottom }
  })
}

function fallbackAllowedMode(args: {
  salon: boolean
  mobile: boolean
}): ServiceLocationType {
  if (args.mobile && !args.salon) return 'MOBILE'
  return 'SALON'
}

const AvailabilityDrawerSkeleton = React.memo(
  function AvailabilityDrawerSkeleton() {
    return (
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            className="avail-skeleton"
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              flexShrink: 0,
            }}
          />
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              className="avail-skeleton"
              style={{ height: 12, width: '45%', borderRadius: 999 }}
            />
            <div
              className="avail-skeleton"
              style={{ height: 10, width: '30%', borderRadius: 999 }}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 16,
            overflow: 'hidden',
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="avail-skeleton"
              style={{
                height: 62,
                width: 66,
                flexShrink: 0,
                borderRadius: 999,
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 6,
            marginBottom: 12,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="avail-skeleton"
              style={{ height: 36, borderRadius: 999 }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="avail-skeleton"
              style={{ height: 38, width: 64, borderRadius: 999 }}
            />
          ))}
        </div>
      </div>
    )
  },
)

function InlineRetryCard(props: {
  message: string
  onRetry: () => void
}) {
  return (
    <div
      data-testid="availability-error"
      className="mb-[14px] rounded-[14px] border border-white/10 bg-bgPrimary/35 p-3.5"
    >
      <div className="mb-2.5 text-[13px] font-semibold text-red-400">
        {props.message}
      </div>

      <button
        type="button"
        data-testid="availability-retry-button"
        onClick={props.onRetry}
        className="h-[34px] rounded-full border border-white/10 bg-bgPrimary/35 px-[14px] text-[12px] font-extrabold text-textPrimary transition hover:bg-white/10"
      >
        Retry
      </button>
    </div>
  )
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
  const [holdError, setHoldError] = useState<string | null>(null)

  const otherProsRef = useRef<HTMLDivElement | null>(null)
  const holdStatusRef = useRef<HTMLDivElement | null>(null)
  const selectedHoldIdRef = useRef<string | null>(null)
  const pendingDaySwitchMetricKeyRef = useRef<string | null>(null)

  const drawerOpenedTrackedRef = useRef(false)
  const summaryLoadedTrackedRef = useRef(false)
  const lastDaySlotsTrackedKeyRef = useRef<string | null>(null)
  const openedOnceRef = useRef(false)

  useEffect(() => {
    setViewerTz(getViewerTimeZoneClient())
  }, [])

  useEffect(() => {
    selectedHoldIdRef.current = selected?.holdId ?? null
  }, [selected?.holdId])

  useEffect(() => {
    if (!open) return
    if (!selected?.holdId) return

    window.requestAnimationFrame(() => {
      holdStatusRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
  }, [open, selected?.holdId])

  const discoveryIds = useMemo(
    () => getDiscoveryContextIds(context),
    [context.mediaId, context.lookPostId],
  )

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
    otherProsRequested,
  )

  const summary: AvailabilityBootstrapOk | null = data
  const primary = summary?.primaryPro ?? null
  const others = summary?.otherPros ?? []
  const days = summary?.availableDays ?? EMPTY_DAYS
  const offering: AvailabilityOffering = summary?.offering ?? FALLBACK_OFFERING

  const previousResetContextKeyRef = useRef<string | null>(null)
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

  const resetContextKey = useMemo(() => {
    return [
      discoveryIds.lookPostId ?? '',
      discoveryIds.mediaId ?? '',
      context.professionalId ?? '',
      context.serviceId ?? '',
      context.offeringId ?? '',
      context.source ?? '',
    ].join('|')
  }, [
    discoveryIds.lookPostId,
    discoveryIds.mediaId,
    context.professionalId,
    context.serviceId,
    context.offeringId,
    context.source,
  ])

  const mobileAddressGateRequested =
    locationType === 'MOBILE' ||
    summary?.request.locationType === 'MOBILE' ||
    forcedMobileOnlyGate

  const activeLocationType: ServiceLocationType = mobileAddressGateRequested
    ? 'MOBILE'
    : locationType ??
      summary?.request.locationType ??
      fallbackAllowedMode(allowed)

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
  const effectiveServiceId =
    summary?.request.serviceId ?? context.serviceId ?? null
  const bookingSource = useMemo(() => resolveBookingSource(context), [context])

  const canWaitlist = Boolean(
    summary?.waitlistSupported && context.professionalId && effectiveServiceId,
  )

  const proHeaderMeta = useMemo(() => {
    if (!summary) return null

    const parts: string[] = []

    if (summary.serviceName?.trim()) {
      parts.push(summary.serviceName.trim())
    }

    const rawPrice =
      activeLocationType === 'MOBILE'
        ? offering.mobilePriceStartingAt
        : offering.salonPriceStartingAt

    if (rawPrice) {
      const n = Number(rawPrice)
      if (Number.isFinite(n) && n > 0) {
        parts.push(`$${n.toFixed(0)}`)
      }
    }

    const duration =
      activeLocationType === 'MOBILE'
        ? offering.mobileDurationMinutes
        : offering.salonDurationMinutes

    if (typeof duration === 'number' && duration > 0) {
      parts.push(`${duration}min`)
    }

    return parts.length ? parts.join(' · ') : null
  }, [summary, offering, activeLocationType])

  const resolvedOfferingId = useMemo(() => {
    if (summary?.offering?.id) return summary.offering.id
    if (summary?.request.offeringId) return summary.request.offeringId
    return context.offeringId ?? null
  }, [summary?.offering?.id, summary?.request.offeringId, context.offeringId])

  const locationIdByPro = useMemo(() => {
    const map: Record<string, string> = {}
    if (!summary) return map

    map[summary.primaryPro.id] = summary.request.locationId
    for (const pro of summary.otherPros) {
      map[pro.id] = pro.locationId
    }

    return map
  }, [summary])

  const dayScrollerDays = useMemo(() => {
    if (!days.length) return []
    return buildDayScrollerModel(days, appointmentTz)
  }, [days, appointmentTz])

  const {
    primarySlots,
    loadingPrimarySlots,
    clearDaySlots,
    invalidateDaySlotCache,
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

  const {
    data: alternatesData,
    otherSlots,
    loadingAlternates,
    alternatesError,
    clearAlternates,
    refreshAlternates,
  } = useAvailabilityAlternates({
    open,
    requested: otherProsRequested,
    summary,
    context,
    selectedDayYMD,
    activeLocationType,
    selectedClientAddressId,
    debug,
    retryKey: slotRetryKey,
  })

  const otherProsWithSlots = useMemo(
    () => others.map((pro) => ({ ...pro, slots: otherSlots[pro.id] ?? [] })),
    [others, otherSlots],
  )

  const noPrimarySlots = Boolean(
    primary && !loadingPrimarySlots && primarySlots.length === 0,
  )
  const hasOtherPros = others.length > 0
  const shouldRenderOtherPros = hasOtherPros && otherProsRequested
  const otherProsInlineError = shouldRenderOtherPros ? alternatesError : null

  const hardResetUi = useCallback(
    async (args?: { deleteHold?: boolean }) => {
      const holdId = selectedHoldIdRef.current ?? selected?.holdId ?? null

      if (args?.deleteHold && holdId) {
        void deleteHoldById(holdId).catch(() => {})
      }

      setSelected(null)
      setHoldUntil(null)
      setHolding(false)
      setError(null)
      setHoldError(null)
    },
    [selected?.holdId, setError],
  )

  const retryDaySlots = useCallback(() => {
    setError(null)
    setSlotRetryKey((key) => key + 1)
  }, [setError])

  const refreshAfterAvailabilityConflict = useCallback(() => {
    setSelected(null)
    setHoldUntil(null)
    setOtherProsRequested(false)

    if (selectedDayYMD) {
      invalidateDaySlotCache({
        selectedDayYMD,
        locationType: activeLocationType,
        clientAddressId: selectedClientAddressId,
      })
    }

    clearAlternates()
    setSlotRetryKey((key) => key + 1)
    refresh()
  }, [
    selectedDayYMD,
    activeLocationType,
    selectedClientAddressId,
    invalidateDaySlotCache,
    clearAlternates,
    refresh,
  ])

  const resetForLocationModeChange = useCallback(
    async (next: ServiceLocationType) => {
      if (next === activeLocationType) return

      await hardResetUi({ deleteHold: true })
      setLocationType(next)
      setSelectedDayYMD(null)
      setOtherProsRequested(false)
      clearDaySlots()
      clearAlternates()
      setError(null)
    },
    [activeLocationType, hardResetUi, clearDaySlots, clearAlternates, setError],
  )

  const requestOtherPros = useCallback(
    (options?: { scroll?: boolean }) => {
      if (!open) return
      if (!summary) return
      if (!selectedDayYMD) return
      if (!hasOtherPros) return

      setOtherProsRequested(true)

      if (options?.scroll) {
        window.requestAnimationFrame(() => {
          otherProsRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          })
        })
      }
    },
    [open, summary, selectedDayYMD, hasOtherPros],
  )

  const maybeLoadMoreDays = useCallback(() => {
    if (!hasMoreDays) return
    if (loading || loadingMore || refreshing) return
    void loadMore()
  }, [hasMoreDays, loadMore, loading, loadingMore, refreshing])

  useEffect(() => {
    if (!open) {
      previousResetContextKeyRef.current = null
      return
    }

    if (previousResetContextKeyRef.current === null) {
      previousResetContextKeyRef.current = resetContextKey
      return
    }

    if (previousResetContextKeyRef.current === resetContextKey) return

    previousResetContextKeyRef.current = resetContextKey

    setSelectedDayYMD(null)
    setPeriod('AFTERNOON')
    setOtherProsRequested(false)
    clearDaySlots()
    clearAlternates()

    void hardResetUi({ deleteHold: true })
  }, [open, resetContextKey, clearDaySlots, clearAlternates, hardResetUi])

  useEffect(() => {
    if (!open) {
      cancelAvailabilityMetric({
        metric: 'drawer_open_to_first_usable_ms',
        reason: 'drawer_closed',
      })

      if (pendingDaySwitchMetricKeyRef.current) {
        cancelAvailabilityMetric({
          metric: 'day_switch_to_times_visible_ms',
          key: pendingDaySwitchMetricKeyRef.current,
          reason: 'drawer_closed',
        })
        pendingDaySwitchMetricKeyRef.current = null
      }

      drawerOpenedTrackedRef.current = false
      summaryLoadedTrackedRef.current = false
      lastDaySlotsTrackedKeyRef.current = null
      return
    }

    if (drawerOpenedTrackedRef.current) return

    drawerOpenedTrackedRef.current = true
    summaryLoadedTrackedRef.current = false
    lastDaySlotsTrackedKeyRef.current = null

    startAvailabilityMetric({
      metric: 'drawer_open_to_first_usable_ms',
      meta: {
        professionalId: context.professionalId ?? null,
        serviceId: context.serviceId ?? null,
        offeringId: context.offeringId ?? null,
        bookingSource,
        locationType: activeLocationType,
      },
    })

    trackAvailabilityEvent('availability_drawer_opened', {
      professionalId: context.professionalId ?? null,
      serviceId: context.serviceId ?? null,
      offeringId: context.offeringId ?? null,
      bookingSource,
    })
  }, [
    open,
    context.professionalId,
    context.serviceId,
    context.offeringId,
    bookingSource,
    activeLocationType,
  ])

  useEffect(() => {
    if (!open) return
    if (!summary || !primary) return
    if (summaryLoadedTrackedRef.current) return

    summaryLoadedTrackedRef.current = true

    trackAvailabilityEvent('availability_summary_loaded', {
      professionalId: primary.id,
      serviceId: effectiveServiceId,
      offeringId: summary.offering?.id ?? context.offeringId ?? null,
      locationType: activeLocationType,
      bookingSource,
      hasOtherPros,
      dayCount: days.length,
      availabilityVersion: summary.availabilityVersion,
    })
  }, [
    open,
    summary,
    primary,
    effectiveServiceId,
    context.offeringId,
    activeLocationType,
    bookingSource,
    hasOtherPros,
    days.length,
  ])

  useEffect(() => {
    if (!open) return
    if (!summary || !primary) return
    if (!selectedDayYMD) return
    if (loadingPrimarySlots) return

    const daySlotsEventKey = [
      summary.availabilityVersion,
      selectedDayYMD,
      activeLocationType,
      slotRetryKey,
      primarySlots.length,
    ].join('|')

    if (lastDaySlotsTrackedKeyRef.current === daySlotsEventKey) return
    lastDaySlotsTrackedKeyRef.current = daySlotsEventKey

    trackAvailabilityEvent('availability_day_slots_loaded', {
      professionalId: primary.id,
      serviceId: effectiveServiceId,
      offeringId: resolvedOfferingId,
      selectedDayYMD,
      locationType: activeLocationType,
      bookingSource,
      slotCount: primarySlots.length,
      availabilityVersion: summary.availabilityVersion,
    })

    const daySwitchMetricKey = buildDaySwitchMetricKey(selectedDayYMD)

    endAvailabilityMetric({
      metric: 'day_switch_to_times_visible_ms',
      key: daySwitchMetricKey,
      meta: {
        selectedDayYMD,
        locationType: activeLocationType,
        serviceId: effectiveServiceId,
        offeringId: resolvedOfferingId,
        bookingSource,
        slotCount: primarySlots.length,
      },
    })

    if (pendingDaySwitchMetricKeyRef.current === daySwitchMetricKey) {
      pendingDaySwitchMetricKeyRef.current = null
    }
  }, [
    open,
    summary,
    primary,
    selectedDayYMD,
    loadingPrimarySlots,
    activeLocationType,
    bookingSource,
    effectiveServiceId,
    resolvedOfferingId,
    slotRetryKey,
    primarySlots.length,
  ])

  useEffect(() => {
    if (!open) return
    if (!summary) return
    if (!selectedDayYMD) return
    if (!hasMoreDays) return
    if (loadingPrimarySlots) return

    const selectedIndex = days.findIndex((day) => day.date === selectedDayYMD)
    if (
      shouldPrefetchForSelectedIndex({
        selectedIndex,
        loadedCount: days.length,
      })
    ) {
      maybeLoadMoreDays()
    }
  }, [
    open,
    summary,
    selectedDayYMD,
    hasMoreDays,
    loadingPrimarySlots,
    days,
    maybeLoadMoreDays,
  ])

  useEffect(() => {
    if (!open) return

    if (!hasOtherPros) {
      setOtherProsRequested(false)
    }
  }, [open, hasOtherPros])

  useEffect(() => {
    if (!open) return
    if (!forcedMobileOnlyGate) return
    if (locationType === 'MOBILE') return

    setLocationType('MOBILE')
  }, [open, forcedMobileOnlyGate, locationType])

  useEffect(() => {
    if (!open) return
    if (!mobileAddressGateRequested) return

    if (!selectedClientAddressId) {
      void hardResetUi({ deleteHold: true })
      setError(null)
      setOtherProsRequested(false)
      clearDaySlots()
      clearAlternates()
    }
  }, [
    open,
    mobileAddressGateRequested,
    selectedClientAddressId,
    hardResetUi,
    clearDaySlots,
    clearAlternates,
    setError,
  ])

  useEffect(() => {
    if (!open) {
      openedOnceRef.current = false
      return
    }

    if (openedOnceRef.current) return
    openedOnceRef.current = true

    setPeriod('AFTERNOON')
    setOtherProsRequested(false)

    void hardResetUi()
  }, [open, hardResetUi])

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

    const preferredDay =
      summary?.selectedDay?.date ??
      (() => {
        const todayInAppointmentTz = ymdInTz(appointmentTz)
        const todayExists = todayInAppointmentTz
          ? days.some((day) => day.date === todayInAppointmentTz)
          : false
        const firstAvailable = days[0]?.date ?? null

        return (
          (todayExists ? todayInAppointmentTz : null) ??
          firstAvailable ??
          todayInAppointmentTz
        )
      })()

    setSelectedDayYMD((current) => {
      if (!preferredDay) return current ?? null
      if (!current) return preferredDay

      if (days.length > 0) {
        const currentStillExists = days.some((day) => day.date === current)
        return currentStillExists ? current : preferredDay
      }

      return current
    })
  }, [open, summary?.selectedDay?.date, appointmentTz, days])

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
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
    setHoldError('That hold expired. Please pick a new slot.')
    refreshAfterAvailabilityConflict()
  }, [holdExpired, refreshAfterAvailabilityConflict])

  useEffect(() => {
    if (!open) return
    if (!primarySlots.length) return

    const counts: Record<Period, number> = {
      MORNING: 0,
      AFTERNOON: 0,
      EVENING: 0,
    }

    for (const iso of primarySlots) {
      const hour = hourInTz(iso, appointmentTz)
      if (hour == null) continue
      counts[periodOfHour(hour)] += 1
    }

    if (counts[period] > 0) return

    const preferred: Period[] = ['AFTERNOON', 'MORNING', 'EVENING']
    const next = preferred.find((candidate) => counts[candidate] > 0)
    if (next && next !== period) {
      setPeriod(next)
    }
  }, [open, primarySlots, appointmentTz, period])

  useEffect(() => {
    if (!open) return

    setOtherProsRequested(false)
    clearAlternates()
  }, [
    open,
    selectedDayYMD,
    activeLocationType,
    selectedClientAddressId,
    clearAlternates,
  ])

  const waitingForMobileAddress =
    open &&
    mobileAddressGateRequested &&
    !selectedClientAddressId &&
    !loadingMobileAddresses

  const showMobileAddressSelector = open && mobileAddressGateRequested

  const displayError = (() => {
    if (holdError) return holdError

    if (
      waitingForMobileAddress &&
      availabilityError === MOBILE_ADDRESS_REQUIRED_MESSAGE
    ) {
      return null
    }

    return availabilityError
  })()

  const canRenderSummary = Boolean(summary && primary)
  const summaryDaysLoading =
    loading && !canRenderSummary && !showMobileAddressSelector
  const backgroundRefreshing = refreshing
  const daySlotsLoading =
    loadingPrimarySlots && primarySlots.length === 0
  const daySlotsRefreshingInline =
    loadingPrimarySlots && primarySlots.length > 0

  const blockingError = !canRenderSummary ? displayError : null
  const inlineError = canRenderSummary ? displayError : null

  const shouldShowEmpty =
    !blockingError &&
    !summaryDaysLoading &&
    !canRenderSummary &&
    !showMobileAddressSelector

  useEffect(() => {
    if (!open) return
    if (!canRenderSummary) return
    if (summaryDaysLoading) return
    if (!selectedDayYMD) return
    if (!dayScrollerDays.length) return
    if (loadingPrimarySlots) return

    endAvailabilityMetric({
      metric: 'drawer_open_to_first_usable_ms',
      meta: {
        professionalId: primary?.id ?? null,
        serviceId: effectiveServiceId,
        offeringId: resolvedOfferingId,
        selectedDayYMD,
        locationType: activeLocationType,
        bookingSource,
        slotCount: primarySlots.length,
        dayCount: days.length,
      },
    })
  }, [
    open,
    canRenderSummary,
    summaryDaysLoading,
    selectedDayYMD,
    dayScrollerDays.length,
    loadingPrimarySlots,
    primary?.id,
    effectiveServiceId,
    resolvedOfferingId,
    activeLocationType,
    bookingSource,
    primarySlots.length,
    days.length,
  ])

  async function onPickSlot(
    proId: string,
    offeringId: string | null,
    slotISO: string,
  ) {
    const effectiveOfferingId = offeringId || resolvedOfferingId
    if (!effectiveOfferingId || holding) return

    const holdMetricKey = buildHoldRequestMetricKey({
      offeringId: effectiveOfferingId,
      slotISO,
    })

    let holdMetricFinished = false

    const locationId = locationIdByPro[proId] ?? null

    if (activeLocationType === 'MOBILE' && !selectedClientAddressId) {
      setError('Choose a mobile service address before selecting a time.')
      return
    }

    setError(null)
    setHoldError(null)

    const existingHoldId = selectedHoldIdRef.current
    if (existingHoldId) {
      await deleteHoldById(existingHoldId).catch(() => {})
    }

    setSelected(null)
    setHoldUntil(null)

    startAvailabilityMetric({
      metric: 'hold_request_latency_ms',
      key: holdMetricKey,
      meta: {
        professionalId: proId,
        serviceId: effectiveServiceId,
        offeringId: effectiveOfferingId,
        selectedDayYMD,
        slotISO,
        locationType: activeLocationType,
        bookingSource,
      },
    })

    trackAvailabilityEvent('availability_hold_requested', {
      professionalId: proId,
      serviceId: effectiveServiceId,
      offeringId: effectiveOfferingId,
      selectedDayYMD,
      slotISO,
      locationType: activeLocationType,
      bookingSource,
    })

    setHolding(true)

    try {
      const res = await fetch('/api/holds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          offeringId: effectiveOfferingId,
          scheduledFor: slotISO,
          locationType: activeLocationType,
          ...(locationId ? { locationId } : {}),
          clientAddressId:
            activeLocationType === 'MOBILE' ? selectedClientAddressId : null,
        }),
      })

      endAvailabilityMetric({
        metric: 'hold_request_latency_ms',
        key: holdMetricKey,
        meta: {
          professionalId: proId,
          serviceId: effectiveServiceId,
          offeringId: effectiveOfferingId,
          selectedDayYMD,
          slotISO,
          locationType: activeLocationType,
          bookingSource,
          statusCode: res.status,
          ok: res.ok,
        },
      })
      holdMetricFinished = true

      const raw = await safeJson(res)

      if (res.status === 401) {
        redirectToLogin(router, 'hold')
        return
      }

      if (!res.ok) {
        const parsedError = parseBookingApiError(raw, res.status)

        if (shouldRefreshAvailabilityAfterBookingError(parsedError, res.status)) {
          refreshAfterAvailabilityConflict()
        }

        throw new Error(
          getBookingUiMessage(parsedError, `Hold failed (${res.status}).`),
        )
      }

      const parsed = parseHoldResponse(raw)

      invalidateDaySlotCache({
        selectedDayYMD,
        locationType: activeLocationType,
        clientAddressId: selectedClientAddressId,
      })

      setSelected({
        proId,
        offeringId: effectiveOfferingId,
        slotISO: parsed.scheduledForISO,
        proTimeZone: appointmentTz,
        holdId: parsed.holdId,
      })
      setHoldUntil(parsed.holdUntilMs)

      if (parsed.locationType) {
        setLocationType(parsed.locationType)
      }

      trackAvailabilityEvent('availability_hold_succeeded', {
        professionalId: proId,
        serviceId: effectiveServiceId,
        offeringId: effectiveOfferingId,
        selectedDayYMD,
        slotISO: parsed.scheduledForISO,
        locationType: parsed.locationType ?? activeLocationType,
        bookingSource,
      })

      if (otherProsRequested) {
        refreshAlternates()
      }
    } catch (error: unknown) {
      if (!holdMetricFinished) {
        endAvailabilityMetric({
          metric: 'hold_request_latency_ms',
          key: holdMetricKey,
          meta: {
            professionalId: proId,
            serviceId: effectiveServiceId,
            offeringId: effectiveOfferingId,
            selectedDayYMD,
            slotISO,
            locationType: activeLocationType,
            bookingSource,
            outcome: 'network_error',
          },
        })
        holdMetricFinished = true
      }

      setHoldError(
        error instanceof Error
          ? error.message
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
      mediaId: discoveryIds.mediaId,
      lookPostId: discoveryIds.lookPostId,
    }

    trackAvailabilityEvent('availability_continue_clicked', {
      professionalId: context.professionalId ?? null,
      serviceId: effectiveServiceId,
      offeringId: selected.offeringId,
      selectedDayYMD,
      slotISO: selected.slotISO,
      locationType: activeLocationType,
      bookingSource,
    })

    if (onConfirmHold) {
      try {
        await onConfirmHold(payload)
        onClose()
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'Could not continue with that time.',
        )
      }
      return
    }

    const continueMetricKey = buildContinueMetricKey(payload.holdId)

    startAvailabilityMetric({
      metric: 'continue_to_add_ons_ms',
      key: continueMetricKey,
      meta: {
        professionalId: context.professionalId ?? null,
        serviceId: effectiveServiceId,
        offeringId: payload.offeringId,
        selectedDayYMD,
        slotISO: payload.slotISO,
        locationType: payload.locationType,
        bookingSource: payload.bookingSource,
        holdId: payload.holdId,
      },
    })

    const qs = new URLSearchParams({
      holdId: payload.holdId,
      offeringId: payload.offeringId,
      locationType: payload.locationType,
      source: payload.bookingSource,
    })

    if (payload.lookPostId) {
      qs.set('lookPostId', payload.lookPostId)
    }

    if (payload.mediaId) {
      qs.set('mediaId', payload.mediaId)
    }

    if (activeLocationType === 'MOBILE' && selectedClientAddressId) {
      qs.set('clientAddressId', selectedClientAddressId)
    }

    onClose()
    router.push(`/booking/add-ons?${qs.toString()}`)
  }

  const selectedLine = selected?.slotISO
    ? fmtSelectedLine(selected.slotISO, appointmentTz)
    : null

  const continueLabel = onConfirmHold ? 'Continue' : 'Continue to add-ons'

  if (!open) return null

  return (
    <>
      <DrawerShell
        open={open}
        onClose={() => {
          void hardResetUi({ deleteHold: true })
          onClose()
        }}
        header={
          <div className="flex items-center justify-between px-4 pb-[10px] pt-3">
            <button
              type="button"
              data-testid="availability-close-button"
              onClick={() => {
                void hardResetUi({ deleteHold: true })
                onClose()
              }}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-bgPrimary/35 text-[14px] text-textSecondary transition hover:bg-white/10"
            >
              ✕
            </button>

            <div className="flex items-center gap-[5px]">
              <div className="h-2 w-6 rounded-full bg-accentPrimary opacity-70" />
              <div className="h-2 w-2 rounded-full bg-white/15" />
            </div>
          </div>
        }
        footer={
          <StickyCTA
            canContinue={Boolean(selected?.holdId && holdUntil)}
            loading={holding}
            onContinue={onContinue}
            selectedLine={selectedLine}
            continueLabel={continueLabel}
          />
        }
      >
        <div
          className="looksNoScrollbar overflow-y-auto px-5"
          style={{ paddingBottom: 16 }}
        >
          {summary && primary ? (
            <div className="mb-[14px] flex items-center gap-3">
              <a
                href={`/professionals/${encodeURIComponent(primary.id)}`}
                className="shrink-0 no-underline"
              >
                <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-full border border-white/10 bg-bgPrimary/40">
                  {primary.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={primary.avatarUrl}
                      alt={primary.businessName || ''}
                      className="block h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[18px] font-black text-textSecondary">
                      {(primary.businessName || 'P').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
              </a>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[6px] truncate text-[16px] font-black text-textPrimary">
                  <span className="truncate">
                    {primary.businessName?.trim() || 'Professional'}
                  </span>

                  {primary.isCreator ? (
                    <span className="text-[12px] leading-none text-accentPrimary">
                      ●
                    </span>
                  ) : null}
                </div>

                {proHeaderMeta ? (
                  <div className="mt-[3px] truncate text-[12px] font-semibold text-textSecondary">
                    {proHeaderMeta}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div
            className="text-[30px] font-bold leading-[1.1] text-textPrimary"
            style={{
              fontFamily: 'var(--font-display-face, "Fraunces"), Georgia, serif',
              fontStyle: 'italic',
              marginBottom: holdLabel ? 6 : 18,
            }}
          >
            When works?
          </div>

          {holdLabel ? (
            <div className="mb-4 text-[12px] font-semibold text-textSecondary">
              Hold expires{' '}
              <span
                className={
                  holdUrgent ? 'font-black text-red-400' : 'font-black text-textPrimary'
                }
              >
                {holdLabel}
              </span>
            </div>
          ) : null}

          {summary && primary && !showMobileAddressSelector ? (
            <AppointmentTypeToggle
              value={activeLocationType}
              disabled={holding}
              allowed={allowed}
              offering={offering}
              onChange={(nextType) => {
                void resetForLocationModeChange(nextType)
              }}
            />
          ) : null}

          {showMobileAddressSelector ? (
            <>
              <AppointmentTypeToggle
                value={activeLocationType}
                disabled={holding}
                allowed={allowed}
                offering={offering}
                onChange={(nextType) => {
                  void resetForLocationModeChange(nextType)
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

              {waitingForMobileAddress ? (
                <div className="py-3 text-[13px] font-semibold text-textSecondary">
                  Choose a service address to see mobile times.
                </div>
              ) : null}
            </>
          ) : null}

          {showMobileAddressSelector ? null : summaryDaysLoading ? (
            <AvailabilityDrawerSkeleton />
          ) : blockingError ? (
            <InlineRetryCard
              message={blockingError}
              onRetry={() => {
                refresh()
              }}
            />
          ) : shouldShowEmpty ? (
            <div className="py-4 text-[13px] font-semibold text-textSecondary">
              No availability found.
            </div>
          ) : null}

          <div
            data-testid={AVAILABILITY_BACKGROUND_STATUS_TEST_ID}
            aria-live="polite"
            className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
          >
            {backgroundRefreshing
              ? 'Updating availability…'
              : daySlotsRefreshingInline
                ? 'Verifying times…'
                : ''}
          </div>

          {summary && primary ? (
            <>
              {dayScrollerDays.length ? (
                <DayScroller
                  days={dayScrollerDays}
                  selectedYMD={selectedDayYMD}
                  onSelect={(ymd) => {
                    if (pendingDaySwitchMetricKeyRef.current) {
                      cancelAvailabilityMetric({
                        metric: 'day_switch_to_times_visible_ms',
                        key: pendingDaySwitchMetricKeyRef.current,
                        reason: 'superseded',
                      })
                    }

                    const nextMetricKey = buildDaySwitchMetricKey(ymd)
                    pendingDaySwitchMetricKeyRef.current = nextMetricKey

                    startAvailabilityMetric({
                      metric: 'day_switch_to_times_visible_ms',
                      key: nextMetricKey,
                      meta: {
                        previousDayYMD: selectedDayYMD,
                        nextDayYMD: ymd,
                        locationType: activeLocationType,
                        serviceId: effectiveServiceId,
                        bookingSource,
                      },
                    })

                    void hardResetUi({ deleteHold: true })
                    setSelectedDayYMD(ymd)
                  }}
                  onNearEnd={() => {
                    maybeLoadMoreDays()
                  }}
                />
              ) : null}

              {loadingMore ? (
                <div className="mb-3 overflow-hidden">
                  <div className="mb-2 text-[11px] font-semibold text-textSecondary">
                    Loading more days…
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="avail-skeleton"
                        style={{
                          height: 62,
                          width: 66,
                          flexShrink: 0,
                          borderRadius: 999,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {inlineError ? (
                <InlineRetryCard
                  message={inlineError}
                  onRetry={retryDaySlots}
                />
              ) : null}

              {daySlotsLoading ? (
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 6,
                      marginBottom: 10,
                    }}
                  >
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="avail-skeleton"
                        style={{ height: 36, borderRadius: 999 }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <div
                        key={i}
                        className="avail-skeleton"
                        style={{ height: 38, width: 62, borderRadius: 999 }}
                      />
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
                onSelectPeriod={(nextPeriod) => {
                  void hardResetUi({ deleteHold: true })
                  setPeriod(nextPeriod)
                }}
                slotsForDay={primarySlots}
                onPick={(proId, offeringId, slotISO) => {
                  void onPickSlot(proId, offeringId, slotISO)
                }}
              />

              {holding ? (
                <div
                  ref={holdStatusRef}
                  className="mb-[14px] rounded-[14px] border border-white/10 bg-bgPrimary/35 p-[12px_14px]"
                >
                  <div className="text-[13px] font-black text-textPrimary">
                    Holding your time…
                  </div>
                  <div className="mt-[3px] text-[12px] font-semibold text-textSecondary">
                    Please wait while we reserve this slot.
                  </div>
                </div>
              ) : selected?.holdId && selectedLine ? (
                <div
                  ref={holdStatusRef}
                  data-testid="availability-hold-banner"
                  className="mb-[14px] rounded-[14px] border border-accentPrimary/35 bg-accentPrimary/10 p-[14px]"
                >
                  <div className="text-[13px] font-black text-textPrimary">
                    Time held ·{' '}
                    <span className="font-black text-textPrimary">
                      {selectedLine}
                    </span>
                  </div>

                  {holdLabel ? (
                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                      Continue before{' '}
                      <span
                        className={
                          holdUrgent
                            ? 'font-black text-red-400'
                            : 'font-black text-textPrimary'
                        }
                      >
                        {holdLabel}
                      </span>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    data-testid={AVAILABILITY_HOLD_CONTINUE_BUTTON_TEST_ID}
                    onClick={() => {
                      void onContinue()
                    }}
                    className="mt-3 flex h-[46px] w-full items-center justify-center rounded-full bg-accentPrimary text-[14px] font-black tracking-[0.03em] text-bgPrimary transition hover:bg-accentPrimaryHover"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {continueLabel}
                  </button>
                </div>
              ) : null}

              {hasOtherPros && !otherProsRequested ? (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => requestOtherPros()}
                    disabled={holding || loadingAlternates || !selectedDayYMD}
                    className={[
                      'bg-transparent p-0 text-[13px] font-bold underline underline-offset-[3px] transition',
                      holding || loadingAlternates || !selectedDayYMD
                        ? 'cursor-not-allowed text-textSecondary opacity-40'
                        : 'cursor-pointer text-textSecondary decoration-white/20 hover:text-textPrimary',
                    ].join(' ')}
                  >
                    See other pros nearby
                  </button>
                </div>
              ) : null}

              {loadingAlternates ? (
                <div className="mb-3 text-[12px] font-semibold text-textSecondary">
                  Loading nearby pros…
                </div>
              ) : null}

              {otherProsInlineError ? (
                <div className="mb-[14px] rounded-[12px] border border-white/10 bg-bgPrimary/35 p-[10px_12px]">
                  <div className="text-[12px] font-semibold text-red-400">
                    {otherProsInlineError}
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshAlternates()}
                    className="mt-2 h-8 rounded-full border border-white/10 bg-bgPrimary/35 px-3 text-[12px] font-extrabold text-textPrimary transition hover:bg-white/10"
                  >
                    Retry
                  </button>
                </div>
              ) : null}

              {showLocalHint && selected?.slotISO ? (
                <div className="mb-[14px] text-[12px] font-semibold text-textSecondary">
                  Booking in{' '}
                  <span className="font-black text-textPrimary">
                    {appointmentTz}
                  </span>
                  {' · '}Your time:{' '}
                  <span className="font-black text-textPrimary">
                    {fmtInTz(selected.slotISO, viewerTz)}
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
                  others={otherProsWithSlots}
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
                    loadingPrimarySlots,
                    otherProsRequested,
                    otherProsCount: others.length,
                    loadingAlternates,
                    alternatesError,
                    alternatesAvailabilityVersion:
                      alternatesData?.availabilityVersion ?? null,
                    hasMoreDays,
                    windowStartDate: summary.windowStartDate,
                    windowEndDate: summary.windowEndDate,
                    nextStartDate: summary.nextStartDate,
                    availabilityVersion: summary.availabilityVersion,
                    generatedAt: summary.generatedAt,
                    offering,
                    allowed,
                    selectedClientAddressId,
                    mobileAddresses,
                    raw: data,
                    rawAlternates: alternatesData,
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