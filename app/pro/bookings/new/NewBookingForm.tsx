// app/pro/bookings/new/NewBookingForm.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { moneyToString } from '@/lib/money'

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

function toISOFromDatetimeLocal(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function defaultDatetimeLocal(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NewBookingForm({ clients, offerings, defaultClientId }: Props) {
  const router = useRouter()

  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [offeringId, setOfferingId] = useState('')
  const [scheduledAt, setScheduledAt] = useState(() => defaultDatetimeLocal())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    const scheduledForISO = toISOFromDatetimeLocal(scheduledAt)
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

        {defaultClientId ? (
          <div className={helper}>Client preselected from chart. You can change it if needed.</div>
        ) : null}
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

        <div className={helper}>Uses your browser&apos;s local timezone, stored as ISO.</div>
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
