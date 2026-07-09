// app/pro/bookings/new/OpenSlotPicker.tsx
'use client'

// A reusable open-appointment-slot picker for the pro new-booking form — a date
// input plus the pro's real available start times for a service + location,
// fetched from GET /api/v1/availability/day (the same availability the client
// booking flow uses). Web parity port of iOS `ProOpenSlotPicker`; it replaces
// the free `datetime-local` input as the default time-selection mode.
//
// The value is the chosen slot's ISO UTC start instant (null = nothing picked);
// the parent submits it directly, so no wall-clock round-trip is needed.

import { useEffect, useRef, useState } from 'react'

import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { formatInTimeZone, sanitizeTimeZone, ymdInTimeZone } from '@/lib/time'

type ServiceLocationType = 'SALON' | 'MOBILE'

type Props = {
  professionalId: string
  serviceId: string
  offeringId: string
  locationId: string
  locationType: ServiceLocationType
  /** Timezone the availability `date` param is interpreted in (location zone). */
  locationTimeZone: string
  /** For a MOBILE booking, the client's saved service-address id so slots respect
   * the pro's travel radius. null for SALON (or an as-yet-unsaved MOBILE address). */
  clientAddressId?: string | null
  /** The chosen slot's ISO UTC start instant (null = nothing picked). */
  value: string | null
  onChange: (slot: string | null) => void
  disabled?: boolean
}

function parseSlots(raw: unknown): { slots: string[]; timeZone: string | null } {
  if (!isRecord(raw)) return { slots: [], timeZone: null }
  const slots = Array.isArray(raw.slots)
    ? raw.slots.filter((s): s is string => typeof s === 'string')
    : []
  const timeZone = typeof raw.timeZone === 'string' ? raw.timeZone : null
  return { slots, timeZone }
}

function readError(raw: unknown): string | null {
  if (isRecord(raw) && typeof raw.error === 'string' && raw.error.trim()) {
    return raw.error
  }
  return null
}

export default function OpenSlotPicker({
  professionalId,
  serviceId,
  offeringId,
  locationId,
  locationType,
  locationTimeZone,
  clientAddressId,
  value,
  onChange,
  disabled = false,
}: Props) {
  const tz = sanitizeTimeZone(locationTimeZone, 'UTC')
  // Computed once (lazy initializer) so the `min` bound is stable across renders
  // and identical on SSR + hydration.
  const [todayYmd] = useState(() => ymdInTimeZone(new Date(), tz))

  const [selectedDate, setSelectedDate] = useState(todayYmd)
  const [slots, setSlots] = useState<string[]>([])
  const [slotTimeZone, setSlotTimeZone] = useState<string | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotError, setSlotError] = useState<string | null>(null)

  // Keep `onChange` current without making it a fetch-effect dependency (a new
  // inline handler each render would otherwise re-trigger the fetch).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const fetchKey = [
    professionalId,
    serviceId,
    offeringId,
    locationId,
    locationType,
    clientAddressId ?? '',
    selectedDate,
  ].join('|')

  useEffect(() => {
    // A fresh fetch (new service/location/date) invalidates any prior pick.
    onChangeRef.current(null)
    setSlotError(null)

    if (!professionalId || !serviceId || !locationId || !selectedDate) {
      setSlots([])
      return
    }

    const ac = new AbortController()
    setLoadingSlots(true)

    ;(async () => {
      try {
        const qs = new URLSearchParams({
          professionalId,
          serviceId,
          locationType,
          locationId,
          date: selectedDate,
        })
        if (locationType === 'MOBILE' && clientAddressId) {
          qs.set('clientAddressId', clientAddressId)
        }

        const res = await fetch(`/api/v1/availability/day?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: ac.signal,
        })
        const raw = await safeJson(res)

        if (!res.ok) {
          setSlots([])
          setSlotError(readError(raw) ?? 'Couldn’t load open times.')
          return
        }

        const parsed = parseSlots(raw)
        setSlots(parsed.slots)
        setSlotTimeZone(parsed.timeZone)
      } catch (e) {
        if ((e as { name?: unknown })?.name === 'AbortError') return
        setSlots([])
        setSlotError('Couldn’t load open times.')
      } finally {
        setLoadingSlots(false)
      }
    })()

    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey])

  const displayTz = sanitizeTimeZone(slotTimeZone ?? locationTimeZone, 'UTC')

  const fieldClass =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <label htmlFor="slot-date" className="text-[12px] font-black text-textPrimary">
          Date <span className="text-textSecondary">*</span>
        </label>
        <input
          id="slot-date"
          type="date"
          value={selectedDate}
          min={todayYmd}
          disabled={disabled}
          onChange={(e) => setSelectedDate(e.target.value)}
          className={fieldClass}
        />
      </div>

      {!offeringId || !locationId ? (
        <div className="text-[12px] text-textSecondary">
          Choose a service and location to see open times.
        </div>
      ) : loadingSlots ? (
        <div className="text-[12px] text-textSecondary">Loading open times…</div>
      ) : slotError ? (
        <div className="rounded-card border border-toneDanger/20 bg-toneDanger/10 px-3 py-2 text-[12px] font-black text-toneDanger">
          {slotError}
        </div>
      ) : slots.length === 0 ? (
        <div className="text-[12px] text-textSecondary">
          No open times on this day. Try another date, or enter a custom time.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slots.map((slot) => {
            const active = value === slot
            return (
              <button
                key={slot}
                type="button"
                disabled={disabled}
                onClick={() => onChange(slot)}
                aria-pressed={active}
                className={`rounded-xl border px-2 py-2.5 text-[13px] font-black transition disabled:opacity-60 ${
                  active
                    ? 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
                    : 'border-white/10 bg-bgPrimary text-textSecondary hover:border-white/20 hover:text-textPrimary'
                }`}
              >
                {formatInTimeZone(slot, displayTz, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
