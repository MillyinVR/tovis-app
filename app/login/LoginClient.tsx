// app/login/LoginClient.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function sanitizeFrom(from: string | null): string | null {
  if (!from) return null
  const trimmed = from.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null
  return trimmed
}

function sanitizeNextUrl(nextUrl: unknown): string | null {
  if (typeof nextUrl !== 'string') return null
  const s = nextUrl.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-black text-textSecondary">{children}</span>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        'w-full rounded-card border border-surfaceGlass/12 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none',
        'placeholder:text-textSecondary/70',
        'focus:border-accentPrimary/50 focus:ring-2 focus:ring-accentPrimary/20',
        props.className ?? '',
      ].join(' ')}
    />
  )
}

export default function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const fromRaw = searchParams.get('from')
  const from = useMemo(() => sanitizeFrom(fromRaw), [fromRaw])

  const ti = searchParams.get('ti')

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
        body: JSON.stringify({ email, password, tapIntentId: ti ?? undefined }),
      })

      const data = await safeJson(res)

      if (!res.ok) {
        setError(data?.error || 'Login failed.')
        return
      }

      router.refresh()

      const nextUrl = sanitizeNextUrl(data?.nextUrl)
      if (nextUrl) return router.replace(nextUrl)
      if (from) return router.replace(from)

      const role = data?.user?.role
      if (role === 'CLIENT') router.replace('/client')
      else if (role === 'PRO') router.replace('/pro/dashboard')
      else router.replace('/')
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-420px px-4 text-textPrimary">
      <div className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-5">
        <div className="grid gap-1">
          <h1 className="text-xl font-extrabold">Login</h1>
          <p className="text-sm text-textSecondary">Enter your credentials. Try not to be dramatic about it.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-2 grid gap-3">
          <label className="grid gap-1.5">
            <FieldLabel>Email</FieldLabel>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email" />
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Password</FieldLabel>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="current-password"
            />
          </label>

          {error ? <div className="text-sm font-bold text-toneDanger">{error}</div> : null}

          <button
            type="submit"
            disabled={loading}
            className={[
              'mt-1 inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-black',
              'border-accentPrimary/45 bg-accentPrimary/15 text-accentPrimary hover:bg-accentPrimary/20',
              loading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            {loading ? 'Logging in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  )
}
