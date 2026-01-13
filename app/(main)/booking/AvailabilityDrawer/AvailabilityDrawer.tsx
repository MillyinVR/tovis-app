// app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx
'use client'

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import type { DrawerContext, SelectedHold, ServiceLocationType, AvailabilityDayResponse } from './types'
import { STICKY_CTA_H } from './constants'
import DrawerShell from './components/DrawerShell'
import ProCard from './components/ProCard'
import AppointmentTypeToggle from './components/AppointmentTypeToggle'
import SlotChips from './components/SlotChips'
import WaitlistPanel from './components/WaitlistPanel'
import OtherPros from './components/OtherPros'
import StickyCTA from './components/StickyCTA'
import DebugPanel from './components/DebugPanel'

import { safeJson } from './utils/safeJson'
import { redirectToLogin } from './utils/authRedirect'
import { parseHoldResponse, deleteHoldById } from './utils/hold'
import { getViewerTimeZone, fmtInViewerTz, fmtSelectedLineInTimeZone, getHourInTimeZone } from './utils/timezones'

import { useAvailability } from './hooks/useAvailability'
import { useHoldTimer } from './hooks/useHoldTimer'
import { useDebugFlag } from './hooks/useDebugFlag'

type CreateBookingApiResponse =
  | { ok: true; booking: { id: string } }
  | { ok: false; error?: string }

type Period = 'MORNING' | 'AFTERNOON' | 'EVENING'

