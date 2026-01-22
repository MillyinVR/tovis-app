// app/pro/bookings/new/NewBookingForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { moneyToString } from '@/lib/money'
import { isValidIanaTimeZone, sanitizeTimeZone, zonedTimeToUtc } from '@/lib/timeZone'

type Client = {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  user: { email: string } | null
}

type Offering = {
  id: string
  title: string | null
  price: number
  durationMinutes: number
  service: {
    name: string
    category: { name: string } | null
  }
}

type Props = {
  clients: Client[]
  offerings: Offering[]
  defaultClientId?: string
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/pro'
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

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function defaultDatetimeLocal(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * Parse "YYYY-MM-DDTHH:mm" (from <input type="datetime-local">)
 * into numeric parts. Returns null on invalid.
 */
function parseDatetimeLocal(value: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  if (!value || typeof value !== 'string') return null
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { year, month, day, hour, minute }
}

/**
 * Convert a datetime-local value (wall clock) to UTC ISO,
 * interpreting the wall clock in the PRO's timezone.
 */
function toUtcIsoFromDatetimeLocalInTimeZone(value: string, timeZone: string): string | null {
  const parts = parseDatetimeLocal(value)
  if (!parts) return null
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const dUtc = zonedTimeToUtc({ ...parts, second: 0, timeZone: tz })
  if (!dUtc || Number.isNaN(dUtc.getTime())) return null
  return dUtc.toISOString()
}

export default function NewBookingForm({ clients, offerings, defaultClientId }: Props) {
  const router = useRouter()

  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [offeringId, setOfferingId] = useState('')
  const [scheduledAt, setScheduledAt] = useState(() => defaultDatetimeLocal())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pro timezone (server truth). Fallback to browser tz, then UTC.
  const [proTimeZone, setProTimeZone] = useState<string>(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      return isValidIanaTimeZone(tz) ? tz : 'UTC'
    } catch {
      return 'UTC'
    }
  })

  useEffect(() => {
    let cancelled = false

    async function loadProTz() {
      try {
        // Uses an existing endpoint in your project that already returns timeZone.
        // If your /api/pro/calendar is heavy, we can swap to /api/pro/settings later.
        const res = await fetch('/api/pro/calendar', { cache: 'no-store' })
        const data = await safeJson(res)
        const tz = typeof data?.timeZone === 'string' ? data.timeZone.trim() : ''
        if (!cancelled && tz && isValidIanaTimeZone(tz)) setProTimeZone(tz)
      } catch {
        // ignore, keep fallback
      }
    }

    void loadProTz()
    return () => {
      cancelled = true
    }
  }, [])

  const clientOptions = useMemo(() => clients ?? [], [clients])
  const offeringOptions = useMemo(() => offerings ?? [], [offerings])

  function formatClientLabel(c: Client) {
    const email = c.user?.email ?? ''
    const phone = c.phone ? ` • ${c.phone}` : ''
    return `${c.firstName} ${c.lastName}${email ? ` • ${email}` : ''}${phone}`
  }

  function formatOfferingLabel(o: Offering) {
    const cat = o.service.category?.name
    const base = o.title || o.service.name
    const price = `$${moneyToString(o.price) ?? '0.00'}`
    return `${cat ? `${cat} • ` : ''}${base} • ${price} • ${o.durationMinutes} min`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (loading) return

    if (!clientId || !offeringId || !scheduledAt) {
      setError('Client, service, and date/time are required.')
      return
    }

    // Interpret the chosen wall-clock time in PRO timezone -> store as UTC ISO.
    const scheduledForISO = toUtcIsoFromDatetimeLocalInTimeZone(scheduledAt, proTimeZone)
    if (!scheduledForISO) {
      setError('Please choose a valid date/time.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/pro/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, offeringId, scheduledFor: scheduledForISO }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'new-booking')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      if (data?.id) router.push(`/pro/bookings/${data.id}`)
      else router.push('/pro/bookings')

      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error creating booking.')
    } finally {
      setLoading(false)
    }
  }

  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'
  const label = 'text-[12px] font-black text-textPrimary'
  const helper = 'mt-2 text-[12px] text-textSecondary'

  const tzLabel = sanitizeTimeZone(proTimeZone, 'UTC')

  return (
    <form onSubmit={handleSubmit} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="client" className={label}>
          Client <span className="text-textSecondary">*</span>
        </label>

        <select
          id="client"
          value={clientId}
          disabled={loading}
          onChange={(e) => setClientId(e.target.value)}
          className={field}
        >
          <option value="">Select client</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {formatClientLabel(c)}
            </option>
          ))}
        </select>

        {defaultClientId ? <div className={helper}>Client preselected from chart. You can change it if needed.</div> : null}
      </div>

      <div className="grid gap-2">
        <label htmlFor="offering" className={label}>
          Service <span className="text-textSecondary">*</span>
        </label>

        <select
          id="offering"
          value={offeringId}
          disabled={loading}
          onChange={(e) => setOfferingId(e.target.value)}
          className={field}
        >
          <option value="">Select service</option>
          {offeringOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {formatOfferingLabel(o)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <label htmlFor="datetime" className={label}>
          Date &amp; time <span className="text-textSecondary">*</span>
        </label>

        <input
          id="datetime"
          type="datetime-local"
          value={scheduledAt}
          disabled={loading}
          onChange={(e) => setScheduledAt(e.target.value)}
          className={field}
        />

        <div className={helper}>
          Shown in your device time, but saved using <span className="font-black">{tzLabel}</span> (pro timezone) as UTC ISO.
        </div>
      </div>

      {error ? <div className="text-[12px] font-black text-toneDanger">{error}</div> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={loading}
          className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={loading}
          className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          {loading ? 'Creating…' : 'Create booking'}
        </button>
      </div>
    </form>
  )
}
