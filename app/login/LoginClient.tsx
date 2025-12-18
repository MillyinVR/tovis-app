'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

/**
 * Only allow internal redirects.
 * Prevents open-redirect abuse like /login?from=https://evil.com
 */
function sanitizeFrom(from: string | null): string | null {
  if (!from) return null
  const trimmed = from.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null
  return trimmed
}

export default function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const fromRaw = searchParams.get('from')
  const from = useMemo(() => sanitizeFrom(fromRaw), [fromRaw])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await safeJson(res)

      if (!res.ok) {
        setError(data?.error || 'Login failed.')
        return
      }

      // Make server components reflect the new auth state immediately
      router.refresh()

      // If we were redirected here from a protected route, go back there
      if (from) {
        router.replace(from)
        return
      }

      // Otherwise redirect by role (your "dashboard" behavior)
      const role = data?.user?.role
      if (role === 'CLIENT') router.replace('/client')
      else if (role === 'PRO') router.replace('/pro')
      else router.replace('/')
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: 16, fontFamily: 'system-ui' }}>
      <h1 style={{ marginBottom: 12 }}>Login</h1>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#374151' }}>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
            style={{ padding: 10, borderRadius: 10, border: '1px solid #e5e7eb' }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#374151' }}>Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            autoComplete="current-password"
            style={{ padding: 10, borderRadius: 10, border: '1px solid #e5e7eb' }}
          />
        </label>

        {error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div> : null}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 999,
            border: '1px solid #111',
            background: '#111',
            color: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
    </div>
  )
}
