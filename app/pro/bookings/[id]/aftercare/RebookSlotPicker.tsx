// app/pro/bookings/[id]/aftercare/RebookSlotPicker.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import {
  datetimeLocalToUtcIsoStrict,
  formatInTimeZone,
  WALL_TIME_ERROR_MESSAGE,
} from '@/lib/time'
import {
  OVERLAP_CONFLICT_FETCH_WINDOW_MS,
  OVERLAP_FALLBACK_NAME,
  OVERLAP_HOLD_NAME,
} from '@/lib/calendar/constants'
import {
  formatOverlapNames,
  normalizeCalendarOverlapEvents,
  overlappingClientNamesForRange,
} from '@/lib/calendar/overlap'
import { isoToYmdInTimeZone, stepYmd, type StepUnit } from '@/lib/booking/rebookDates'
import AvailabilityCalendar from '@/app/pro/_components/AvailabilityCalendar'
import StepButtons from './StepButtons'

export type SelectedRebookSlot = {
  offeringId: string
  locationId: string
  locationType: 'SALON' | 'MOBILE'
  /**
   * MOBILE: the client service address the availability (and therefore this
   * slot) was computed for. Emitted with the slot so the pair stays atomic —
   * changing the address invalidates the pick. Always null for SALON.
   */
  clientAddressId: string | null
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
  /**
   * Weekday indexes (0=Sun … 6=Sat) the pro's weekly schedule marks disabled.
   * Drives the calendar popup's off-day shading and the "outside your working
   * hours" guidance — an off day offers no open times, but the pro can still
   * book it with a custom time (the save asks them to confirm the override).
   */
  offWeekdays?: ReadonlySet<number> | null
  /**
   * The offering's suggested rebook day (service date + rebook interval), for
   * the calendar's "Suggested" jump chip. Null hides the chip.
   */
  suggestedYmd?: string | null
  /**
   * The booking this aftercare rebooks. The rebook commit CLONES that
   * booking's items (base + add-ons at snapshot durations), so the day's open
   * slots and the calendar's counts are sized from the clone width — without
   * it they'd be offering-base wide and advertise starts the save won't fit.
   * Omitted on non-aftercare surfaces (waitlist offer).
   */
  rebookOfBookingId?: string | null
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
    return formatInTimeZone(iso, timeZone, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function slotDateLabel(iso: string, timeZone: string): string {
  try {
    return formatInTimeZone(iso, timeZone, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

function weekdayIndexOfYmd(ymd: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay()
}

/**
 * Lets a pro pick the next-appointment time for the aftercare rebook — either
 * a real open slot from their public availability (default), or any custom
 * time on their own authority ("Custom time"): an off day, before opening,
 * after closing. The custom path mirrors the new-booking form: the server
 * still checks the pro's scheduling rules and the save asks them to confirm
 * an override rather than silently allowing it. Emits the full slot the
 * aftercare API needs for BOOKED_NEXT_APPOINTMENT — offering, location, and
 * concrete start/end.
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
  offWeekdays,
  suggestedYmd,
  rebookOfBookingId,
}: Props) {
  const initialDay = value?.startsAt
    ? isoToYmdInTimeZone(value.startsAt, timeZone)
    : ''

  const [day, setDay] = useState<string>(initialDay)
  const [slots, setSlots] = useState<string[]>([])
  const [durationMinutes, setDurationMinutes] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeMode, setTimeMode] = useState<'slots' | 'custom'>('slots')
  const [customTime, setCustomTime] = useState<string>('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [overlapNames, setOverlapNames] = useState<string[]>([])
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
        if (rebookOfBookingId) {
          params.set('rebookOfBookingId', rebookOfBookingId)
        }

        const res = await fetch(`/api/v1/availability/day?${params.toString()}`, {
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
    [
      professionalId,
      serviceId,
      offeringId,
      locationType,
      locationId,
      clientAddressId,
      rebookOfBookingId,
    ],
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

  const dayIsOff = useMemo(() => {
    if (!day || !offWeekdays || offWeekdays.size === 0) return false
    const weekday = weekdayIndexOfYmd(day)
    return weekday != null && offWeekdays.has(weekday)
  }, [day, offWeekdays])

  // The custom wall time resolved to a UTC instant, or null (nothing typed yet
  // / unresolvable — the skipped DST hour). Recomputed as the pro types so the
  // emitted slot and the overlap check below stay in lockstep.
  const customStartIso = useMemo<string | null>(() => {
    if (timeMode !== 'custom' || !day || !customTime) return null
    const resolved = datetimeLocalToUtcIsoStrict(`${day}T${customTime}`, timeZone)
    return resolved.ok ? resolved.iso : null
  }, [timeMode, day, customTime, timeZone])

  // Emit (or clear) the custom-mode slot. The availability fetch supplies the
  // real appointment width even on a day with zero open slots; 60 only backs
  // up a fetch that has not landed yet.
  useEffect(() => {
    if (timeMode !== 'custom' || !offeringId) return

    if (!day || !customTime) {
      setCustomError(null)
      return
    }

    const resolved = datetimeLocalToUtcIsoStrict(`${day}T${customTime}`, timeZone)
    if (!resolved.ok) {
      setCustomError(WALL_TIME_ERROR_MESSAGE[resolved.reason])
      if (value) onChange(null)
      return
    }

    setCustomError(null)
    const minutes = durationMinutes > 0 ? durationMinutes : 60
    const startsAt = resolved.iso
    const endsAt = addMinutesIso(startsAt, minutes)

    if (value?.startsAt === startsAt && value.endsAt === endsAt) return

    onChange({
      offeringId,
      locationId,
      locationType,
      clientAddressId: locationType === 'MOBILE' ? clientAddressId : null,
      startsAt,
      endsAt,
    })
    // `value` and `onChange` are deliberately omitted: the guard above already
    // stops re-emits of an unchanged slot, and including them would re-run the
    // effect on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    timeMode,
    day,
    customTime,
    durationMinutes,
    offeringId,
    locationId,
    locationType,
    clientAddressId,
    timeZone,
  ])

  // Passive double-book heads-up for a custom time (open slots can't collide).
  // Same feed + phrasing as the new-booking form, holds included (B5).
  useEffect(() => {
    if (timeMode !== 'custom' || !customStartIso || !locationId) {
      setOverlapNames([])
      return
    }

    const startMs = new Date(customStartIso).getTime()
    if (!Number.isFinite(startMs)) {
      setOverlapNames([])
      return
    }

    const minutes = durationMinutes > 0 ? durationMinutes : 60
    const endISO = new Date(startMs + minutes * 60_000).toISOString()
    const fromISO = new Date(
      startMs - OVERLAP_CONFLICT_FETCH_WINDOW_MS,
    ).toISOString()
    const toISO = new Date(
      startMs + OVERLAP_CONFLICT_FETCH_WINDOW_MS,
    ).toISOString()

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        // ALL locations, for the same reason the new-booking form asks that way:
        // the overlap being warned about is enforced on `professionalId` alone
        // (`Booking_no_active_professional_overlap` has no location term), so a
        // feed filtered to this booking's location silently hides the collision.
        const qs = new URLSearchParams({
          from: fromISO,
          to: toISO,
          scope: 'ALL',
        })

        const res = await fetch(`/api/v1/pro/calendar?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        // A background check never errors the form — on any non-OK response
        // (expired session, etc.) just clear the note.
        if (!res.ok) {
          setOverlapNames([])
          return
        }

        const data = await safeJson(res)
        setOverlapNames(
          overlappingClientNamesForRange(
            { startsAt: customStartIso, endsAt: endISO },
            normalizeCalendarOverlapEvents({
              data,
              holdName: OVERLAP_HOLD_NAME,
            }),
            OVERLAP_FALLBACK_NAME,
          ),
        )
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setOverlapNames([])
      }
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [timeMode, customStartIso, durationMinutes, locationId])

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
      clientAddressId: locationType === 'MOBILE' ? clientAddressId : null,
      startsAt: slotIso,
      endsAt: addMinutesIso(slotIso, minutes),
    })
  }

  function onSwitchMode(next: 'slots' | 'custom') {
    if (next === timeMode) return
    setTimeMode(next)
    setCustomError(null)
    setOverlapNames([])
    onChange(null)
  }

  function onStepDay(unit: StepUnit) {
    onDayChange(stepYmd(day, unit, minYmd))
  }

  const toggleBtn =
    'rounded-full border px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-60'
  const toggleActive = 'border-transparent bg-cta text-onCta'
  const toggleIdle =
    'border-textPrimary/16 text-textPrimary hover:border-textPrimary/30'

  return (
    <div className="mt-2">
      <label className="block text-xs font-black uppercase tracking-[0.08em] text-textSecondary">
        Pick a day
      </label>

      {/* The pro's own calendar IS the picker (R1): always visible, with
          booked/blocked/off-day shading and skip-ahead chips. The bare date
          input below is the typed-entry fallback. */}
      <div className="mt-1">
        <AvailabilityCalendar
          open
          variant="inline"
          tz={timeZone}
          minYmd={minYmd}
          anchorYmd={day || undefined}
          selectedYmd={day || null}
          suggestedYmd={suggestedYmd}
          offWeekdays={offWeekdays}
          disabled={disabled}
          onPick={(ymd) => onDayChange(ymd)}
          // The rebook CLONES the source booking (base + add-ons), so the
          // counts are sized from that booking's clone width when we know it —
          // offering-base otherwise (waitlist offer has no source booking).
          slotContext={
            serviceId
              ? {
                  serviceId,
                  locationType,
                  locationId,
                  rebookOfBookingId: rebookOfBookingId ?? null,
                }
              : null
          }
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-semibold text-textSecondary">
          or type a date
        </span>
        <input
          type="date"
          value={day}
          min={minYmd}
          disabled={disabled}
          onChange={(e) => onDayChange(e.target.value)}
          aria-label="Next appointment day"
          className="w-full rounded-card border border-textPrimary/15 bg-bgPrimary px-3 py-2 text-sm font-semibold text-textPrimary disabled:opacity-60"
        />
      </div>
      <StepButtons
        disabled={Boolean(disabled)}
        onStep={onStepDay}
        buttonClass={(btnDisabled) =>
          [
            'rounded-full border px-3 py-1.5 text-[12px] font-bold transition',
            btnDisabled
              ? 'cursor-not-allowed border-textPrimary/16 text-textSecondary opacity-60'
              : 'border-textPrimary/16 text-textPrimary hover:border-textPrimary/30',
          ].join(' ')
        }
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSwitchMode('slots')}
          aria-pressed={timeMode === 'slots'}
          className={`${toggleBtn} ${timeMode === 'slots' ? toggleActive : toggleIdle}`}
        >
          Open times
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSwitchMode('custom')}
          aria-pressed={timeMode === 'custom'}
          className={`${toggleBtn} ${timeMode === 'custom' ? toggleActive : toggleIdle}`}
        >
          Custom time
        </button>
      </div>

      {timeMode === 'slots' && day ? (
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
              {dayIsOff
                ? 'This day is outside your working hours — switch to Custom time to book it anyway.'
                : 'No open times that day. Try another date, or switch to Custom time.'}
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

      {timeMode === 'custom' ? (
        <div className="mt-3">
          <label className="block text-xs font-black uppercase tracking-[0.08em] text-textSecondary">
            Time
          </label>
          <input
            type="time"
            value={customTime}
            disabled={disabled || !day}
            onChange={(e) => setCustomTime(e.target.value)}
            className="mt-1 w-full rounded-card border border-textPrimary/15 bg-bgPrimary px-3 py-2 text-sm font-semibold text-textPrimary disabled:opacity-60"
          />
          {!day ? (
            <div className="mt-2 text-xs font-semibold text-textSecondary">
              Pick a day first.
            </div>
          ) : customError ? (
            <div className="mt-2 text-xs font-semibold text-toneDanger">
              {customError}
            </div>
          ) : (
            <div className="mt-2 text-xs font-semibold text-textSecondary">
              Any time, on your authority — it doesn’t need to be an open slot.
              {dayIsOff
                ? ' This day is outside your working hours, so saving will ask you to confirm.'
                : ''}
            </div>
          )}

          {overlapNames.length > 0 ? (
            <div
              role="status"
              className="mt-2 rounded-card border border-toneWarn/25 bg-toneWarn/10 p-3"
            >
              <div className="text-[12px] font-black uppercase tracking-wide text-toneWarn">
                Schedule conflict
              </div>
              <div className="mt-1 text-[12px] text-textSecondary">
                This overlaps {formatOverlapNames(overlapNames)}. You can still
                book it.
              </div>
            </div>
          ) : null}
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