function periodOfHour(h: number): Period {
  if (h < 12) return 'MORNING'
  if (h < 17) return 'AFTERNOON'
  return 'EVENING'
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

  const viewerTz = useMemo(() => getViewerTimeZone(), [])
  const otherProsRef = useRef<HTMLDivElement | null>(null)

  const { loading, error, data, setError } = useAvailability(open, context)

  const [locationType, setLocationType] = useState<ServiceLocationType>('SALON')

  const [selected, setSelected] = useState<SelectedHold | null>(null)
  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const [holding, setHolding] = useState(false)

  const [selectedDayYMD, setSelectedDayYMD] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('AFTERNOON')

  // day slots (primary + others)
  const [primarySlots, setPrimarySlots] = useState<string[]>([])
  const [otherSlots, setOtherSlots] = useState<Record<string, string[]>>({}) // proId -> slots

  const { label: holdLabel, urgent: holdUrgent, expired: holdExpired } = useHoldTimer(holdUntil)

  const primary = data?.primaryPro ?? null
  const others = data?.otherPros ?? []
  const days = data?.availableDays ?? []

  const appointmentTz = useMemo(() => {
    return data?.timeZone || primary?.timeZone || viewerTz || 'America/Los_Angeles'
  }, [data?.timeZone, primary?.timeZone, viewerTz])

  const showLocalHint = Boolean(viewerTz && viewerTz !== appointmentTz)

  const effectiveServiceId = data?.serviceId ?? context?.serviceId ?? null
  const canWaitlist = Boolean(data?.waitlistSupported && context?.professionalId && effectiveServiceId)

  const noPrimarySlots = Boolean(primary && (!primarySlots || primarySlots.length === 0))

  const viewProServicesHref =
    primary ? `/professionals/${encodeURIComponent(primary.id)}?tab=services` : '/looks'

  const statusLine = useMemo(() => {
    if (!effectiveServiceId) return 'No service linked to this look yet.'
    return 'Matched to this service'
  }, [effectiveServiceId])

  const hardResetUi = useCallback(
    async (args?: { deleteHold?: boolean }) => {
      if (args?.deleteHold && selected?.holdId) await deleteHoldById(selected.holdId).catch(() => {})
      setSelected(null)
      setHoldUntil(null)
      setHolding(false)
      setError(null)
    },
    [selected?.holdId, setError],
  )

  // Reset day selection when opening a new context (prevents stale day sticking)
  useEffect(() => {
    if (!open) return
    setSelectedDayYMD(null)
    setPrimarySlots([])
    setOtherSlots({})
    void hardResetUi({ deleteHold: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context?.mediaId, context?.professionalId, context?.serviceId])

  // Default selected day = first available day from summary
  useEffect(() => {
    if (!open) return
    if (!days?.length) return
    setSelectedDayYMD((cur) => cur ?? days[0].date)
  }, [open, days])

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

  function scrollToOtherPros() {
    otherProsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Fetch day slots for a pro for the selected day
  const fetchDaySlots = useCallback(
    async (args: { proId: string; ymd: string; locationType: ServiceLocationType }) => {
      if (!context?.serviceId) return []
      const qs = new URLSearchParams({
        professionalId: args.proId,
        serviceId: context.serviceId,
        date: args.ymd,
        locationType: args.locationType,
      })

      const res = await fetch(`/api/availability/day?${qs.toString()}`, { method: 'GET', cache: 'no-store' })
      const body = (await safeJson(res)) as AvailabilityDayResponse | any
      if (!res.ok || !body?.ok) return []
      return Array.isArray(body.slots) ? (body.slots as string[]) : []
    },
    [context?.serviceId],
  )

  // When selected day or locationType changes, load slots for that day (primary + other pros)
  useEffect(() => {
    if (!open) return
    if (!data?.ok || !primary?.id || !selectedDayYMD) return

    let cancelled = false

    ;(async () => {
      try {
        setPrimarySlots([])
        setOtherSlots({})

        const [pSlots, ...oSlots] = await Promise.all([
          fetchDaySlots({ proId: primary.id, ymd: selectedDayYMD, locationType }),
          ...others.map(async (p) => {
            const slots = await fetchDaySlots({ proId: p.id, ymd: selectedDayYMD, locationType })
            return { proId: p.id, slots }
          }),
        ])

        if (cancelled) return

        setPrimarySlots(pSlots)

        const map: Record<string, string[]> = {}
        for (const row of oSlots) map[row.proId] = row.slots
        setOtherSlots(map)
      } catch {
        if (cancelled) return
        setPrimarySlots([])
        setOtherSlots({})
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, data?.ok, primary?.id, others, selectedDayYMD, locationType, fetchDaySlots])

  // Auto-adjust period if selected period has no slots for the day
  useEffect(() => {
    if (!open) return
    if (!primarySlots?.length) return

    const counts = { MORNING: 0, AFTERNOON: 0, EVENING: 0 } as Record<Period, number>
    for (const iso of primarySlots) {
      const h = getHourInTimeZone(iso, appointmentTz)
      if (h == null) continue
      counts[periodOfHour(h)]++
    }

    if (counts[period] > 0) return

    const preferred: Period[] = ['AFTERNOON', 'MORNING', 'EVENING']
    const next = preferred.find((p) => counts[p] > 0)
    if (next && next !== period) setPeriod(next)
  }, [open, primarySlots, appointmentTz, period])

  async function onPickSlot(proId: string, offeringId: string | null, slotISO: string, proTimeZone?: string | null) {
    if (!offeringId) return
    if (holding) return

    const tz = proTimeZone || appointmentTz
    setError(null)

    // kill old hold
    if (selected?.holdId) await deleteHoldById(selected.holdId).catch(() => {})

    setSelected(null)
    setHoldUntil(null)

    setHolding(true)
    try {
      const res = await fetch('/api/holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId,
          scheduledFor: slotISO, // UTC ISO
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
        offeringId,
        slotISO: parsed.scheduledForISO,
        proTimeZone: tz,
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

  async function onContinue() {
    if (!selected?.holdId || !selected?.offeringId) return
    if (holding) return

    setHolding(true)
    setError(null)

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offeringId: selected.offeringId,
          holdId: selected.holdId,
          source: 'DISCOVERY',
          locationType,
          mediaId: context?.mediaId ?? null,
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'book')
        return
      }

      const body = (await safeJson(res)) as CreateBookingApiResponse

      if (!res.ok || !body?.ok) {
        throw new Error((body as any)?.error || `Booking failed (${res.status}).`)
      }

      const bookingId = body.booking?.id
      if (!bookingId) throw new Error('Booking succeeded but no booking id was returned.')

      setSelected(null)
      setHoldUntil(null)

      onClose()
      router.push(`/booking/${encodeURIComponent(bookingId)}`)
    } catch (e: any) {
      setError(e?.message || 'Failed to book. Try again.')
    } finally {
      setHolding(false)
    }
  }

  const selectedLine = selected?.slotISO ? fmtSelectedLineInTimeZone(selected.slotISO, appointmentTz) : null

  const header = (
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
  )

  const body = (
    <div className="looksNoScrollbar overflow-y-auto px-4 pb-4" style={{ paddingBottom: STICKY_CTA_H + 14 }}>
      {loading ? (
        <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-textSecondary">Loading…</div>
      ) : error ? (
        <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-toneDanger">{error}</div>
      ) : !data || !primary ? (
        <div className="tovis-glass-soft rounded-card p-4 text-sm font-semibold text-textSecondary">
          No availability found.
        </div>
      ) : (
        <>
          <ProCard
            pro={primary as any}
            appointmentTz={appointmentTz}
            viewerTz={viewerTz}
            statusLine={statusLine}
            showFallbackActions={false}
            viewProServicesHref={viewProServicesHref}
            onScrollToOtherPros={scrollToOtherPros}
          />

          <AppointmentTypeToggle
            value={locationType}
            disabled={holding}
            onChange={(t) => {
              void hardResetUi({ deleteHold: true })
              setLocationType(t)
            }}
          />

          <SlotChips
            pro={primary}
            appointmentTz={appointmentTz}
            holding={holding}
            selected={selected}
            days={days}
            selectedDayYMD={selectedDayYMD}
            onSelectDay={(ymd) => {
              void hardResetUi({ deleteHold: true })
              setSelectedDayYMD(ymd)
            }}
            period={period}
            onSelectPeriod={(p) => {
              void hardResetUi({ deleteHold: true })
              setPeriod(p)
            }}
            slotsForDay={primarySlots}
            onPick={onPickSlot}
          />

          {showLocalHint && selected?.slotISO ? (
            <div className="tovis-glass-soft mb-3 rounded-card p-3 text-[12px] font-semibold text-textSecondary">
              You’re booking <span className="font-black text-textPrimary">{appointmentTz}</span> time.
              <span className="ml-2">
                Your local time:{' '}
                <span className="font-black text-textPrimary">{fmtInViewerTz(selected.slotISO)}</span>
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
            others={(others || []).map((p) => ({
              ...p,
              slots: otherSlots[p.id] || [],
            }))}
            effectiveServiceId={effectiveServiceId}
            viewerTz={viewerTz}
            appointmentTz={appointmentTz}
            holding={holding}
            selected={selected}
            onPick={onPickSlot}
            setRef={(el) => (otherProsRef.current = el)}
          />

          {debug ? (
            <DebugPanel
              payload={{
                appointmentTz,
                viewerTz,
                selected,
                holdUntil,
                locationType,
                effectiveServiceId,
                selectedDayYMD,
                period,
                primarySlotsCount: primarySlots.length,
                raw: data,
              }}
            />
          ) : null}
        </>
      )}
    </div>
  )

  const footer = (
    <StickyCTA
      canContinue={Boolean(selected?.holdId && holdUntil)}
      loading={holding}
      onContinue={onContinue}
      selectedLine={selectedLine}
    />
  )

  if (!open || !context) return null

  return (
    <DrawerShell
      open={open}
      onClose={() => {
        void hardResetUi({ deleteHold: true })
        onClose()
      }}
      header={header}
      footer={footer}
    >
      {body}
    </DrawerShell>
  )
}
