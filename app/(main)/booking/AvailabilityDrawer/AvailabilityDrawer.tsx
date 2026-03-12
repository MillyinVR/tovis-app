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

import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'

const FALLBACK_TZ = 'UTC' as const
const MOBILE_ADDRESS_REQUIRED_MESSAGE =
  'Select a saved service address before viewing mobile availability.'

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

const EMPTY_DAYS: Array<{ date: string; slotCount: number }> = []

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function pickErrorMessage(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const value = raw.error
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
  viewerTimeZone?: string
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

  const v =
    typeof args.viewerTimeZone === 'string'
      ? args.viewerTimeZone.trim()
      : ''
  if (v && isValidIanaTimeZone(v)) return v

  return FALLBACK_TZ
}

function buildDayScrollerModel(
  days: Array<{ date: string; slotCount: number }>,
  appointmentTz: string,
) {
  return days.map((d) => {
    const anchor = new Date(`${d.date}T12:00:00.000Z`)

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
}) {
  const { open, onClose, context } = props

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
    refreshing,
    error: availabilityError,
    data,
    setError,
  } = useAvailability(open, context, locationType, selectedClientAddressId)

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
      viewerTimeZone: viewerTz,
    })
    return sanitizeTimeZone(resolved, FALLBACK_TZ)
  }, [summary?.timeZone, primary?.timeZone, viewerTz])

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
    for (const p of summary.otherPros) {
      map[p.id] = p.locationId
    }

    return map
  }, [summary])

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
  } = useDaySlots({
    open,
    summary,
    selectedDayYMD,
    activeLocationType,
    effectiveServiceId,
    selectedClientAddressId,
    debug,
    holding,
    setError,
  })

  const noPrimarySlots = Boolean(primary && primarySlots.length === 0)

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
    clearDaySlots()
    clearDaySlotCache()
    setLocationType(null)
    resetMobileAddressState()

    void hardResetUi({ deleteHold: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    context.mediaId,
    context.professionalId,
    context.serviceId,
    context.offeringId,
    context.source,
  ])

  useEffect(() => {
    if (!open) return
    if (!summary) return
    if (loading) return
    if (holding) return
    if (selectedHoldIdRef.current) return

    if (locationType == null && summary.locationType) {
      setLocationType(summary.locationType)
    }
  }, [open, summary, loading, holding, locationType])

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
    setError('That hold expired. Pick another time.')
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

  function scrollToOtherPros() {
    otherProsRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
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
        throw new Error(pickErrorMessage(raw) ?? `Hold failed (${res.status}).`)
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

  function onContinue() {
    if (!selected?.holdId || !selected?.offeringId || holding) return

    const qs = new URLSearchParams({
      holdId: selected.holdId,
      offeringId: selected.offeringId,
      locationType: activeLocationType,
      source: bookingSource,
    })

    if (context.mediaId) {
      qs.set('mediaId', context.mediaId)
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
            <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-textSecondary">
              Loading availability…
            </div>
          ) : displayError ? (
            <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-toneDanger">
              {displayError}
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
                />
              ) : null}

              {loadingPrimarySlots ? (
                <div className="mb-3 text-xs font-semibold text-textSecondary">
                  Loading times…
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