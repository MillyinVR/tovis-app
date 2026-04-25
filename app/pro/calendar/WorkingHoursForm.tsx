// app/pro/calendar/WorkingHoursForm.tsx
'use client'

import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import {
  safeJson,
  readErrorMessage,
  errorMessageFromUnknown,
} from '@/lib/http'
import { parseHHMM } from '@/lib/scheduling/workingHours'

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
  initialHours?: ApiWorkingHours | null
  onSaved?: (hours: ApiWorkingHours) => void
  locationType?: LocationType
}

type DayDefinition = {
  key: WeekdayKey
  label: string
  fullLabel: string
}

type SelectProps = {
  value: string | number
  disabled?: boolean
  onChange: (value: string) => void
  children: ReactNode
}

const DAYS: ReadonlyArray<DayDefinition> = [
  { key: 'mon', label: 'Mon', fullLabel: 'Monday' },
  { key: 'tue', label: 'Tue', fullLabel: 'Tuesday' },
  { key: 'wed', label: 'Wed', fullLabel: 'Wednesday' },
  { key: 'thu', label: 'Thu', fullLabel: 'Thursday' },
  { key: 'fri', label: 'Fri', fullLabel: 'Friday' },
  { key: 'sat', label: 'Sat', fullLabel: 'Saturday' },
  { key: 'sun', label: 'Sun', fullLabel: 'Sunday' },
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function safeJsonObject(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await safeJson(response)
  return isObject(data) ? data : {}
}

function normalizeHHMM(value: unknown) {
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

function sanitizeApiDay(day: ApiDayConfig, fallback: ApiDayConfig): ApiDayConfig {
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

function toTime24(hour: number, minute: number, period: Period) {
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

function minutesSinceMidnight(hour: number, minute: number, period: Period) {
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

function hydrateFromApi(raw: ApiWorkingHours | null | undefined): WorkingHoursState {
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

function validateState(state: WorkingHoursState) {
  for (const day of DAYS) {
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
      return `${day.fullLabel}: End time must be after start time.`
    }
  }

  return null
}

function parseHourSelection(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clamp(Math.trunc(parsed), 1, 12) : fallback
}

function parseMinuteSelection(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? clamp(Math.trunc(parsed), 0, 59) : 0
}

function parsePeriodSelection(value: string): Period {
  return value === 'PM' ? 'PM' : 'AM'
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/pro/calendar'

  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()

  if (!trimmed) return '/pro'
  if (!trimmed.startsWith('/')) return '/pro'
  if (trimmed.startsWith('//')) return '/pro'

  return trimmed
}

function redirectToLogin(
  router: ReturnType<typeof useRouter>,
  reason?: string,
) {
  const params = new URLSearchParams({
    from: sanitizeFrom(currentPathWithQuery()),
  })

  if (reason) params.set('reason', reason)

  router.push(`/login?${params.toString()}`)
}

function workingHoursEndpoint(locationType: LocationType) {
  const params = new URLSearchParams({ locationType })
  return `/api/pro/working-hours?${params.toString()}`
}

function errorFromResponse(response: Response, data: unknown) {
  const message = readErrorMessage(data)
  if (message) return message

  if (isObject(data)) {
    const rawMessage = data.message
    if (typeof rawMessage === 'string' && rawMessage.trim()) {
      return rawMessage.trim()
    }
  }

  if (response.status === 401) return 'Please log in to continue.'
  if (response.status === 403) return 'You do not have access to do that.'

  return `Request failed (${response.status}).`
}

function locationTypeLabel(locationType: LocationType) {
  return locationType === 'MOBILE' ? 'Mobile' : 'Salon'
}

function locationHintClassName(locationType: LocationType) {
  if (locationType === 'MOBILE') {
    return 'border-[var(--acid)]/25 bg-[var(--acid)]/10'
  }

  return 'border-[var(--terra)]/35 bg-[var(--terra)]/10'
}

function buttonClassName() {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-3',
    'border border-accentPrimary/30 bg-accentPrimary',
    'font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'text-bgPrimary transition hover:bg-accentPrimaryHover',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
}

function selectClassName(disabled: boolean) {
  return [
    'h-10 rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-2',
    'font-mono text-[11px] font-black uppercase tracking-[0.04em]',
    'text-[var(--paper)] shadow-sm',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    disabled
      ? 'cursor-not-allowed opacity-50'
      : 'hover:border-[var(--line-strong)] hover:bg-[var(--paper)]/[0.05]',
  ].join(' ')
}

export default function WorkingHoursForm(props: WorkingHoursFormProps) {
  const {
    initialHours,
    onSaved,
    locationType = 'SALON',
  } = props

  const router = useRouter()

  const [state, setState] = useState<WorkingHoursState | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadHours() {
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
          setError(errorFromResponse(response, data))
          setState(hydrateFromApi(null))
          return
        }

        const workingHours = looksLikeApiHours(data.workingHours)
          ? data.workingHours
          : null

        setState(hydrateFromApi(workingHours))
      } catch (caught) {
        if (controller.signal.aborted) return

        setError(errorMessageFromUnknown(caught, 'Network error loading hours.'))
        setState(hydrateFromApi(null))
      }
    }

    void loadHours()

    return () => controller.abort()
  }, [initialHours, locationType, router])

  function updateDay<K extends keyof DayConfig>(
    dayKey: WeekdayKey,
    field: K,
    value: DayConfig[K],
  ) {
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!state || saving) return

    setMessage(null)
    setError(null)

    const validationError = validateState(state)
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
        setError(errorFromResponse(response, data))
        return
      }

      setMessage('Schedule saved.')
      onSaved?.(payload)
      router.refresh()
    } catch (caught) {
      setError(errorMessageFromUnknown(caught, 'Failed to save.'))
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return <StateCard>Loading schedule…</StateCard>
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="text-[var(--paper)]"
      data-calendar-working-hours-form="1"
    >
      <div
        className={[
          'mb-4 rounded-2xl border px-3 py-3',
          'text-sm font-semibold text-[var(--paper-dim)]',
          locationHintClassName(locationType),
        ].join(' ')}
      >
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--paper-mute)]">
          Base schedule
        </p>

        <p className="mt-1">
          Editing availability for{' '}
          <span className="font-black text-[var(--paper)]">
            {locationTypeLabel(locationType)}
          </span>
          . Bookings and blocks still override these hours.
        </p>
      </div>

      <div className="grid gap-2">
        <div className="hidden grid-cols-[120px_1fr_1fr] items-center gap-3 px-1 font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)] md:grid">
          <div>Day</div>
          <div>Start</div>
          <div>End</div>
        </div>

        {DAYS.map((day) => {
          const config = state[day.key]
          const disabled = !config.enabled

          return (
            <DayRow
              key={day.key}
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

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <button
            type="submit"
            disabled={saving}
            className={buttonClassName()}
          >
            {saving ? 'Saving…' : 'Save schedule'}
          </button>

          {message ? <InlineState tone="success">{message}</InlineState> : null}
          {error ? <InlineState tone="danger">{error}</InlineState> : null}
        </div>
      </div>
    </form>
  )
}

function DayRow(props: {
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
}) {
  const {
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
      className={[
        'rounded-2xl border border-[var(--line)] bg-[var(--paper)]/[0.025] p-3',
        'grid gap-3 md:grid-cols-[120px_1fr_1fr] md:items-center',
        disabled ? 'opacity-65' : 'opacity-100',
      ].join(' ')}
    >
      <label className="flex items-center gap-2 font-mono text-[11px] font-black uppercase tracking-[0.08em] text-[var(--paper)]">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => onToggleEnabled(event.target.checked)}
          className="h-4 w-4 accent-accentPrimary"
        />

        <span>{day.label}</span>

        {disabled ? (
          <span className="text-[var(--paper-mute)]">Off</span>
        ) : null}
      </label>

      <TimeControlGroup
        label="Start"
        disabled={disabled}
        hour={config.startHour}
        minute={config.startMinute}
        period={config.startPeriod}
        onChangeHour={onChangeStartHour}
        onChangeMinute={onChangeStartMinute}
        onChangePeriod={onChangeStartPeriod}
      />

      <TimeControlGroup
        label="End"
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

function TimeControlGroup(props: {
  label: string
  disabled: boolean
  hour: number
  minute: number
  period: Period
  onChangeHour: (value: string) => void
  onChangeMinute: (value: string) => void
  onChangePeriod: (value: string) => void
}) {
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
    <div className="grid grid-cols-3 gap-2">
      <div className="col-span-3 font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)] md:hidden">
        {label}
      </div>

      <Select
        value={hour}
        disabled={disabled}
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
        onChange={onChangePeriod}
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </div>
  )
}

function Select(props: SelectProps) {
  const { value, disabled = false, onChange, children } = props

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={selectClassName(disabled)}
    >
      {children}
    </select>
  )
}

function StateCard(props: {
  children: ReactNode
  danger?: boolean
}) {
  const { children, danger = false } = props

  return (
    <div
      className={[
        'rounded-2xl border px-3 py-3 text-sm font-semibold',
        danger
          ? 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger'
          : 'border-[var(--line)] bg-[var(--paper)]/[0.03] text-[var(--paper-dim)]',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

function InlineState(props: {
  children: ReactNode
  tone: 'success' | 'danger'
}) {
  const { children, tone } = props

  return (
    <p
      className={[
        'font-mono text-[10px] font-black uppercase tracking-[0.10em]',
        tone === 'success' ? 'text-toneSuccess' : 'text-toneDanger',
      ].join(' ')}
    >
      {children}
    </p>
  )
}