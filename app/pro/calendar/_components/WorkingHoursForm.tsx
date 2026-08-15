// app/pro/calendar/_components/WorkingHoursForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import type {
  BrandWorkingHoursCopy,
  BrandWorkingHoursDayKey,
  BrandWorkingHoursStrandedCopy,
} from '@/lib/brand/types'

import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJson,
} from '@/lib/http'
import { parseHHMM } from '@/lib/scheduling/workingHours'
import { formatSlotFullLabel } from '@/lib/time'
import { isRecord } from '@/lib/guards'
import { clamp } from '@/lib/pick'
import { loginHrefFromHere } from '@/lib/clientNavigation'
import type { ProStrandedBookingDTO } from '@/lib/dto/proWorkingHours'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'AM' | 'PM'
type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type LocationType = 'SALON' | 'MOBILE'

type DayConfig = {
  enabled: boolean
  startHour: number
  startMinute: number
  startPeriod: Period
  endHour: number
  endMinute: number
  endPeriod: Period
}

type WorkingHoursState = Record<WeekdayKey, DayConfig>

type ApiDayConfig = {
  enabled: boolean
  start: string
  end: string
}

export type ApiWorkingHours = Record<WeekdayKey, ApiDayConfig>

type WorkingHoursFormProps = {
  copy: BrandWorkingHoursCopy
  initialHours?: ApiWorkingHours | null
  onSaved?: (hours: ApiWorkingHours) => void
  locationType?: LocationType
  locationId?: string | null
  /**
   * Open the calendar's booking modal for a booking this save stranded, so the
   * pro can move it without hunting for it. The calendar page owns that modal
   * (`openBookingOrBlock`); it also closes this overlay, since the two cannot
   * be usefully open at once. Omitted, the notice lists without a
   * reschedule action.
   */
  onRescheduleBooking?: (bookingId: string) => void
}

type DayDefinition = {
  key: WeekdayKey
  brandKey: BrandWorkingHoursDayKey
  label: string
  fullLabel: string
}

/**
 * B8 — what the save reports back about the bookings it just put outside the
 * pro's published hours. The save SUCCEEDS regardless (Tori, 2026-07-25):
 * nothing here refuses, cancels or moves anything.
 *
 * Parsed defensively because the field is three-valued on the wire: absent
 * (nothing changed), `null` (the server could not tell), or a report. Only the
 * last one renders — a warning we could not compute must not become a
 * reassuring "0".
 */
type StrandedBookingsState = {
  total: number
  items: ProStrandedBookingDTO[]
}

function parseStrandedBookings(data: unknown): StrandedBookingsState | null {
  if (!isRecord(data)) return null

  const raw = data.strandedBookings
  if (!isRecord(raw)) return null

  const total = typeof raw.total === 'number' ? raw.total : 0
  if (total <= 0) return null

  const items: ProStrandedBookingDTO[] = []

  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (!isRecord(item)) continue

      const id = typeof item.id === 'string' ? item.id : ''
      const scheduledFor =
        typeof item.scheduledFor === 'string' ? item.scheduledFor : ''
      if (!id || !scheduledFor) continue

      items.push({
        id,
        scheduledFor,
        durationMinutes:
          typeof item.durationMinutes === 'number' ? item.durationMinutes : 0,
        locationId: typeof item.locationId === 'string' ? item.locationId : '',
        timeZone: typeof item.timeZone === 'string' ? item.timeZone : 'UTC',
        clientName: typeof item.clientName === 'string' ? item.clientName : '',
        serviceName:
          typeof item.serviceName === 'string' ? item.serviceName : null,
      })
    }
  }

  return { total, items }
}

type DayDefinitionSeed = {
  key: WeekdayKey
  brandKey: BrandWorkingHoursDayKey
}

type SelectProps = {
  value: string | number
  disabled?: boolean
  ariaLabel: string
  onChange: (value: string) => void
  children: ReactNode
}

type DayRowProps = {
  copy: BrandWorkingHoursCopy
  day: DayDefinition
  config: DayConfig
  disabled: boolean
  onToggleEnabled: (enabled: boolean) => void
  onChangeStartHour: (value: string) => void
  onChangeStartMinute: (value: string) => void
  onChangeStartPeriod: (value: string) => void
  onChangeEndHour: (value: string) => void
  onChangeEndMinute: (value: string) => void
  onChangeEndPeriod: (value: string) => void
}

