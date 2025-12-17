'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Period = 'AM' | 'PM'

type DayConfig = {
  enabled: boolean
  startHour: number
  startMinute: number
  startPeriod: Period
  endHour: number
  endMinute: number
  endPeriod: Period
}

type WorkingHoursState = {
  [key: string]: DayConfig
}

type ApiDayConfig = {
  enabled: boolean
  start: string // "09:00"
  end: string // "17:00"
}

// keep this shape the same as what you store in DB / API
export type ApiWorkingHours =
  | {
      [key: string]: ApiDayConfig
    }
  | null

type WorkingHoursFormProps = {
  initialHours?: ApiWorkingHours
  onSaved?: (hours: ApiWorkingHours) => void
}

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

// 24h -> 12h
function parseTime24(time: string): { hour: number; minute: number; period: Period } {
  if (!time || typeof time !== 'string') return { hour: 9, minute: 0, period: 'AM' }

  const [hStr, mStr] = time.split(':')
  let h = parseInt(hStr || '9', 10)
  const m = parseInt(mStr || '0', 10) || 0

  let period: Period = 'AM'
  if (h === 0) {
    h = 12
    period = 'AM'
  } else if (h === 12) {
    period = 'PM'
  } else if (h > 12) {
    h = h - 12
    period = 'PM'
  } else {
    period = 'AM'
  }

  return { hour: h, minute: m, period }
}

