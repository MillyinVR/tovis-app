'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type AllowedService = {
  id: string
  name: string
  description?: string | null
  categoryName?: string | null
  categoryDescription?: string | null
  defaultDurationMinutes: number
  minPrice: string // dollars string "49.99"
  allowMobile: boolean
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/pro/services'
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

// ---------- money helpers (client-side) ----------
function isValidMoneyString(v: string) {
  const s = v.trim()
  return /^\d+(\.\d{1,2})?$/.test(s)
}

function normalizeMoney2(v: string) {
  const s = v.trim()
  if (!isValidMoneyString(s)) return null
  const [a, b = ''] = s.split('.')
  if (b.length === 0) return `${a}.00`
  if (b.length === 1) return `${a}.${b}0`
  return `${a}.${b}`
}

// Compare money strings safely by converting to integer cents locally (frontend only).
function moneyToCentsInt(m: string) {
  const n = normalizeMoney2(m)
  if (!n) return null
  const [a, b] = n.split('.')
  return parseInt(a, 10) * 100 + parseInt(b, 10)
}
// -----------------------------------------------

export default function AddOfferingForm() {
  const router = useRouter()

  const [services, setServices] = useState<AllowedService[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')

  const [price, setPrice] = useState<string>('') // dollars string
  const [durationMinutes, setDurationMinutes] = useState<string>('')

  const [loading, setLoading] = useState(false)
  const [loadingServices, setLoadingServices] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    async function loadServices() {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        setLoadingServices(true)
        setError(null)

        const res = await fetch('/api/pro/allowed-services', { signal: controller.signal })

        if (res.status === 401) {
          redirectToLogin(router, 'allowed-services')
          return
        }

        const data = await safeJson(res)

        if (!res.ok) {
          setError(errorFromResponse(res, data))
          return
        }

        setServices(Array.isArray(data) ? data : [])
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        setError('Network error while loading services')
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setLoadingServices(false)
      }
    }

    loadServices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleServiceChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setSelectedServiceId(id)
    setError(null)
    setSuccess(null)

    const svc = services.find((s) => s.id === id)
    if (svc) {
      const minNorm = normalizeMoney2(svc.minPrice)
      // If minPrice comes back weird, don’t prefill junk. Let placeholder guide them.
      setPrice(minNorm ?? '')
      setDurationMinutes(String(svc.defaultDurationMinutes))
    } else {
      setPrice('')
      setDurationMinutes('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setSuccess(null)

    if (!selectedServiceId) {
      setError('Please choose a service.')
      return
    }

    const svc = services.find((s) => s.id === selectedServiceId)
    if (!svc) {
      setError('Selected service not found.')
      return
    }

    const minNorm = normalizeMoney2(svc.minPrice)
    if (!minNorm) {
      setError('This service has an invalid minimum price configuration.')
      return
    }

    const priceNorm = normalizeMoney2(price)
    if (!priceNorm) {
      setError('Price must be a valid amount like 50 or 49.99')
      return
    }

    const d = Number(durationMinutes)
    if (!Number.isFinite(d) || d <= 0) {
      setError('Duration must be a positive number.')
      return
    }

    const priceCents = moneyToCentsInt(priceNorm)
    const minCents = moneyToCentsInt(minNorm)
    if (priceCents === null || minCents === null) {
      setError('Invalid price configuration.')
      return
    }

    if (priceCents < minCents) {
      setError(`Price must be at least $${minNorm}.`)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/pro/offerings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: selectedServiceId,
          price: priceNorm, // dollars string
          durationMinutes: Math.trunc(d),
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'add-offering')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setSuccess('Service added to your offerings.')
      router.refresh()
    } catch {
      setError('Network error while saving offering')
    } finally {
      setLoading(false)
    }
  }

  if (loadingServices) return <p>Loading available services…</p>
  if (services.length === 0) return <p>No services are available for your license type yet.</p>

  const selected = services.find((s) => s.id === selectedServiceId) || null
  const minLabel = selected ? normalizeMoney2(selected.minPrice) : null

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
      <label>
        Service
        <select value={selectedServiceId} onChange={handleServiceChange} disabled={loading}>
          <option value="">Select a service</option>
          {services.map((svc) => (
            <option key={svc.id} value={svc.id}>
              {svc.categoryName ? `${svc.categoryName} – ${svc.name}` : svc.name}
            </option>
          ))}
        </select>
      </label>

      {selectedServiceId && selected ? (
        <>
          {selected.description ? <div style={{ fontSize: 13, color: '#555' }}>{selected.description}</div> : null}

          <label>
            Price {minLabel ? `(minimum $${minLabel})` : '(minimum set incorrectly)'}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={minLabel ?? '0.00'}
              disabled={loading}
            />
          </label>

          <label>
            Duration (minutes)
            <input
              type="number"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              min={1}
              disabled={loading}
            />
          </label>
        </>
      ) : null}

      {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}
      {success && <p style={{ color: 'green', fontSize: 13 }}>{success}</p>}

      <button type="submit" disabled={loading || !selectedServiceId}>
        {loading ? 'Saving…' : 'Add service'}
      </button>
    </form>
  )
}
