// app/pro/calendar/WorkingHoursForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeJson, readErrorMessage } from '@/lib/http'

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
  start: string // "HH:MM"
  end: string // "HH:MM"
}

// ✅ keep API type strict (object), but allow prop to be null/undefined
export type ApiWorkingHours = Record<WeekdayKey, ApiDayConfig>

type WorkingHoursFormProps = {
  initialHours?: ApiWorkingHours | null
  onSaved?: (hours: ApiWorkingHours) => void
  locationType?: LocationType
}

type JsonObject = Record<string, unknown>

const DAYS: Array<{ key: WeekdayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

const DAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

async function safeJsonObject(res: Response): Promise<JsonObject> {
  const data = await safeJson(res)
  return isObject(data) ? (data as JsonObject) : {}
}

/** Accept "9:00" or "09:00" and normalize to HH:MM, else null */
function normalizeHHMM(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function looksLikeApiHours(v: unknown): v is ApiWorkingHours {
  if (!isObject(v)) return false
  for (const d of DAY_KEYS) {
    const row = (v as Record<string, unknown>)[d]
    if (!isObject(row)) return false
    if (typeof row.enabled !== 'boolean') return false
    if (typeof row.start !== 'string') return false
    if (typeof row.end !== 'string') return false
  }
  return true
}

/**
 * ✅ Real default:
 * - Mon–Fri enabled 9–5
 * - Sat/Sun off
 */
function defaultApiHours(): ApiWorkingHours {
  const weekday: ApiDayConfig = { enabled: true, start: '09:00', end: '17:00' }
  const weekend: ApiDayConfig = { enabled: false, start: '09:00', end: '17:00' }

  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...weekend },
    sun: { ...weekend },
  }
}

function parseTime24(time: string | null | undefined): { hour: number; minute: number; period: Period } {
  const t = normalizeHHMM(time)
  if (!t) return { hour: 9, minute: 0, period: 'AM' }

  const [hStr, mStr] = t.split(':')
  const hh24 = clamp(Number(hStr), 0, 23)
  const mm = clamp(Number(mStr), 0, 59)

  if (hh24 === 0) return { hour: 12, minute: mm, period: 'AM' }
  if (hh24 === 12) return { hour: 12, minute: mm, period: 'PM' }
  if (hh24 > 12) return { hour: hh24 - 12, minute: mm, period: 'PM' }
  return { hour: hh24, minute: mm, period: 'AM' }
}

