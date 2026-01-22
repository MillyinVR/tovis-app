// app/pro/calendar/WorkingHoursForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  start: string // "09:00" or "9:00"
  end: string // "17:00" or "5:00"
}

export type ApiWorkingHours = Record<WeekdayKey, ApiDayConfig> | null

type WorkingHoursFormProps = {
  initialHours?: ApiWorkingHours
  onSaved?: (hours: ApiWorkingHours) => void
  locationType?: LocationType
}

const DAYS: Array<{ key: WeekdayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

// ✅ Accepts both "9:00" and "09:00"
function parseTime24(time: string | null | undefined): { hour: number; minute: number; period: Period } {
  if (!time || typeof time !== 'string') return { hour: 9, minute: 0, period: 'AM' }

  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return { hour: 9, minute: 0, period: 'AM' }

  const rawH = Number(m[1])
  const rawM = Number(m[2])

  const hh24 = Number.isFinite(rawH) ? clamp(rawH, 0, 23) : 9
  const mm = Number.isFinite(rawM) ? clamp(rawM, 0, 59) : 0

  let period: Period = 'AM'
  let hh12 = hh24

  if (hh24 === 0) {
    hh12 = 12
    period = 'AM'
  } else if (hh24 === 12) {
    hh12 = 12
    period = 'PM'
  } else if (hh24 > 12) {
    hh12 = hh24 - 12
    period = 'PM'
  } else {
    hh12 = hh24
    period = 'AM'
  }

  return { hour: hh12, minute: mm, period }
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

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function errorFromResponse(res: Response, data: any) {
  if (typeof data?.error === 'string') return data.error
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function buildDefaultState(): WorkingHoursState {
  const next = {} as WorkingHoursState
  for (const { key } of DAYS) {
    next[key] = {
      enabled: true,
      startHour: 9,
      startMinute: 0,
      startPeriod: 'AM',
      endHour: 5,
      endMinute: 0,
      endPeriod: 'PM',
    }
  }
  return next
}

function hydrateFromApi(api: ApiWorkingHours): WorkingHoursState {
  const next = buildDefaultState()
  if (!api) return next

  for (const { key } of DAYS) {
    const cfg = api[key]
    if (!cfg) continue

    const startParsed = parseTime24(cfg.start)
    const endParsed = parseTime24(cfg.end)

    next[key] = {
      enabled: Boolean(cfg.enabled),
      startHour: startParsed.hour,
      startMinute: startParsed.minute,
      startPeriod: startParsed.period,
      endHour: endParsed.hour,
      endMinute: endParsed.minute,
      endPeriod: endParsed.period,
    }
  }

  return next
}

function toApiPayload(state: WorkingHoursState): ApiWorkingHours {
  const payload = {} as Record<WeekdayKey, ApiDayConfig>
  for (const { key } of DAYS) {
    const cfg = state[key]
    payload[key] = {
      enabled: Boolean(cfg.enabled),
      start: toTime24(cfg.startHour, cfg.startMinute, cfg.startPeriod),
      end: toTime24(cfg.endHour, cfg.endMinute, cfg.endPeriod),
    }
  }
  return payload
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
        'h-9 rounded-xl border border-white/10 bg-bgPrimary px-2 text-[12px] font-semibold text-textPrimary',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/40',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-white/20',
        className,
      ].join(' ')}
    >
      {children}
    </select>
  )
}

export default function WorkingHoursForm({
  initialHours,
  onSaved,
  locationType = 'SALON',
}: WorkingHoursFormProps) {
  const router = useRouter()

  const [state, setState] = useState<WorkingHoursState | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const minuteOptions = useMemo(() => [0, 15, 30, 45], [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        setMessage(null)

        // If parent passed hours (even null), trust them
        if (initialHours !== undefined) {
          const next = hydrateFromApi(initialHours)
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

        const data = await safeJson(res)
        if (!res.ok) {
          if (!cancelled) setError(errorFromResponse(res, data))
          return
        }

        const api: ApiWorkingHours = (data?.workingHours ?? null) as ApiWorkingHours
        const next = hydrateFromApi(api)
        if (!cancelled) setState(next)
      } catch (e) {
        console.error(e)
        if (!cancelled) setError('Network error loading hours.')
      }
    }

    load()
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

      const data = await safeJson(res)
      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setMessage('Schedule saved.')
      onSaved?.(payload)
      router.refresh()
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return <div className="text-[12px] text-textSecondary">Loading schedule…</div>
  }

  return (
    <form onSubmit={handleSubmit} className="text-textPrimary">
      <div className="grid gap-2">
        <div className="grid grid-cols-[120px_1fr_1fr] items-center gap-2 text-[12px]">
          <div />
          <div className="font-black text-textPrimary">Start</div>
          <div className="font-black text-textPrimary">End</div>

          {DAYS.map(({ key, label }) => {
            const cfg = state[key]
            const faded = !cfg.enabled

            return (
              <div key={key} className="contents">
                <label className="flex items-center gap-2 text-[12px] font-semibold">
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={(e) => updateDay(key, 'enabled', e.target.checked)}
                    className="h-4 w-4 accent-accentPrimary"
                  />
                  <span className="font-black">{label}</span>
                </label>

                <div className={['flex gap-2', faded ? 'opacity-50' : 'opacity-100'].join(' ')}>
                  <Select
                    value={cfg.startHour}
                    disabled={!cfg.enabled}
                    onChange={(v) => updateDay(key, 'startHour', clamp(parseInt(v, 10) || 9, 1, 12))}
                    className="w-[70px]"
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
                    className="w-[80px]"
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
                    className="w-[80px]"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </Select>
                </div>

                <div className={['flex gap-2', faded ? 'opacity-50' : 'opacity-100'].join(' ')}>
                  <Select
                    value={cfg.endHour}
                    disabled={!cfg.enabled}
                    onChange={(v) => updateDay(key, 'endHour', clamp(parseInt(v, 10) || 5, 1, 12))}
                    className="w-[70px]"
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
                    className="w-[80px]"
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
                    className="w-[80px]"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </Select>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className={[
              'inline-flex items-center rounded-full border border-white/10 px-4 py-2 text-[12px] font-black transition',
              'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
              saving ? 'cursor-not-allowed opacity-70' : '',
            ].join(' ')}
          >
            {saving ? 'Saving…' : 'Save base schedule'}
          </button>

          {message ? <div className="text-[11px] font-semibold text-toneSuccess">{message}</div> : null}
          {error ? <div className="text-[11px] font-semibold text-toneDanger">{error}</div> : null}
        </div>

        <div className="mt-2 text-[11px] text-textSecondary">
          This is your base schedule for <span className="font-semibold">{locationType.toLowerCase()}</span>. Availability also depends on buffers,
          bookings, holds, and blocks.
        </div>
      </div>
    </form>
  )
}
