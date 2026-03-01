// app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx
'use client'

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import type {
  DrawerContext,
  SelectedHold,
  ServiceLocationType,
  AvailabilityDayResponse,
  BookingSource,
  AvailabilitySummaryResponse,
  AvailabilityOffering,
  ProCard as ProCardType,
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

import { safeJson } from './utils/safeJson'
import { redirectToLogin } from './utils/authRedirect'
import { parseHoldResponse, deleteHoldById } from './utils/hold'
import { useAvailability } from './hooks/useAvailability'
import { useHoldTimer } from './hooks/useHoldTimer'
import { useDebugFlag } from './hooks/useDebugFlag'

import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'

/**
 * ✅ No Los Angeles fallback anywhere in the UI.
 * UTC is a neutral "we have nothing" fallback.
 */
const FALLBACK_TZ = 'UTC' as const

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

const EMPTY_DAYS: Array<{ date: string; slotCount: number }> = []
const EMPTY_PROS: any[] = []

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

/**
 * YYYY-MM-DD in the given timezone (no LA fallback).
 */
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
  if (context?.source) return context.source
  if (context?.mediaId) return 'DISCOVERY'
  return 'REQUESTED'
}

type AvailabilitySummaryOk = Extract<AvailabilitySummaryResponse, { ok: true; mode: 'SUMMARY' }>