function toTime24(hour: number, minute: number, period: Period): string {
  let h = clamp(Math.floor(hour || 0), 1, 12)
  const m = clamp(Math.floor(minute || 0), 0, 59)

  if (period === 'AM') {
    if (h === 12) h = 0
  } else {
    if (h !== 12) h = h + 12
  }

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function minutesSinceMidnight(hour: number, minute: number, period: Period) {
  let h = clamp(Math.floor(hour || 0), 1, 12)
  const m = clamp(Math.floor(minute || 0), 0, 59)

  if (period === 'AM') {
    if (h === 12) h = 0
  } else {
    if (h !== 12) h = h + 12
  }

  return h * 60 + m
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

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

function errorFromResponse(res: Response, data: unknown) {
  const msg = readErrorMessage(data)
  if (msg) return msg

  if (isObject(data)) {
    const m = data.message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }

  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function buildDefaultState(): WorkingHoursState {
  return hydrateFromApi(defaultApiHours())
}

function hydrateFromApi(raw: ApiWorkingHours | null | undefined): WorkingHoursState {
  const base = defaultApiHours()

  const src: ApiWorkingHours = looksLikeApiHours(raw)
    ? {
        mon: {
          enabled: raw.mon.enabled,
          start: normalizeHHMM(raw.mon.start) ?? base.mon.start,
          end: normalizeHHMM(raw.mon.end) ?? base.mon.end,
        },
        tue: {
          enabled: raw.tue.enabled,
          start: normalizeHHMM(raw.tue.start) ?? base.tue.start,
          end: normalizeHHMM(raw.tue.end) ?? base.tue.end,
        },
        wed: {
          enabled: raw.wed.enabled,
          start: normalizeHHMM(raw.wed.start) ?? base.wed.start,
          end: normalizeHHMM(raw.wed.end) ?? base.wed.end,
        },
        thu: {
          enabled: raw.thu.enabled,
          start: normalizeHHMM(raw.thu.start) ?? base.thu.start,
          end: normalizeHHMM(raw.thu.end) ?? base.thu.end,
        },
        fri: {
          enabled: raw.fri.enabled,
          start: normalizeHHMM(raw.fri.start) ?? base.fri.start,
          end: normalizeHHMM(raw.fri.end) ?? base.fri.end,
        },
        sat: {
          enabled: raw.sat.enabled,
          start: normalizeHHMM(raw.sat.start) ?? base.sat.start,
          end: normalizeHHMM(raw.sat.end) ?? base.sat.end,
        },
        sun: {
          enabled: raw.sun.enabled,
          start: normalizeHHMM(raw.sun.start) ?? base.sun.start,
          end: normalizeHHMM(raw.sun.end) ?? base.sun.end,
        },
      }
    : base

  const dayState = (cfg: ApiDayConfig): DayConfig => {
    const startParsed = parseTime24(cfg.start)
    const endParsed = parseTime24(cfg.end)
    return {
      enabled: Boolean(cfg.enabled),
      startHour: startParsed.hour,
      startMinute: startParsed.minute,
      startPeriod: startParsed.period,
      endHour: endParsed.hour,
      endMinute: endParsed.minute,
      endPeriod: endParsed.period,
    }
  }

  return {
    mon: dayState(src.mon),
    tue: dayState(src.tue),
    wed: dayState(src.wed),
    thu: dayState(src.thu),
    fri: dayState(src.fri),
    sat: dayState(src.sat),
    sun: dayState(src.sun),
  }
}

function toApiPayload(state: WorkingHoursState): ApiWorkingHours {
  const day = (cfg: DayConfig): ApiDayConfig => ({
    enabled: Boolean(cfg.enabled),
    start: toTime24(cfg.startHour, cfg.startMinute, cfg.startPeriod),
    end: toTime24(cfg.endHour, cfg.endMinute, cfg.endPeriod),
  })

  return {
    mon: day(state.mon),
    tue: day(state.tue),
    wed: day(state.wed),
    thu: day(state.thu),
    fri: day(state.fri),
    sat: day(state.sat),
    sun: day(state.sun),
  }
}

function validateState(state: WorkingHoursState): string | null {
  for (const { key, label } of DAYS) {
    const cfg = state[key]
    if (!cfg.enabled) continue

    const start = minutesSinceMidnight(cfg.startHour, cfg.startMinute, cfg.startPeriod)
    const end = minutesSinceMidnight(cfg.endHour, cfg.endMinute, cfg.endPeriod)

    if (end <= start) return `${label}: End time must be after start time.`
  }
  return null
}

function Select({
  value,
  disabled,
  onChange,
  children,
  className = '',
}: {
  value: string | number
  disabled?: boolean
  onChange: (v: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={[
        'h-10 rounded-xl border border-white/10 bg-bgSecondary/40 px-2 text-[12px] font-extrabold text-textPrimary',
        'shadow-sm backdrop-blur-md ring-1 ring-white/6',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/40',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-white/20 hover:bg-bgSecondary/55',
        className,
      ].join(' ')}
    >
      {children}
    </select>
  )
}

export default function WorkingHoursForm({ initialHours, onSaved, locationType = 'SALON' }: WorkingHoursFormProps) {
  const router = useRouter()

  const [state, setState] = useState<WorkingHoursState | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const minuteOptions = useMemo(() => [0, 15, 30, 45], [])

  // ✅ token-only tint (no emerald/brand)
  const locationHint =
    locationType === 'MOBILE'
      ? 'border-toneInfo/25 bg-toneInfo/10'
      : 'border-accentPrimary/25 bg-accentPrimary/10'

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        setMessage(null)

        // If parent gives us initialHours (even null), hydrate from it.
        if (initialHours !== undefined) {
          const next = hydrateFromApi(initialHours ?? null)
          if (!cancelled) setState(next)
          return
        }

        const res = await fetch(`/api/pro/working-hours?locationType=${encodeURIComponent(locationType)}`, {
          method: 'GET',
          cache: 'no-store',
        })

        if (res.status === 401) {
          redirectToLogin(router, 'working-hours')
          return
        }

        const data = await safeJsonObject(res)

        if (!res.ok) {
          if (!cancelled) {
            setError(errorFromResponse(res, data))
            setState(buildDefaultState())
          }
          return
        }

        const apiRaw = data.workingHours
        const api = looksLikeApiHours(apiRaw) ? apiRaw : null
        const next = hydrateFromApi(api)

        if (!cancelled) setState(next)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e)
        if (!cancelled) {
          setError('Network error loading hours.')
          setState(buildDefaultState())
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [initialHours, router, locationType])

  function updateDay<K extends keyof DayConfig>(dayKey: WeekdayKey, field: K, value: DayConfig[K]) {
    setState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [dayKey]: {
          ...prev[dayKey],
          [field]: value,
        },
      }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!state || saving) return

    setMessage(null)
    setError(null)

    const validationError = validateState(state)
    if (validationError) {
      setError(validationError)
      return
    }

    const payload = toApiPayload(state)

    try {
      setSaving(true)

      const res = await fetch(`/api/pro/working-hours?locationType=${encodeURIComponent(locationType)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingHours: payload }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'working-hours')
        return
      }

      const data = await safeJsonObject(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setMessage('Schedule saved.')
      onSaved?.(payload)

      // Refresh so calendar overlay + any server components update
      router.refresh()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      setError(err instanceof Error && err.message.trim() ? err.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return <div className="text-[12px] text-textSecondary">Loading schedule…</div>
  }

  return (
    <form onSubmit={handleSubmit} className="text-textPrimary">
      {/* context strip */}
      <div
        className={[
          'mb-3 rounded-2xl border px-3 py-2 text-[12px] font-semibold text-textSecondary',
          locationHint,
        ].join(' ')}
      >
        Editing base schedule for{' '}
        <span className="font-extrabold text-textPrimary">{locationType === 'SALON' ? 'Salon' : 'Mobile'}</span>
      </div>

      <div className="grid gap-2">
        {/* header labels desktop */}
        <div className="hidden grid-cols-[120px_1fr_1fr] items-center gap-2 text-[12px] md:grid">
          <div />
          <div className="font-extrabold text-textPrimary">Start</div>
          <div className="font-extrabold text-textPrimary">End</div>
        </div>

        {DAYS.map(({ key, label }) => {
          const cfg = state[key]
          const faded = !cfg.enabled

          return (
            <div
              key={key}
              className={[
                'tovis-glass-soft tovis-noise rounded-2xl border border-white/10 p-3',
                'grid gap-2 md:grid-cols-[120px_1fr_1fr] md:items-center md:gap-3',
                faded ? 'opacity-70' : 'opacity-100',
              ].join(' ')}
            >
              <label className="flex items-center gap-2 text-[12px] font-extrabold">
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  onChange={(e) => updateDay(key, 'enabled', e.target.checked)}
                  className="h-4 w-4 accent-accentPrimary"
                />
                <span className="text-textPrimary">{label}</span>
                {!cfg.enabled ? <span className="text-textSecondary font-semibold">(off)</span> : null}
              </label>

              {/* Start */}
              <div className="grid grid-cols-3 gap-2">
                <div className="md:hidden col-span-3 text-[11px] font-semibold text-textSecondary">Start</div>

                <Select
                  value={cfg.startHour}
                  disabled={!cfg.enabled}
                  onChange={(v) => updateDay(key, 'startHour', clamp(parseInt(v, 10) || 9, 1, 12))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>

                <Select
                  value={cfg.startMinute}
                  disabled={!cfg.enabled}
                  onChange={(v) => updateDay(key, 'startMinute', clamp(parseInt(v, 10) || 0, 0, 59))}
                >
                  {minuteOptions.map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}
                    </option>
                  ))}
                </Select>

                <Select
                  value={cfg.startPeriod}
                  disabled={!cfg.enabled}
                  onChange={(v) => updateDay(key, 'startPeriod', (v === 'PM' ? 'PM' : 'AM') as Period)}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </Select>
              </div>

              {/* End */}
              <div className="grid grid-cols-3 gap-2">
                <div className="md:hidden col-span-3 text-[11px] font-semibold text-textSecondary">End</div>

                <Select
                  value={cfg.endHour}
                  disabled={!cfg.enabled}
                  onChange={(v) => updateDay(key, 'endHour', clamp(parseInt(v, 10) || 5, 1, 12))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>

                <Select
                  value={cfg.endMinute}
                  disabled={!cfg.enabled}
                  onChange={(v) => updateDay(key, 'endMinute', clamp(parseInt(v, 10) || 0, 0, 59))}
                >
                  {minuteOptions.map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}
                    </option>
                  ))}
                </Select>

                <Select
                  value={cfg.endPeriod}
                  disabled={!cfg.enabled}
                  onChange={(v) => updateDay(key, 'endPeriod', (v === 'PM' ? 'PM' : 'AM') as Period)}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </Select>
              </div>
            </div>
          )
        })}

        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <button
            type="submit"
            disabled={saving}
            className={[
              'inline-flex items-center justify-center rounded-full border border-white/10 px-4 py-3 text-[12px] font-extrabold transition',
              'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
              'shadow-sm',
              saving ? 'cursor-not-allowed opacity-70' : 'hover:scale-[1.01] active:scale-[0.99]',
            ].join(' ')}
          >
            {saving ? 'Saving…' : 'Save schedule'}
          </button>

          {message ? <div className="text-[12px] font-extrabold text-toneSuccess">{message}</div> : null}
          {error ? <div className="text-[12px] font-extrabold text-toneDanger">{error}</div> : null}
        </div>

        <div className="mt-2 text-[11px] text-textSecondary">
          This sets your base availability for <span className="font-semibold">{locationType.toLowerCase()}</span>.
          Bookings and blocks will still override it.
        </div>
      </div>
    </form>
  )
}