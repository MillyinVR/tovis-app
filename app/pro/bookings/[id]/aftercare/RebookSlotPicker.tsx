// app/pro/bookings/[id]/aftercare/RebookSlotPicker.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { isoToYmdInTimeZone } from './aftercareDates'

export type SelectedRebookSlot = {
  offeringId: string
  locationId: string
  locationType: 'SALON' | 'MOBILE'
  startsAt: string
  endsAt: string
}

type Props = {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: 'SALON' | 'MOBILE'
  locationId: string
  clientAddressId: string | null
  timeZone: string
  minYmd: string
  value: SelectedRebookSlot | null
  disabled?: boolean
  onChange: (slot: SelectedRebookSlot | null) => void
}

function parseSlots(data: unknown): { slots: string[]; durationMinutes: number } {
  if (!isRecord(data)) return { slots: [], durationMinutes: 0 }
  const rawSlots = Array.isArray(data.slots) ? data.slots : []
  const slots = rawSlots.filter((s): s is string => typeof s === 'string')
  const durationMinutes =
    typeof data.durationMinutes === 'number' && data.durationMinutes > 0
      ? data.durationMinutes
      : 0
  return { slots, durationMinutes }
}

function addMinutesIso(startIso: string, minutes: number): string {
  return new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString()
}

function slotTimeLabel(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function slotDateLabel(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Lets a pro pick a real, bookable next-appointment slot from their own
 * availability (same service + location as the source booking). Emits the full
 * slot the aftercare API needs for BOOKED_NEXT_APPOINTMENT — offering, location,
 * and concrete start/end — instead of a free-typed time the server now rejects.
 */
export default function RebookSlotPicker({
  professionalId,
  serviceId,
  offeringId,
  locationType,
  locationId,
  clientAddressId,
  timeZone,
  minYmd,
  value,
  disabled,
  onChange,
}: Props) {
  const initialDay = value?.startsAt
    ? isoToYmdInTimeZone(value.startsAt, timeZone)
    : ''

  const [day, setDay] = useState<string>(initialDay)
  const [slots, setSlots] = useState<string[]>([])
  const [durationMinutes, setDurationMinutes] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchSlots = useCallback(
    async (ymd: string) => {
      if (!offeringId || !ymd) {
        setSlots([])
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          professionalId,
          serviceId,
          locationType,
          locationId,
          date: ymd,
        })
        if (locationType === 'MOBILE' && clientAddressId) {
          params.set('clientAddressId', clientAddressId)
        }

        const res = await fetch(`/api/availability/day?${params.toString()}`, {
          signal: controller.signal,
        })
        const data = await safeJson(res)

        if (!res.ok) {
          setSlots([])
          setError(
            isRecord(data) && typeof data.error === 'string'
              ? data.error
              : 'Could not load available times.',
          )
          return
        }

        const parsed = parseSlots(data)
        setSlots(parsed.slots)
        setDurationMinutes(parsed.durationMinutes)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setSlots([])
        setError('Could not load available times. Try again.')
      } finally {
        setLoading(false)
      }
    },
    [professionalId, serviceId, offeringId, locationType, locationId, clientAddressId],
  )

  useEffect(() => {
    if (initialDay) void fetchSlots(initialDay)
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
    // Run once on mount to populate slots for a prefilled day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!offeringId) {
    return (
      <div className="mt-2 rounded-card border border-toneWarn/30 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
        This booking doesn’t have a service offering set, so an exact next
        appointment can’t be proposed. Use “Booking window” instead.
      </div>
    )
  }

  function onDayChange(nextYmd: string) {
    setDay(nextYmd)
    onChange(null)
    void fetchSlots(nextYmd)
  }

  function onPickSlot(slotIso: string) {
    if (!offeringId) return
    const minutes = durationMinutes > 0 ? durationMinutes : 60
    onChange({
      offeringId,
      locationId,
      locationType,
      startsAt: slotIso,
      endsAt: addMinutesIso(slotIso, minutes),
    })
  }

  return (
    <div className="mt-2">
      <label className="block text-xs font-black uppercase tracking-[0.08em] text-textSecondary">
        Pick a day
      </label>
      <input
        type="date"
        value={day}
        min={minYmd}
        disabled={disabled}
        onChange={(e) => onDayChange(e.target.value)}
        className="mt-1 w-full rounded-card border border-textPrimary/15 bg-bgPrimary px-3 py-2 text-sm font-semibold text-textPrimary disabled:opacity-60"
      />

      {day ? (
        <div className="mt-3">
          <div className="text-xs font-black uppercase tracking-[0.08em] text-textSecondary">
            Available times
          </div>

          {loading ? (
            <div className="mt-2 text-xs font-semibold text-textSecondary">
              Loading times…
            </div>
          ) : error ? (
            <div className="mt-2 text-xs font-semibold text-toneDanger">
              {error}
            </div>
          ) : slots.length === 0 ? (
            <div className="mt-2 text-xs font-semibold text-textSecondary">
              No open times that day. Try another date.
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {slots.map((slot) => {
                const selected = value?.startsAt === slot
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPickSlot(slot)}
                    className={[
                      'rounded-full border px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-60',
                      selected
                        ? 'border-transparent bg-cta text-onCta'
                        : 'border-textPrimary/16 text-textPrimary hover:border-textPrimary/30',
                    ].join(' ')}
                  >
                    {slotTimeLabel(slot, timeZone)}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {value ? (
        <div className="mt-3 text-xs font-semibold text-textPrimary">
          Proposing:{' '}
          <span className="font-black">
            {slotDateLabel(value.startsAt, timeZone)} ·{' '}
            {slotTimeLabel(value.startsAt, timeZone)}
          </span>
        </div>
      ) : null}

      <div className="mt-2 text-[11px] font-semibold text-textSecondary">
        Timezone: <span className="text-textPrimary">{timeZone}</span>
      </div>
    </div>
  )
}