type TimeControlGroupProps = {
  label: string
  disabled: boolean
  hour: number
  minute: number
  period: Period
  onChangeHour: (value: string) => void
  onChangeMinute: (value: string) => void
  onChangePeriod: (value: string) => void
}

type StateCardProps = {
  children: ReactNode
  danger?: boolean
}

type InlineStateTone = 'success' | 'danger'

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_DEFINITION_SEEDS: ReadonlyArray<DayDefinitionSeed> = [
  { key: 'mon', brandKey: 'monday' },
  { key: 'tue', brandKey: 'tuesday' },
  { key: 'wed', brandKey: 'wednesday' },
  { key: 'thu', brandKey: 'thursday' },
  { key: 'fri', brandKey: 'friday' },
  { key: 'sat', brandKey: 'saturday' },
  { key: 'sun', brandKey: 'sunday' },
]

const DAY_KEYS: ReadonlyArray<WeekdayKey> = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]

const HOUR_OPTIONS: ReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
]

const MINUTE_OPTIONS: ReadonlyArray<number> = [0, 15, 30, 45]
const PERIOD_OPTIONS: ReadonlyArray<Period> = ['AM', 'PM']

// ─── Pure helpers ─────────────────────────────────────────────────────────────

async function safeJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const data: unknown = await safeJson(response)

  return isRecord(data) ? data : {}
}

function normalizeHHMM(value: unknown): string | null {
  const parsed = parseHHMM(value)

  if (!parsed) return null

  return `${String(parsed.hh).padStart(2, '0')}:${String(parsed.mm).padStart(
    2,
    '0',
  )}`
}

function looksLikeApiDay(value: unknown): value is ApiDayConfig {
  if (!isRecord(value)) return false

  return (
    typeof value.enabled === 'boolean' &&
    typeof value.start === 'string' &&
    typeof value.end === 'string'
  )
}

function looksLikeApiHours(value: unknown): value is ApiWorkingHours {
  if (!isRecord(value)) return false

  for (const day of DAY_KEYS) {
    if (!looksLikeApiDay(value[day])) return false
  }

  return true
}

function makeApiDay(enabled: boolean): ApiDayConfig {
  return {
    enabled,
    start: '09:00',
    end: '17:00',
  }
}

function defaultApiHours(): ApiWorkingHours {
  return {
    mon: makeApiDay(true),
    tue: makeApiDay(true),
    wed: makeApiDay(true),
    thu: makeApiDay(true),
    fri: makeApiDay(true),
    sat: makeApiDay(false),
    sun: makeApiDay(false),
  }
}

function sanitizeApiDay(
  day: ApiDayConfig,
  fallback: ApiDayConfig,
): ApiDayConfig {
  return {
    enabled: day.enabled,
    start: normalizeHHMM(day.start) ?? fallback.start,
    end: normalizeHHMM(day.end) ?? fallback.end,
  }
}

function sanitizeApiHours(hours: ApiWorkingHours): ApiWorkingHours {
  const fallback = defaultApiHours()

  return {
    mon: sanitizeApiDay(hours.mon, fallback.mon),
    tue: sanitizeApiDay(hours.tue, fallback.tue),
    wed: sanitizeApiDay(hours.wed, fallback.wed),
    thu: sanitizeApiDay(hours.thu, fallback.thu),
    fri: sanitizeApiDay(hours.fri, fallback.fri),
    sat: sanitizeApiDay(hours.sat, fallback.sat),
    sun: sanitizeApiDay(hours.sun, fallback.sun),
  }
}

function parseTime24(time: string | null | undefined): {
  hour: number
  minute: number
  period: Period
} {
  const parsed = parseHHMM(time)

  if (!parsed) {
    return {
      hour: 9,
      minute: 0,
      period: 'AM',
    }
  }

  if (parsed.hh === 0) {
    return {
      hour: 12,
      minute: parsed.mm,
      period: 'AM',
    }
  }

  if (parsed.hh === 12) {
    return {
      hour: 12,
      minute: parsed.mm,
      period: 'PM',
    }
  }

  if (parsed.hh > 12) {
    return {
      hour: parsed.hh - 12,
      minute: parsed.mm,
      period: 'PM',
    }
  }

  return {
    hour: parsed.hh,
    minute: parsed.mm,
    period: 'AM',
  }
}

