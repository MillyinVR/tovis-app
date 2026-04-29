// app/pro/calendar/_components/WorkingHoursForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import type {
  BrandWorkingHoursCopy,
  BrandWorkingHoursDayKey,
} from '@/lib/brand/types'

import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJson,
} from '@/lib/http'
import { parseHHMM } from '@/lib/scheduling/workingHours'

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
}

type DayDefinition = {
  key: WeekdayKey
  brandKey: BrandWorkingHoursDayKey
  label: string
  fullLabel: string
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function safeJsonObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const data: unknown = await safeJson(response)

  return isObject(data) ? data : {}
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
  if (!isObject(value)) return false

  return (
    typeof value.enabled === 'boolean' &&
    typeof value.start === 'string' &&
    typeof value.end === 'string'
  )
}

function looksLikeApiHours(value: unknown): value is ApiWorkingHours {
  if (!isObject(value)) return false

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

function currentPathWithQuery(): string {
  if (typeof window === 'undefined') return '/pro/calendar'

  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string): string {
  const trimmed = from.trim()

  if (!trimmed) return '/pro'
  if (!trimmed.startsWith('/')) return '/pro'
  if (trimmed.startsWith('//')) return '/pro'

  return trimmed
}

function redirectToLogin(
  router: ReturnType<typeof useRouter>,
  reason?: string,
): void {
  const params = new URLSearchParams({
    from: sanitizeFrom(currentPathWithQuery()),
  })

  if (reason) params.set('reason', reason)

  router.push(`/login?${params.toString()}`)
}

function workingHoursEndpoint(locationType: LocationType): string {
  const params = new URLSearchParams({ locationType })

  return `/api/pro/working-hours?${params.toString()}`
}

function errorFromResponse(args: {
  response: Response
  data: unknown
  fallback: string
}): string {
  const { response, data, fallback } = args
  const message = readErrorMessage(data)

  if (message) return message

  if (isObject(data)) {
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
    locationType = 'SALON',
  } = props

  const router = useRouter()

  const days = useMemo(() => dayDefinitionsForCopy(copy), [copy])
  const activeLocationCopy = locationCopy({ locationType, copy })

  const [state, setState] = useState<WorkingHoursState | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        const response = await fetch(workingHoursEndpoint(locationType), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })

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
  }, [copy.status.failedLoadHours, initialHours, locationType, router])

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
      const response = await fetch(workingHoursEndpoint(locationType), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingHours: payload }),
      })

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