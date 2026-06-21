'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { isRecord } from '@/lib/guards'

type AvailabilityQuery = {
  professionalId: string
  serviceId: string
  locationType: string
  locationId: string
  clientAddressId: string | null
}

type Props = {
  /** The AFTERCARE_ACCESS ClientActionToken from the page URL. */
  token: string
  availability: AvailabilityQuery
  timeZone: string
  /** Recommended rebook window (ISO), if the pro set one. */
  windowStartIso: string | null
  windowEndIso: string | null
}

type SlotsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; slots: string[] }

function ymdInTimeZone(date: Date, timeZone: string): string {
  // en-CA renders YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatSlotTime(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatSlotFull(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function buildIdempotencyKey(token: string, slotIso: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `public-rebook-${token}-${slotIso}-${Date.now()}`
}

export function RebookCard({
  token,
  availability,
  timeZone,
  windowStartIso,
  windowEndIso,
}: Props) {
  const todayYmd = useMemo(
    () => ymdInTimeZone(new Date(), timeZone),
    [timeZone],
  )

  const windowStartYmd = useMemo(
    () =>
      windowStartIso
        ? ymdInTimeZone(new Date(windowStartIso), timeZone)
        : null,
    [windowStartIso, timeZone],
  )
  const windowEndYmd = useMemo(
    () =>
      windowEndIso ? ymdInTimeZone(new Date(windowEndIso), timeZone) : null,
    [windowEndIso, timeZone],
  )

  const minDate =
    windowStartYmd && windowStartYmd > todayYmd ? windowStartYmd : todayYmd
  const maxDate = windowEndYmd

  const [date, setDate] = useState<string>(minDate)
  const [slotsState, setSlotsState] = useState<SlotsState>({ kind: 'idle' })
  const [booking, setBooking] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting'; slotIso: string }
    | { kind: 'booked'; slotIso: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const withinWindow = useCallback(
    (iso: string): boolean => {
      const t = new Date(iso).getTime()
      if (windowStartIso && t < new Date(windowStartIso).getTime()) return false
      if (windowEndIso && t > new Date(windowEndIso).getTime()) return false
      return true
    },
    [windowStartIso, windowEndIso],
  )

  useEffect(() => {
    if (!date) return
    let cancelled = false

    async function load() {
      setSlotsState({ kind: 'loading' })

      const params = new URLSearchParams({
        professionalId: availability.professionalId,
        serviceId: availability.serviceId,
        locationType: availability.locationType,
        locationId: availability.locationId,
        date,
      })
      if (availability.clientAddressId) {
        params.set('clientAddressId', availability.clientAddressId)
      }

      try {
        const res = await fetch(
          `/api/availability/day?${params.toString()}`,
          { cache: 'no-store' },
        )
        const payload: unknown = await res.json().catch(() => null)
        if (cancelled) return

        if (!res.ok) {
          const message =
            isRecord(payload) && typeof payload.error === 'string'
              ? payload.error
              : 'Could not load available times for this day.'
          setSlotsState({ kind: 'error', message })
          return
        }

        const rawSlots =
          isRecord(payload) && Array.isArray(payload.slots)
            ? payload.slots.filter((s): s is string => typeof s === 'string')
            : []
        setSlotsState({ kind: 'ready', slots: rawSlots.filter(withinWindow) })
      } catch {
        if (!cancelled) {
          setSlotsState({
            kind: 'error',
            message: 'Could not load available times for this day.',
          })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [date, availability, withinWindow])

  async function handleBook(slotIso: string) {
    if (booking.kind === 'submitting') return
    setBooking({ kind: 'submitting', slotIso })

    try {
      const idempotencyKey = buildIdempotencyKey(token, slotIso)
      const res = await fetch(
        `/api/client/rebook/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({ scheduledFor: slotIso }),
        },
      )

      const payload: unknown = await res.json().catch(() => null)

      if (res.ok) {
        setBooking({ kind: 'booked', slotIso })
        return
      }

      const message =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : 'That time isn’t available anymore. Please pick another.'
      setBooking({ kind: 'error', message })
    } catch {
      setBooking({
        kind: 'error',
        message: 'Something went wrong booking that time. Please try again.',
      })
    }
  }

  if (booking.kind === 'booked') {
    return (
      <div className="rounded-card border border-toneSuccess/20 bg-toneSuccess/5 p-4">
        <div className="text-sm font-black text-textPrimary">
          Booking requested
        </div>
        <div className="mt-1 text-sm text-textSecondary">
          We’ve sent {formatSlotFull(booking.slotIso, timeZone)} to your
          professional to confirm. You’ll hear back shortly.
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-black text-textSecondary">
            Pick a day
          </span>
          <input
            type="date"
            value={date}
            min={minDate}
            max={maxDate ?? undefined}
            onChange={(e) => {
              setBooking({ kind: 'idle' })
              setDate(e.target.value)
            }}
            className="rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm font-semibold text-textPrimary"
          />
        </label>
        <div className="text-[12px] text-textSecondary/75">
          Times shown in {timeZone}
        </div>
      </div>

      <div className="mt-4">
        {slotsState.kind === 'loading' ? (
          <div className="text-sm text-textSecondary">Loading times…</div>
        ) : slotsState.kind === 'error' ? (
          <div className="text-sm text-textSecondary">{slotsState.message}</div>
        ) : slotsState.kind === 'ready' && slotsState.slots.length === 0 ? (
          <div className="text-sm text-textSecondary">
            No open times on this day. Try another day
            {maxDate ? ' within your recommended window' : ''}.
          </div>
        ) : slotsState.kind === 'ready' ? (
          <div className="flex flex-wrap gap-2">
            {slotsState.slots.map((iso) => {
              const isSubmitting =
                booking.kind === 'submitting' && booking.slotIso === iso
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => void handleBook(iso)}
                  disabled={booking.kind === 'submitting'}
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-sm font-black text-textPrimary transition hover:bg-surfaceGlass disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Booking…' : formatSlotTime(iso, timeZone)}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {booking.kind === 'error' ? (
        <div className="mt-3 rounded-card border border-toneDanger/20 bg-toneDanger/5 px-3 py-2 text-xs font-semibold text-toneDanger">
          {booking.message}
        </div>
      ) : null}
    </div>
  )
}