// 12h -> 24h "HH:MM"
function toTime24(hour: number, minute: number, period: Period): string {
  let h = hour
  if (period === 'AM') {
    if (h === 12) h = 0
  } else {
    if (h !== 12) h = h + 12
  }
  const hh = String(h).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return `${hh}:${mm}`
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

function defaultDay(key: string): DayConfig {
  // Default: Mon–Sat enabled 9–5, Sun disabled
  return {
    enabled: key !== 'sun',
    startHour: 9,
    startMinute: 0,
    startPeriod: 'AM',
    endHour: 5,
    endMinute: 0,
    endPeriod: 'PM',
  }
}

export default function WorkingHoursForm({ initialHours, onSaved }: WorkingHoursFormProps) {
  const router = useRouter()

  const [state, setState] = useState<WorkingHoursState | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    let cancelled = false

    function hydrateFromApi(api: ApiWorkingHours) {
      const next: WorkingHoursState = {}

      DAYS.forEach(({ key }) => {
        const cfg: ApiDayConfig | undefined = api ? (api as any)[key] : undefined
        if (cfg) {
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
        } else {
          next[key] = defaultDay(key)
        }
      })

      if (!cancelled) setState(next)
    }

    // If parent passed hours, use those & skip fetch
    if (initialHours) {
      hydrateFromApi(initialHours)
      return () => {
        cancelled = true
      }
    }

    async function load() {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        setError(null)
        const res = await fetch('/api/pro/working-hours', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
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

        const api: ApiWorkingHours = data?.workingHours || null
        hydrateFromApi(api)
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        console.error(e)
        if (!cancelled) setError('Network error loading hours.')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [initialHours, router])

  function updateDay<K extends keyof DayConfig>(dayKey: string, field: K, value: DayConfig[K]) {
    setMessage(null)
    setError(null)

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

    setSaving(true)
    setMessage(null)
    setError(null)

    // Convert back to API shape.
    // NOTE: We intentionally allow "overnight" ranges (end <= start).
    // That means "23:00 → 02:00" is valid and means crossing midnight.
    const payload: ApiWorkingHours = {}
    for (const { key } of DAYS) {
      const cfg = state[key]

      payload[key] = {
        enabled: cfg.enabled,
        start: toTime24(cfg.startHour, cfg.startMinute, cfg.startPeriod),
        end: toTime24(cfg.endHour, cfg.endMinute, cfg.endPeriod),
      }
    }

    try {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const res = await fetch('/api/pro/working-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingHours: payload }),
        signal: controller.signal,
      })

      if (res.status === 401) {
        redirectToLogin(router, 'save-working-hours')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setMessage('Schedule saved.')
      router.refresh()

      if (onSaved) onSaved(payload)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error saving hours.')
    } finally {
      setSaving(false)
    }
  }

  if (!state) {
    return <div style={{ fontSize: 12, color: '#ccc' }}>Loading schedule…</div>
  }

  const minuteOptions = [0, 15, 30, 45]

  return (
    <form onSubmit={handleSubmit} style={{ fontSize: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr 1fr',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <div />
        <div style={{ fontWeight: 600 }}>Start</div>
        <div style={{ fontWeight: 600 }}>End</div>

        {DAYS.map(({ key, label }) => {
          const cfg = state[key]

          return (
            <div key={key} style={{ display: 'contents' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  disabled={saving}
                  onChange={(e) => updateDay(key, 'enabled', e.target.checked)}
                />
                <span>{label}</span>
              </label>

              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  value={cfg.startHour}
                  disabled={saving || !cfg.enabled}
                  onChange={(e) =>
                    updateDay(key, 'startHour', parseInt(e.target.value, 10) || 9)
                  }
                  style={{
                    flex: '0 0 50px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#111',
                    color: '#fff',
                    padding: '2px 4px',
                    opacity: cfg.enabled ? 1 : 0.5,
                  }}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>

                <select
                  value={cfg.startMinute}
                  disabled={saving || !cfg.enabled}
                  onChange={(e) =>
                    updateDay(key, 'startMinute', parseInt(e.target.value, 10) || 0)
                  }
                  style={{
                    flex: '0 0 60px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#111',
                    color: '#fff',
                    padding: '2px 4px',
                    opacity: cfg.enabled ? 1 : 0.5,
                  }}
                >
                  {minuteOptions.map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}
                    </option>
                  ))}
                </select>

                <select
                  value={cfg.startPeriod}
                  disabled={saving || !cfg.enabled}
                  onChange={(e) => updateDay(key, 'startPeriod', e.target.value as Period)}
                  style={{
                    flex: '0 0 60px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#111',
                    color: '#fff',
                    padding: '2px 4px',
                    opacity: cfg.enabled ? 1 : 0.5,
                  }}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  value={cfg.endHour}
                  disabled={saving || !cfg.enabled}
                  onChange={(e) => updateDay(key, 'endHour', parseInt(e.target.value, 10) || 5)}
                  style={{
                    flex: '0 0 50px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#111',
                    color: '#fff',
                    padding: '2px 4px',
                    opacity: cfg.enabled ? 1 : 0.5,
                  }}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>

                <select
                  value={cfg.endMinute}
                  disabled={saving || !cfg.enabled}
                  onChange={(e) =>
                    updateDay(key, 'endMinute', parseInt(e.target.value, 10) || 0)
                  }
                  style={{
                    flex: '0 0 60px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#111',
                    color: '#fff',
                    padding: '2px 4px',
                    opacity: cfg.enabled ? 1 : 0.5,
                  }}
                >
                  {minuteOptions.map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}
                    </option>
                  ))}
                </select>

                <select
                  value={cfg.endPeriod}
                  disabled={saving || !cfg.enabled}
                  onChange={(e) => updateDay(key, 'endPeriod', e.target.value as Period)}
                  style={{
                    flex: '0 0 60px',
                    borderRadius: 6,
                    border: '1px solid #444',
                    background: '#111',
                    color: '#fff',
                    padding: '2px 4px',
                    opacity: cfg.enabled ? 1 : 0.5,
                  }}
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid #fff',
            background: '#fff',
            color: '#111',
            fontSize: 12,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.85 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save base schedule'}
        </button>

        {message && <div style={{ fontSize: 11, color: '#a3e635' }}>{message}</div>}
        {error && <div style={{ fontSize: 11, color: '#fca5a5' }}>{error}</div>}

        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>
          Overnight ranges are allowed (ex: 9 PM → 2 AM).
        </div>
      </div>
    </form>
  )
}