function toTime24(hour: number, minute: number, period: Period): string {
  let hour24 = clamp(Math.floor(hour || 0), 1, 12)
  const safeMinute = clamp(Math.floor(minute || 0), 0, 59)

  if (period === 'AM') {
    if (hour24 === 12) hour24 = 0
  } else if (hour24 !== 12) {
    hour24 += 12
  }

  return `${String(hour24).padStart(2, '0')}:${String(safeMinute).padStart(
    2,
    '0',
  )}`
}

function minutesSinceMidnight(
  hour: number,
  minute: number,
  period: Period,
): number {
  const time24 = toTime24(hour, minute, period)
  const parsed = parseHHMM(time24)

  if (!parsed) return 0

  return parsed.hh * 60 + parsed.mm
}

function dayConfigFromApi(day: ApiDayConfig): DayConfig {
  const start = parseTime24(day.start)
  const end = parseTime24(day.end)

  return {
    enabled: day.enabled,
    startHour: start.hour,
    startMinute: start.minute,
    startPeriod: start.period,
    endHour: end.hour,
    endMinute: end.minute,
    endPeriod: end.period,
  }
}

function hydrateFromApi(
  raw: ApiWorkingHours | null | undefined,
): WorkingHoursState {
  const source = looksLikeApiHours(raw)
    ? sanitizeApiHours(raw)
    : defaultApiHours()

  return {
    mon: dayConfigFromApi(source.mon),
    tue: dayConfigFromApi(source.tue),
    wed: dayConfigFromApi(source.wed),
    thu: dayConfigFromApi(source.thu),
    fri: dayConfigFromApi(source.fri),
    sat: dayConfigFromApi(source.sat),
    sun: dayConfigFromApi(source.sun),
  }
}

function toApiDay(day: DayConfig): ApiDayConfig {
  return {
    enabled: day.enabled,
    start: toTime24(day.startHour, day.startMinute, day.startPeriod),
    end: toTime24(day.endHour, day.endMinute, day.endPeriod),
  }
}

function toApiPayload(state: WorkingHoursState): ApiWorkingHours {
  return {
    mon: toApiDay(state.mon),
    tue: toApiDay(state.tue),
    wed: toApiDay(state.wed),
    thu: toApiDay(state.thu),
    fri: toApiDay(state.fri),
    sat: toApiDay(state.sat),
    sun: toApiDay(state.sun),
  }
}

function validateState(args: {
  state: WorkingHoursState
  days: ReadonlyArray<DayDefinition>
  copy: BrandWorkingHoursCopy
}): string | null {
  const { state, days, copy } = args

  for (const day of days) {
    const config = state[day.key]

    if (!config.enabled) continue

    const start = minutesSinceMidnight(
      config.startHour,
      config.startMinute,
      config.startPeriod,
    )

    const end = minutesSinceMidnight(
      config.endHour,
      config.endMinute,
      config.endPeriod,
    )

    if (end <= start) {
      return `${day.fullLabel}: ${copy.status.validationEndAfterStart}`
    }
  }

  return null
}

function parseHourSelection(value: string, fallback: number): number {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? clamp(Math.trunc(parsed), 1, 12) : fallback
}

function parseMinuteSelection(value: string): number {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? clamp(Math.trunc(parsed), 0, 59) : 0
}

function parsePeriodSelection(value: string): Period {
  return value === 'PM' ? 'PM' : 'AM'
}

function redirectToLogin(
  router: ReturnType<typeof useRouter>,
  reason?: string,
): void {
  router.push(loginHrefFromHere('/pro/calendar', reason))
}

function workingHoursEndpoint(
  locationType: LocationType,
  locationId?: string | null,
): string {
  const params = new URLSearchParams({ locationType })

  if (locationId) params.set('locationId', locationId)

  return `/api/v1/pro/working-hours?${params.toString()}`
}

function errorFromResponse(args: {
  response: Response
  data: unknown
  fallback: string
}): string {
  const { response, data, fallback } = args
  const message = readErrorMessage(data)

  if (message) return message

  if (isRecord(data)) {
    const rawMessage = data.message

    if (typeof rawMessage === 'string' && rawMessage.trim()) {
      return rawMessage.trim()
    }
  }

  return `${fallback} (${response.status})`
}

function locationCopy(args: {
  locationType: LocationType
  copy: BrandWorkingHoursCopy
}) {
  const { locationType, copy } = args

  return locationType === 'MOBILE'
    ? copy.locations.mobile
    : copy.locations.salon
}

