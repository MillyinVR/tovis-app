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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

export default function NewBookingForm({ clients, offerings, defaultClientId }: Props) {
  const router = useRouter()

  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [offeringId, setOfferingId] = useState('')
  const [scheduledAt, setScheduledAt] = useState(() => defaultDatetimeLocal()) // ✅ prefilled
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
        body: JSON.stringify({
          clientId,
          offeringId,
          scheduledFor: scheduledForISO,
        }),
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

      // ✅ Go to the booking details page (or swap to '/pro/bookings' if you don’t have details yet)
      if (data?.id) {
        router.push(`/pro/bookings/${data.id}`)
      } else {
        router.push('/pro/bookings')
      }
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error creating booking.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: '1px solid #eee',
        borderRadius: 12,
        padding: 16,
        display: 'grid',
        gap: 14,
        background: '#fff',
      }}
    >
      <div>
        <label htmlFor="client" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
          Client *
        </label>
        <select
          id="client"
          value={clientId}
          disabled={loading}
          onChange={(e) => setClientId(e.target.value)}
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #ddd',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            opacity: loading ? 0.85 : 1,
          }}
        >
          <option value="">Select client</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {formatClientLabel(c)}
            </option>
          ))}
        </select>

        {defaultClientId && (
          <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
            Client preselected from chart. You can change it if needed.
          </div>
        )}
      </div>

      <div>
        <label htmlFor="offering" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
          Service *
        </label>
        <select
          id="offering"
          value={offeringId}
          disabled={loading}
          onChange={(e) => setOfferingId(e.target.value)}
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #ddd',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            opacity: loading ? 0.85 : 1,
          }}
        >
          <option value="">Select service</option>
          {offeringOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {formatOfferingLabel(o)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="datetime" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
          Date & time *
        </label>
        <input
          id="datetime"
          type="datetime-local"
          value={scheduledAt}
          disabled={loading}
          onChange={(e) => setScheduledAt(e.target.value)}
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #ddd',
            padding: 8,
            fontSize: 13,
            fontFamily: 'inherit',
            opacity: loading ? 0.85 : 1,
          }}
        />
        <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
          Uses your browser&apos;s local timezone, stored as ISO.
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: 'red' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: '1px solid #ccc',
            fontSize: 13,
            background: '#f7f7f7',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.85 : 1,
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '6px 16px',
            borderRadius: 999,
            border: 'none',
            fontSize: 13,
            background: loading ? '#374151' : '#111',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Creating…' : 'Create booking'}
        </button>
      </div>
    </form>
  )
}