function isSummary(data: unknown): data is AvailabilitySummaryOk {
  return Boolean(
    data &&
      typeof data === 'object' &&
      (data as any).ok === true &&
      (data as any).mode === 'SUMMARY',
  )
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

/**
 * Appointment tz MUST come from server (location tz) when available.
 * Viewer tz is for hints only.
 */
function resolveAppointmentTimeZone(args: {
  summaryTimeZone?: unknown
  primaryProTimeZone?: unknown
  viewerTimeZone?: string
}) {
  const s = typeof args.summaryTimeZone === 'string' ? args.summaryTimeZone.trim() : ''
  if (s && isValidIanaTimeZone(s)) return s

  const p = typeof args.primaryProTimeZone === 'string' ? args.primaryProTimeZone.trim() : ''
  if (p && isValidIanaTimeZone(p)) return p

  const v = typeof args.viewerTimeZone === 'string' ? args.viewerTimeZone.trim() : ''
  if (v && isValidIanaTimeZone(v)) return v

  return FALLBACK_TZ
}

function buildDayScrollerModel(days: Array<{ date: string; slotCount: number }>, appointmentTz: string) {
  return (days || []).map((d) => {
    // Anchor at noon UTC so formatting doesn't jump around DST edges.
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

export default function AvailabilityDrawer({
  open,
  onClose,
  context,
}: {
  open: boolean
  onClose: () => void
  context: DrawerContext
}) {
  const router = useRouter()
  const debug = useDebugFlag()

  // viewer tz: computed once on mount; never LA fallback.
  const [viewerTz, setViewerTz] = useState<string>(FALLBACK_TZ)
  useEffect(() => {
    setViewerTz(getViewerTimeZoneClient())
  }, [])

  const otherProsRef = useRef<HTMLDivElement | null>(null)

  const [locationType, setLocationType] = useState<ServiceLocationType>('SALON')

  const { loading, error, data, setError } = useAvailability(open, context, locationType)
  const summary = isSummary(data) ? data : null

  const primary = summary?.primaryPro ?? null
  const others = summary?.otherPros ?? EMPTY_PROS
  const days = summary?.availableDays ?? EMPTY_DAYS
  const offering: AvailabilityOffering = summary?.offering ?? FALLBACK_OFFERING

  const allowed = useMemo(
    () => ({
      salon: Boolean(offering.offersInSalon),
      mobile: Boolean(offering.offersMobile),
    }),
    [offering.offersInSalon, offering.offersMobile],
  )

  const [selected, setSelected] = useState<SelectedHold | null>(null)
  const selectedHoldIdRef = useRef<string | null>(null)
  useEffect(() => {
    selectedHoldIdRef.current = selected?.holdId ?? null
  }, [selected?.holdId])

  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const [holding, setHolding] = useState(false)

  const [selectedDayYMD, setSelectedDayYMD] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('AFTERNOON')

  const [primarySlots, setPrimarySlots] = useState<string[]>([])
  const [otherSlots, setOtherSlots] = useState<Record<string, string[]>>({})

  const { label: holdLabel, urgent: holdUrgent, expired: holdExpired } = useHoldTimer(holdUntil)

  const appointmentTz = useMemo(() => {
    const resolved = resolveAppointmentTimeZone({
      summaryTimeZone: summary?.timeZone,
      primaryProTimeZone: primary?.timeZone,
      viewerTimeZone: viewerTz,
    })
    return sanitizeTimeZone(resolved, FALLBACK_TZ)
  }, [summary?.timeZone, primary?.timeZone, viewerTz])

  const showLocalHint = viewerTz !== appointmentTz

  // Service id must exist for day calls; summary wins if present.
  const effectiveServiceId = summary?.serviceId ?? context?.serviceId ?? null

  const bookingSource = resolveBookingSource(context)

  const canWaitlist = Boolean(summary?.waitlistSupported && context?.professionalId && effectiveServiceId)
  const noPrimarySlots = Boolean(primary && primarySlots.length === 0)

  const viewProServicesHref = primary ? `/professionals/${encodeURIComponent(primary.id)}?tab=services` : '/looks'

  const statusLine = useMemo(() => {
    if (!effectiveServiceId) return 'No service linked yet.'
    return 'Matched to this service'
  }, [effectiveServiceId])

  const primaryId = useMemo(() => {
    return primary?.id ? String(primary.id) : context?.professionalId ? String(context.professionalId) : ''
  }, [primary?.id, context?.professionalId])

  const resolvedOfferingId = useMemo(() => {
    // ✅ summary wins (canonical)
    if (summary?.offering?.id) return summary.offering.id
    // ✅ fallback to context if provided
    return context?.offeringId ?? null
  }, [summary?.offering?.id, context?.offeringId])

  // stable key for days (prevents infinite effect loops due to new array identities)
  const daysKey = useMemo(() => {
    if (!days || days.length === 0) return ''
    return days.map((d) => `${d.date}:${d.slotCount}`).join('|')
  }, [days])

  // build day scroller model (hook MUST be before any early return)
  const dayScrollerDays = useMemo(() => buildDayScrollerModel(days, appointmentTz), [daysKey, appointmentTz])

  const hardResetUi = useCallback(
    async (args?: { deleteHold?: boolean }) => {
      const holdId = selectedHoldIdRef.current
      if (args?.deleteHold && holdId) await deleteHoldById(holdId).catch(() => {})
      setSelected(null)
      setHoldUntil(null)
      setHolding(false)
      setError(null)
    },
    [setError],
  )

  // Reset on open/context change
  useEffect(() => {
    if (!open) return
    setSelectedDayYMD(null)
    setPeriod('AFTERNOON')
    setPrimarySlots([])
    setOtherSlots({})
    void hardResetUi({ deleteHold: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context?.mediaId, context?.professionalId, context?.serviceId, context?.offeringId, context?.source])

  // Sync locationType to server after fetch completes (no snapback during refetch)
  useEffect(() => {
    if (!open) return
    if (!summary) return
    if (loading) return
    if (holding) return
    if (selectedHoldIdRef.current) return

    const serverType = summary.locationType
    if (serverType && serverType !== locationType) {
      void hardResetUi({ deleteHold: true })
      setSelectedDayYMD(null)
      setPrimarySlots([])
      setOtherSlots({})
      setLocationType(serverType)
    }
  }, [open, summary, loading, holding, locationType, hardResetUi])

  // If only one mode allowed, force it
  useEffect(() => {
    if (!open) return
    if (!summary) return

    if (allowed.salon && allowed.mobile) return

    if (allowed.salon && !allowed.mobile && locationType !== 'SALON') {
      void hardResetUi({ deleteHold: true })
      setLocationType('SALON')
      setSelectedDayYMD(null)
      return
    }
    if (!allowed.salon && allowed.mobile && locationType !== 'MOBILE') {
      void hardResetUi({ deleteHold: true })
      setLocationType('MOBILE')
      setSelectedDayYMD(null)
      return
    }
  }, [open, summary, allowed.salon, allowed.mobile, locationType, hardResetUi])

  /**
   * Default day selection (NO infinite loop):
   * - Prefer summary.availableDays[0]
   * - Else fallback = "today in appointment tz"
   */
  useEffect(() => {
    if (!open) return

    const fallback = ymdInTz(appointmentTz)
    const first = days?.[0]?.date ?? null

    setSelectedDayYMD((cur) => {
      const nextBase = first ?? fallback
      if (!nextBase) return cur ?? null
      if (!cur) return nextBase

      if (days && days.length > 0) {
        const exists = days.some((d) => d.date === cur)
        return exists ? cur : nextBase
      }

      return cur
    })
  }, [open, appointmentTz, daysKey])

  // ESC close
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

  // lock scroll
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // hold expired
  useEffect(() => {
    if (!holdExpired) return
    setHoldUntil(null)
    setSelected(null)
    setError('That hold expired. Pick another time.')
  }, [holdExpired, setError])

  function scrollToOtherPros() {
    otherProsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const fetchDaySlots = useCallback(
    async (args: { proId: string; ymd: string; locationType: ServiceLocationType; isPrimary: boolean }) => {
      if (!effectiveServiceId) return []

      const qs = new URLSearchParams({
        professionalId: args.proId,
        serviceId: effectiveServiceId,
        date: args.ymd,
        locationType: args.locationType,
      })

      if (debug) qs.set('debug', '1')

      const res = await fetch(`/api/availability/day?${qs.toString()}`, { method: 'GET', cache: 'no-store' })
      const body = (await safeJson(res)) as AvailabilityDayResponse | any

      if (res.status === 401) return []
      if (!res.ok || !body?.ok) {
        if (args.isPrimary) {
          const msg = typeof body?.error === 'string' ? body.error : `Couldn’t load times (${res.status}).`
          setError(msg)
        }
        return []
      }

      return Array.isArray(body.slots) ? (body.slots as string[]) : []
    },
    [effectiveServiceId, debug, setError],
  )

  const othersKey = useMemo(() => {
    if (!others || others.length === 0) return ''
    return others.map((p: any) => String(p.id)).join('|')
  }, [others])

  /**
   * Load day slots whenever open + day selected + have a primaryId.
   */
  useEffect(() => {
    if (!open) return
    if (!selectedDayYMD) return
    if (!primaryId) return

    let cancelled = false

    ;(async () => {
      try {
        setPrimarySlots([])
        setOtherSlots({})

        if (!holding) setError(null)

        const [pSlots, ...oSlots] = await Promise.all([
          fetchDaySlots({ proId: primaryId, ymd: selectedDayYMD, locationType, isPrimary: true }),
          ...(primary?.id
            ? others.map(async (p: any) => {
                const slots = await fetchDaySlots({
                  proId: String(p.id),
                  ymd: selectedDayYMD,
                  locationType,
                  isPrimary: false,
                })
                return { proId: String(p.id), slots }
              })
            : []),
        ])

        if (cancelled) return

        setPrimarySlots(pSlots)

        const map: Record<string, string[]> = {}
        for (const row of oSlots as Array<{ proId: string; slots: string[] }>) map[row.proId] = row.slots
        setOtherSlots(map)
      } catch {
        if (cancelled) return
        setPrimarySlots([])
        setOtherSlots({})
        setError('Network error loading times.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, selectedDayYMD, locationType, primaryId, fetchDaySlots, holding, setError, primary?.id, othersKey])

  // auto-switch period if empty
  useEffect(() => {
    if (!open) return
    if (!primarySlots || primarySlots.length === 0) return

    const counts = { MORNING: 0, AFTERNOON: 0, EVENING: 0 } as Record<Period, number>
    for (const iso of primarySlots) {
      const h = hourInTz(iso, appointmentTz)
      if (h == null) continue
      counts[periodOfHour(h)]++
    }

    if (counts[period] > 0) return

    const preferred: Period[] = ['AFTERNOON', 'MORNING', 'EVENING']
    const next = preferred.find((p) => counts[p] > 0)
    if (next && next !== period) setPeriod(next)
  }, [open, primarySlots, appointmentTz, period])

  async function onPickSlot(proId: string, offeringId: string | null, slotISO: string) {
    const effOfferingId = offeringId || resolvedOfferingId
    if (!effOfferingId) return
    if (holding) return

    setError(null)

    const existingHoldId = selectedHoldIdRef.current
    if (existingHoldId) await deleteHoldById(existingHoldId).catch(() => {})

    setSelected(null)
    setHoldUntil(null)

    setHolding(true)
    try {
      const res = await fetch('/api/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId: effOfferingId,
          scheduledFor: slotISO,
          locationType,
        }),
      })

      const body = await safeJson(res)

      if (res.status === 401) {
        redirectToLogin(router, 'hold')
        return
      }

      if (!res.ok || !body?.ok) throw new Error(body?.error || `Hold failed (${res.status}).`)

      const parsed = parseHoldResponse(body)

      setSelected({
        proId,
        offeringId: effOfferingId,
        slotISO: parsed.scheduledForISO,
        proTimeZone: appointmentTz, // legacy field; correct appointment tz now
        holdId: parsed.holdId,
      })
      setHoldUntil(parsed.holdUntilMs)

      if (parsed.locationType) setLocationType(parsed.locationType)
    } catch (e: any) {
      setError(e?.message || 'Failed to hold that time. Try another slot.')
    } finally {
      setHolding(false)
    }
  }

  function onContinue() {
    if (!selected?.holdId || !selected?.offeringId) return
    if (holding) return

    const qs = new URLSearchParams({
      holdId: selected.holdId,
      offeringId: selected.offeringId,
      locationType,
      source: bookingSource,
    })

    if (context?.mediaId) qs.set('mediaId', context.mediaId)

    onClose()
    router.push(`/booking/add-ons?${qs.toString()}`)
  }

  const selectedLine = selected?.slotISO ? fmtSelectedLine(selected.slotISO, appointmentTz) : null

  // ✅ Early return is now SAFE because ALL hooks are above this line.
  if (!open || !context) return null

  const canRenderSummary = Boolean(summary && primary)
  const shouldShowLoading = loading && !summary
  const shouldShowEmpty = !error && !shouldShowLoading && (!canRenderSummary && !context?.professionalId)

  return (
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
                <div className="text-sm font-black text-textPrimary">Availability</div>
                <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
                  Pick a time. We hold it for you.
                  {holdLabel ? (
                    <span className={['ml-2 font-black', holdUrgent ? 'text-toneDanger' : 'text-textPrimary'].join(' ')}>
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
      <div className="looksNoScrollbar overflow-y-auto px-4 pb-4" style={{ paddingBottom: STICKY_CTA_H + 14 }}>
        {shouldShowLoading ? (
          <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-textSecondary">
            Loading availability…
          </div>
        ) : error ? (
          <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-toneDanger">{error}</div>
        ) : shouldShowEmpty ? (
          <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-textSecondary">
            No availability found.
          </div>
        ) : (
          (() => {
            const primaryPro: ProCardType | null = canRenderSummary ? (primary as ProCardType) : null

            return (
              <>
                {primaryPro ? (
                  <ProCard
                    pro={primaryPro as any}
                    appointmentTz={appointmentTz}
                    viewerTz={viewerTz}
                    statusLine={statusLine}
                    showFallbackActions={false}
                    viewProServicesHref={viewProServicesHref}
                    onScrollToOtherPros={scrollToOtherPros}
                  />
                ) : null}

                <ServiceContextCard
                  serviceName={(summary as any)?.serviceName ?? null}
                  categoryName={(summary as any)?.serviceCategoryName ?? null}
                  offering={offering}
                  locationType={locationType}
                />

                <AppointmentTypeToggle
                  value={locationType}
                  disabled={holding}
                  allowed={allowed}
                  offering={offering}
                  onChange={(t) => {
                    void hardResetUi({ deleteHold: true })
                    setLocationType(t)
                    setSelectedDayYMD(null)
                    setPrimarySlots([])
                    setOtherSlots({})
                  }}
                />

                {/* ✅ Day picker restored */}
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

                <SlotChips
                  pro={
                    (primaryPro as any) ??
                    ({
                      id: primaryId,
                      offeringId: resolvedOfferingId,
                      timeZone: appointmentTz,
                    } as any)
                  }
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

                {showLocalHint && selected?.slotISO ? (
                  <div className="tovis-glass-soft mb-3 rounded-card p-3 text-[12px] font-semibold text-textSecondary">
                    You’re booking <span className="font-black text-textPrimary">{appointmentTz}</span> time.
                    <span className="ml-2">
                      Your local time:{' '}
                      <span className="font-black text-textPrimary">{fmtInTz(selected.slotISO, viewerTz)}</span>
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

                {primaryPro ? (
                  <OtherPros
                    others={(others || []).map((p: any) => ({ ...p, slots: otherSlots[String(p.id)] || [] }))}
                    effectiveServiceId={effectiveServiceId}
                    viewerTz={viewerTz}
                    appointmentTz={appointmentTz}
                    holding={holding}
                    selected={selected}
                    onPick={(proId, offeringId, slotISO) => onPickSlot(proId, offeringId, slotISO)}
                    setRef={(el) => (otherProsRef.current = el)}
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
                      locationType,
                      effectiveServiceId,
                      selectedDayYMD,
                      period,
                      primarySlotsCount: primarySlots.length,
                      offering,
                      allowed,
                      raw: data,
                    }}
                  />
                ) : null}
              </>
            )
          })()
        )}
      </div>
    </DrawerShell>
  )
}