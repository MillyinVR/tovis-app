'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { isRecord } from '@/lib/guards'
import {
  DAY_PERIOD_ORDER,
  firstNonEmptyPeriod,
  groupSlotsByPeriod,
  type DayPeriod,
} from '@/lib/bookingTime'
import { friendlyTimeZoneLabel } from '@/lib/timeZone'
import { formatInTimeZone } from '@/lib/time'

const PERIOD_LABEL: Record<DayPeriod, string> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
}

const PERIOD_EMPTY_COPY: Record<DayPeriod, string> = {
  MORNING: 'No morning times on this day.',
  AFTERNOON: 'No afternoon times on this day.',
  EVENING: 'No evening times on this day.',
}

/**
 * A location mode (in-salon / mobile) the client may rebook into, with the
 * availability-query identifiers it needs. Built server-side so the card only
 * ever shows modes that are actually bookable on this public link.
 */
export type PublicRebookLocationMode = {
  type: 'SALON' | 'MOBILE'
  label: string
  /** Empty string lets the availability API resolve the pro's default location. */
  locationId: string
  /** The ORIGINAL visit's saved address (MOBILE); null for SALON or when the
   * original had none — a picker selection from `savedAddresses` wins over it. */
  clientAddressId: string | null
}

/**
 * A saved client service address offered as the destination of a MOBILE
 * rebook. Loaded server-side from the token's client, so this public card
 * never calls an authenticated address API.
 */
export type PublicRebookSavedAddress = {
  id: string
  label: string | null
  formattedAddress: string
  isDefault: boolean
}

type Props = {
  /** The AFTERCARE_ACCESS ClientActionToken from the page URL. */
  token: string
  professionalId: string
  serviceId: string
  timeZone: string
  /** Recommended rebook window (ISO), if the pro set one. */
  windowStartIso: string | null
  windowEndIso: string | null
  /** Bookable location modes (1 = no toggle, 2 = in-salon/mobile toggle). */
  locationModes: PublicRebookLocationMode[]
  initialLocationType: 'SALON' | 'MOBILE'
  /** Pickable destinations for MOBILE (empty = fall back to the original visit's address). */
  savedAddresses: PublicRebookSavedAddress[]
}

type SlotsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; slots: string[] }

function ymdInTimeZone(date: Date, timeZone: string): string {
  // en-CA renders YYYY-MM-DD.
  return formatInTimeZone(
    date,
    timeZone,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
    'en-CA',
  )
}

