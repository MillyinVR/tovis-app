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

  // Only allow same-site relative paths
  if (!trimmed.startsWith('/')) return null

  // Avoid protocol-relative //evil.com
  if (trimmed.startsWith('//')) return null

  return trimmed
}

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const fromRaw = searchParams.get('from')
  const reason = searchParams.get('reason') // optional, for future UX messaging
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
        router.push(from)
        return
      }

      // Otherwise redirect by role
      const role = data?.user?.role
      if (role === 'CLIENT') router.push('/client')
      else if (role === 'PRO') router.push('/pro')
      else router.push('/')
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>Login</h1>

      {/* optional: you can wire this to show a nicer message later */}
      {reason ? (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: -8 }}>
          Please log in to continue.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            autoComplete="current-password"
          />
        </label>

        {error && <p style={{ color: 'red', fontSize: 13 }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
    </div>
  )
}