function dayDefinitionsForCopy(
  copy: BrandWorkingHoursCopy,
): ReadonlyArray<DayDefinition> {
  return DAY_DEFINITION_SEEDS.map((day) => ({
    key: day.key,
    brandKey: day.brandKey,
    label: copy.days[day.brandKey].shortLabel,
    fullLabel: copy.days[day.brandKey].fullLabel,
  }))
}

function enabledDayCount(state: WorkingHoursState | null): number {
  if (!state) return 0

  return DAY_KEYS.filter((day) => state[day].enabled).length
}

function formattedTime(config: DayConfig): string {
  const start = `${config.startHour}:${String(config.startMinute).padStart(
    2,
    '0',
  )} ${config.startPeriod}`

  const end = `${config.endHour}:${String(config.endMinute).padStart(
    2,
    '0',
  )} ${config.endPeriod}`

  return `${start} → ${end}`
}

// ─── Exported component ───────────────────────────────────────────────────────

export default function WorkingHoursForm(props: WorkingHoursFormProps) {
  const {
    copy,
    initialHours,
    onSaved,
    onRescheduleBooking,
    locationType = 'SALON',
    locationId = null,
  } = props

  const router = useRouter()

  const days = useMemo(() => dayDefinitionsForCopy(copy), [copy])
  const activeLocationCopy = locationCopy({ locationType, copy })

  const [state, setState] = useState<WorkingHoursState | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stranded, setStranded] = useState<StrandedBookingsState | null>(null)

  const daysOn = enabledDayCount(state)

  useEffect(() => {
    const controller = new AbortController()

    async function loadHours(): Promise<void> {
      setError(null)
      setMessage(null)

      if (initialHours !== undefined) {
        setState(hydrateFromApi(initialHours))
        return
      }

      try {
        const response = await fetch(
          workingHoursEndpoint(locationType, locationId),
          {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
          },
        )

        if (response.status === 401) {
          redirectToLogin(router, 'working-hours')
          return
        }

        const data = await safeJsonObject(response)

        if (controller.signal.aborted) return

        if (!response.ok) {
          setError(
            errorFromResponse({
              response,
              data,
              fallback: copy.status.failedLoadHours,
            }),
          )
          setState(hydrateFromApi(null))
          return
        }

        const workingHours = looksLikeApiHours(data.workingHours)
          ? data.workingHours
          : null

        setState(hydrateFromApi(workingHours))
      } catch (caught) {
        if (controller.signal.aborted) return

        setError(errorMessageFromUnknown(caught, copy.status.failedLoadHours))
        setState(hydrateFromApi(null))
      }
    }

    void loadHours()

    return () => controller.abort()
  }, [copy.status.failedLoadHours, initialHours, locationId, locationType, router])

  function updateDay<K extends keyof DayConfig>(
    dayKey: WeekdayKey,
    field: K,
    value: DayConfig[K],
  ): void {
    setState((previous) => {
      if (!previous) return previous

      return {
        ...previous,
        [dayKey]: {
          ...previous[dayKey],
          [field]: value,
        },
      }
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!state || saving) return

    setMessage(null)
    setError(null)
    setStranded(null)

    const validationError = validateState({
      state,
      days,
      copy,
    })

    if (validationError) {
      setError(validationError)
      return
    }

    const payload = toApiPayload(state)

    setSaving(true)

    try {
      const response = await fetch(
        workingHoursEndpoint(locationType, locationId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workingHours: payload }),
        },
      )

      if (response.status === 401) {
        redirectToLogin(router, 'working-hours')
        return
      }

      const data = await safeJsonObject(response)

      if (!response.ok) {
        setError(
          errorFromResponse({
            response,
            data,
            fallback: copy.status.failedSave,
          }),
        )
        return
      }

      setMessage(copy.actions.saved)
      setStranded(parseStrandedBookings(data))
      onSaved?.(payload)
      router.refresh()
    } catch (caught) {
      setError(errorMessageFromUnknown(caught, copy.status.failedSave))
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return <StateCard>{copy.status.loadingSchedule}</StateCard>
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="brand-pro-calendar-working-form"
      data-calendar-working-hours-form="true"
      data-location-type={locationType}
    >
      <section className="brand-pro-calendar-working-form-hint">
        <div>
          <p className="brand-pro-calendar-working-form-eyebrow">
            {activeLocationCopy.eyebrow}
          </p>

          <h3 className="brand-pro-calendar-working-form-title">
            {copy.baseScheduleLabel}
          </h3>

          <p className="brand-pro-calendar-working-form-description">
            {copy.baseScheduleDescription}
          </p>
        </div>

        <div className="brand-pro-calendar-working-form-count">
          <span>{daysOn}</span>
          <span>{copy.daysOnLabel}</span>
        </div>
      </section>

      <section className="brand-pro-calendar-working-form-table">
        <div className="brand-pro-calendar-working-form-table-header">
          <span>{copy.table.day}</span>
          <span>{copy.table.on}</span>
          <span>{copy.table.start}</span>
          <span>{copy.table.end}</span>
        </div>

        <div className="brand-pro-calendar-working-form-row-list">
          {days.map((day) => {
            const config = state[day.key]
            const disabled = !config.enabled

            return (
              <DayRow
                key={day.key}
                copy={copy}
                day={day}
                config={config}
                disabled={disabled}
                onToggleEnabled={(enabled) =>
                  updateDay(day.key, 'enabled', enabled)
                }
                onChangeStartHour={(value) =>
                  updateDay(
                    day.key,
                    'startHour',
                    parseHourSelection(value, 9),
                  )
                }
                onChangeStartMinute={(value) =>
                  updateDay(day.key, 'startMinute', parseMinuteSelection(value))
                }
                onChangeStartPeriod={(value) =>
                  updateDay(day.key, 'startPeriod', parsePeriodSelection(value))
                }
                onChangeEndHour={(value) =>
                  updateDay(day.key, 'endHour', parseHourSelection(value, 5))
                }
                onChangeEndMinute={(value) =>
                  updateDay(day.key, 'endMinute', parseMinuteSelection(value))
                }
                onChangeEndPeriod={(value) =>
                  updateDay(day.key, 'endPeriod', parsePeriodSelection(value))
                }
              />
            )
          })}
        </div>
      </section>

      <footer className="brand-pro-calendar-working-form-footer">
        <button
          type="submit"
          disabled={saving}
          className="brand-pro-calendar-working-form-save brand-focus"
        >
          {saving ? copy.actions.saving : copy.actions.saveSchedule}
        </button>

        {message ? <InlineState tone="success">{message}</InlineState> : null}
        {error ? <InlineState tone="danger">{error}</InlineState> : null}

        {stranded ? (
          <StrandedBookingsNotice
            copy={copy.stranded}
            stranded={stranded}
            onRescheduleBooking={onRescheduleBooking}
          />
        ) : null}
      </footer>
    </form>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DayRow(props: DayRowProps) {
  const {
    copy,
    day,
    config,
    disabled,
    onToggleEnabled,
    onChangeStartHour,
    onChangeStartMinute,
    onChangeStartPeriod,
    onChangeEndHour,
    onChangeEndMinute,
    onChangeEndPeriod,
  } = props

  return (
    <div
      className="brand-pro-calendar-working-day-row"
      data-enabled={config.enabled ? 'true' : 'false'}
    >
      <div className="brand-pro-calendar-working-day-main">
        <div className="brand-pro-calendar-working-day-copy">
          <span className="brand-pro-calendar-working-day-short">
            {day.label}
          </span>

          <span className="brand-pro-calendar-working-day-full">
            {day.fullLabel}
          </span>
        </div>

        <div className="brand-pro-calendar-working-day-summary">
          {config.enabled ? formattedTime(config) : copy.offLabel}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={config.enabled}
        onClick={() => onToggleEnabled(!config.enabled)}
        className="brand-pro-calendar-working-day-toggle brand-focus"
        data-enabled={config.enabled ? 'true' : 'false'}
      >
        <span className="brand-pro-calendar-working-day-toggle-thumb" />
      </button>

      <TimeControlGroup
        label={copy.table.start}
        disabled={disabled}
        hour={config.startHour}
        minute={config.startMinute}
        period={config.startPeriod}
        onChangeHour={onChangeStartHour}
        onChangeMinute={onChangeStartMinute}
        onChangePeriod={onChangeStartPeriod}
      />

      <TimeControlGroup
        label={copy.table.end}
        disabled={disabled}
        hour={config.endHour}
        minute={config.endMinute}
        period={config.endPeriod}
        onChangeHour={onChangeEndHour}
        onChangeMinute={onChangeEndMinute}
        onChangePeriod={onChangeEndPeriod}
      />
    </div>
  )
}

function TimeControlGroup(props: TimeControlGroupProps) {
  const {
    label,
    disabled,
    hour,
    minute,
    period,
    onChangeHour,
    onChangeMinute,
    onChangePeriod,
  } = props

  return (
    <div
      className="brand-pro-calendar-working-time-group"
      data-disabled={disabled ? 'true' : 'false'}
    >
      <span className="brand-pro-calendar-working-time-label">{label}</span>

      <div className="brand-pro-calendar-working-time-selects">
        <Select
          value={hour}
          disabled={disabled}
          ariaLabel={`${label} hour`}
          onChange={onChangeHour}
        >
          {HOUR_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>

        <Select
          value={minute}
          disabled={disabled}
          ariaLabel={`${label} minute`}
          onChange={onChangeMinute}
        >
          {MINUTE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {String(option).padStart(2, '0')}
            </option>
          ))}
        </Select>

        <Select
          value={period}
          disabled={disabled}
          ariaLabel={`${label} period`}
          onChange={onChangePeriod}
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}

function Select(props: SelectProps) {
  const {
    value,
    disabled = false,
    ariaLabel,
    onChange,
    children,
  } = props

  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      className="brand-pro-calendar-working-select brand-focus"
      data-disabled={disabled ? 'true' : 'false'}
    >
      {children}
    </select>
  )
}