function formatSlotTime(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return formatInTimeZone(date, timeZone, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatSlotFull(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return formatInTimeZone(date, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildIdempotencyKey(token: string, slotIso: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `public-rebook-${token}-${slotIso}-${Date.now()}`
}

export function RebookCard({
  token,
  professionalId,
  serviceId,
  timeZone,
  windowStartIso,
  windowEndIso,
  locationModes,
  initialLocationType,
  savedAddresses,
}: Props) {
  const [locationType, setLocationType] = useState<'SALON' | 'MOBILE'>(
    initialLocationType,
  )

  const activeMode = useMemo(
    () =>
      locationModes.find((mode) => mode.type === locationType) ??
      locationModes[0],
    [locationModes, locationType],
  )

  // Mobile destination: default to the original visit's address when it's
  // still in the saved list, else the client's default/first saved address.
  // Null only when the list is empty (the server then reuses the original
  // visit's address snapshot).
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    () => {
      const originalAddressId =
        locationModes.find((mode) => mode.type === 'MOBILE')?.clientAddressId ??
        null
      if (
        originalAddressId &&
        savedAddresses.some((address) => address.id === originalAddressId)
      ) {
        return originalAddressId
      }
      return (
        savedAddresses.find((address) => address.isDefault)?.id ??
        savedAddresses[0]?.id ??
        null
      )
    },
  )

  // The address availability + booking use for MOBILE: the picker selection,
  // falling back to the original visit's address id (may be null — the
  // availability API and write path then work from the original's snapshot).
  const activeClientAddressId =
    activeMode?.type === 'MOBILE'
      ? selectedAddressId ?? activeMode.clientAddressId
      : null

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
  // The client's explicit daypart tap, or null to follow the auto-default.
  const [selectedPeriod, setSelectedPeriod] = useState<DayPeriod | null>(null)
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
    if (!date || !activeMode) return
    const mode = activeMode
    let cancelled = false

    async function load() {
      setSlotsState({ kind: 'loading' })

      const params = new URLSearchParams({
        professionalId,
        serviceId,
        locationType: mode.type,
        locationId: mode.locationId,
        date,
      })
      if (activeClientAddressId) {
        params.set('clientAddressId', activeClientAddressId)
      }

      try {
        const res = await fetch(
          `/api/v1/availability/day?${params.toString()}`,
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
  }, [
    date,
    professionalId,
    serviceId,
    activeMode,
    activeClientAddressId,
    withinWindow,
  ])

  const slotsByPeriod = useMemo(
    () =>
      groupSlotsByPeriod(
        slotsState.kind === 'ready' ? slotsState.slots : [],
        timeZone,
      ),
    [slotsState, timeZone],
  )

  // Open to the daypart the client is most likely to want: keep their explicit
  // tap when it still has times, otherwise fall to the first daypart
  // (morning→evening) that does. Derived in render so a new day's slots
  // re-resolve the active tab without a setState-in-effect cascade.
  const period = firstNonEmptyPeriod(slotsByPeriod, selectedPeriod ?? 'AFTERNOON')

  async function handleBook(slotIso: string) {
    if (booking.kind === 'submitting' || !activeMode) return
    setBooking({ kind: 'submitting', slotIso })

    try {
      const idempotencyKey = buildIdempotencyKey(token, slotIso)
      const res = await fetch(
        `/api/v1/client/rebook/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'x-idempotency-key': idempotencyKey,
          },
          // clientAddressId is sent only for an explicit picker selection —
          // omitting it keeps the server's behavior of reusing the original
          // visit's address (FK or preserved snapshot).
          body: JSON.stringify({
            scheduledFor: slotIso,
            locationType: activeMode.type,
            ...(activeMode.type === 'MOBILE' && selectedAddressId
              ? { clientAddressId: selectedAddressId }
              : {}),
          }),
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

  if (!activeMode) return null

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
      {locationModes.length > 1 ? (
        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-black text-textSecondary">
            Where
          </div>
          <div className="inline-flex gap-1.5 rounded-full border border-white/10 bg-bgPrimary/35 p-1">
            {locationModes.map((mode) => {
              const active = mode.type === locationType
              return (
                <button
                  key={mode.type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (active) return
                    setBooking({ kind: 'idle' })
                    setLocationType(mode.type)
                  }}
                  className={[
                    'rounded-full px-4 py-1.5 text-[12px] font-black transition',
                    active
                      ? 'bg-accentPrimary text-bgPrimary'
                      : 'text-textSecondary hover:bg-white/10',
                  ].join(' ')}
                >
                  {mode.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {locationType === 'MOBILE' && savedAddresses.length > 0 ? (
        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-black text-textSecondary">
            Service address
          </div>
          <div className="grid gap-1.5">
            {savedAddresses.map((address) => {
              const active = address.id === selectedAddressId
              return (
                <button
                  key={address.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (active) return
                    setBooking({ kind: 'idle' })
                    setSelectedAddressId(address.id)
                  }}
                  className={[
                    'rounded-card border px-3 py-2 text-left transition',
                    active
                      ? 'border-accentPrimary/50 bg-accentPrimary/10'
                      : 'border-white/10 bg-bgPrimary/35 hover:bg-white/10',
                  ].join(' ')}
                >
                  <div className="text-[12px] font-black text-textPrimary">
                    {address.label ?? 'Saved address'}
                    {address.isDefault ? (
                      <span className="ml-1.5 font-semibold text-textSecondary/75">
                        · Default
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-textSecondary">
                    {address.formattedAddress}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {locationType === 'MOBILE' && savedAddresses.length === 0 ? (
        <div className="mb-4 text-[12px] text-textSecondary/75">
          We’ll come to the same address as your original visit.
        </div>
      ) : null}

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
          Times shown in {friendlyTimeZoneLabel(timeZone) ?? timeZone}
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
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {DAY_PERIOD_ORDER.map((nextPeriod) => {
                const active = period === nextPeriod
                const disabled = slotsByPeriod[nextPeriod].length === 0
                return (
                  <button
                    key={nextPeriod}
                    type="button"
                    aria-pressed={active}
                    disabled={disabled}
                    title={disabled ? 'No times in this period' : ''}
                    onClick={() => {
                      if (disabled || active) return
                      setSelectedPeriod(nextPeriod)
                    }}
                    className={[
                      'rounded-full border px-0 py-1.75 text-[10px] font-black uppercase tracking-widest transition font-mono',
                      active
                        ? 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary'
                        : 'border-white/10 bg-bgPrimary/35 text-textSecondary hover:bg-white/10',
                      disabled
                        ? 'cursor-not-allowed opacity-40 hover:bg-bgPrimary/35'
                        : 'cursor-pointer',
                    ].join(' ')}
                  >
                    {PERIOD_LABEL[nextPeriod]}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
              {slotsByPeriod[period].length > 0 ? (
                slotsByPeriod[period].map((iso) => {
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
                })
              ) : (
                <div className="text-sm text-textSecondary">
                  {PERIOD_EMPTY_COPY[period]}
                </div>
              )}
            </div>
          </>
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
