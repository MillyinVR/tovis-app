'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

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

export default function NewClientForm() {
  const router = useRouter()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const fn = firstName.trim()
    const ln = lastName.trim()
    const em = email.trim()
    const ph = phone.trim()

    if (!fn || !ln || !em) {
      setError('First name, last name, and email are required.')
      return
    }

    if (loading) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    try {
      const res = await fetch('/api/pro/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          firstName: fn,
          lastName: ln,
          email: em,
          phone: ph || null,
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'new-client')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setSuccess(true)
      setFirstName('')
      setLastName('')
      setEmail('')
      setPhone('')

      router.refresh()
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error(err)
      setError('Network error while creating client.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
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
        gap: 12,
        background: '#fff',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label
            htmlFor="firstName"
            style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}
          >
            First name *
          </label>
          <input
            id="firstName"
            value={firstName}
            disabled={loading}
            onChange={(e) => setFirstName(e.target.value)}
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
        </div>

        <div>
          <label
            htmlFor="lastName"
            style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}
          >
            Last name *
          </label>
          <input
            id="lastName"
            value={lastName}
            disabled={loading}
            onChange={(e) => setLastName(e.target.value)}
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
        </div>
      </div>

      <div>
        <label
          htmlFor="email"
          style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}
        >
          Email *
        </label>
        <input
          id="email"
          type="email"
          value={email}
          disabled={loading}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="client@email.com"
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
      </div>

      <div>
        <label
          htmlFor="phone"
          style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}
        >
          Phone (optional)
        </label>
        <input
          id="phone"
          value={phone}
          disabled={loading}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="For reminders later"
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
      </div>

      {error && <div style={{ fontSize: 12, color: 'red' }}>{error}</div>}
      {success && <div style={{ fontSize: 12, color: '#2e7d32' }}>Client added.</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            fontSize: 13,
            background: loading ? '#374151' : '#111',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Add client'}
        </button>
      </div>
    </form>
  )
}