function StateCard(props: StateCardProps) {
  const { children, danger = false } = props

  return (
    <div
      className="brand-pro-calendar-working-state"
      data-danger={danger ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

/**
 * The bookings this save just put outside the pro's published hours.
 *
 * Informational only — it appears BESIDE the "Saved" confirmation, never
 * instead of it. Each row is rendered in its own booking's location timezone,
 * which is the zone the pro will meet that client in.
 */
function StrandedBookingsNotice(props: {
  copy: BrandWorkingHoursStrandedCopy
  stranded: StrandedBookingsState
  onRescheduleBooking?: (bookingId: string) => void
}) {
  const { copy, stranded, onRescheduleBooking } = props
  const ref = useRef<HTMLElement | null>(null)

  // The editor is a scrolling overlay and this lands BELOW the save button, so
  // on a full week the whole warning sits under the fold — driven, not guessed:
  // the first build rendered correctly and was invisible to the pro who had
  // just clicked Save.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [stranded])

  const title =
    stranded.total === 1
      ? copy.titleOne
      : copy.title.replace('{count}', String(stranded.total))

  const hiddenCount = stranded.total - stranded.items.length

  return (
    <section
      ref={ref}
      className="brand-pro-calendar-working-stranded"
      data-working-hours-stranded="true"
      data-stranded-total={stranded.total}
    >
      <p className="brand-pro-calendar-working-stranded-title">{title}</p>

      <ul className="brand-pro-calendar-working-stranded-list">
        {stranded.items.map((booking) => (
          <li key={booking.id}>
            <span className="brand-pro-calendar-working-stranded-when">
              {formatSlotFullLabel(booking.scheduledFor, booking.timeZone)}
            </span>
            <span className="brand-pro-calendar-working-stranded-who">
              {booking.serviceName
                ? `${booking.clientName} · ${booking.serviceName}`
                : booking.clientName}
            </span>

            <span className="brand-pro-calendar-working-stranded-actions">
              {onRescheduleBooking ? (
                <button
                  type="button"
                  onClick={() => onRescheduleBooking(booking.id)}
                  className="brand-pro-calendar-working-stranded-action brand-focus"
                  data-stranded-action="reschedule"
                >
                  {copy.reschedule}
                </button>
              ) : null}

              {/* Anchored to the BOOKING, which the row already carries — the
                  same context iOS's `openBookingThread` resolves, so both
                  platforms land in one thread and no client id has to ride on
                  this wire. */}
              <Link
                href={`/messages/start?contextType=BOOKING&contextId=${encodeURIComponent(
                  booking.id,
                )}`}
                className="brand-pro-calendar-working-stranded-action brand-focus"
                data-stranded-action="message"
              >
                {copy.message}
              </Link>
            </span>
          </li>
        ))}
      </ul>

      {hiddenCount > 0 ? (
        <p className="brand-pro-calendar-working-stranded-more">
          {copy.more.replace('{count}', String(hiddenCount))}
        </p>
      ) : null}

      <p className="brand-pro-calendar-working-stranded-description">
        {copy.description}
      </p>
    </section>
  )
}

function InlineState(props: {
  children: ReactNode
  tone: InlineStateTone
}) {
  const { children, tone } = props

  return (
    <p
      className="brand-pro-calendar-working-inline-state"
      data-tone={tone}
    >
      {children}
    </p>
  )
}