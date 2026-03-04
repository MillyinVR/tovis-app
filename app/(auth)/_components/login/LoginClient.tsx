// app/(auth)/_components/login/LoginClient.tsx
'use client'

import Link from 'next/link'
import { useMemo, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AuthShell from '../AuthShell'
import { cn } from '@/lib/utils'
import { safeJsonRecord, readErrorMessage, readStringField } from '@/lib/http'
import { isRecord } from '@/lib/guards'

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

function readUserRole(data: unknown): 'ADMIN' | 'PRO' | 'CLIENT' | null {
  if (!isRecord(data)) return null
  const user = data.user
  if (!isRecord(user)) return null
  const role = user.role
  if (role === 'ADMIN' || role === 'PRO' || role === 'CLIENT') return role
  return null
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-black tracking-wide text-textSecondary">{children}</span>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary',
        'placeholder:text-textSecondary/70',
        'hover:border-surfaceGlass/16',
        'focus:border-accentPrimary/35 focus:ring-2 focus:ring-accentPrimary/15',
        props.className ?? '',
      )}
    />
  )
}

function PrimaryButton({ children, loading }: { children: React.ReactNode; loading?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={cn(
        'group relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
        'border border-accentPrimary/35 bg-accentPrimary/26 text-textPrimary',
        'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
        'hover:bg-accentPrimary/30 hover:border-accentPrimary/45 hover:before:opacity-100',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
        loading ? 'cursor-not-allowed opacity-65' : 'cursor-pointer',
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]"
      />
      <span className="relative inline-flex items-center gap-2">
        <span>{children}</span>
        <span aria-hidden="true" className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </button>
  )
}

function SecondaryLinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-[13px] font-black transition',
        'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
        'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
      )}
    >
      {children}
    </Link>
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

  async function handleSubmit(e: FormEvent) {
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

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError(readErrorMessage(data) ?? 'Login failed.')
        return
      }

      // Refresh app router caches after auth
      router.refresh()

      const nextUrlRaw = readStringField(data, 'nextUrl')
      const nextUrl = sanitizeNextUrl(nextUrlRaw)

      const role = readUserRole(data)

      const dest =
        nextUrl ??
        from ??
        (role === 'ADMIN' ? '/admin' : role === 'PRO' ? '/pro' : '/looks')

      router.replace(dest)
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const signupHref = ti ? `/signup?ti=${encodeURIComponent(ti)}` : '/signup'
  const forgotHref = ti ? `/forgot-password?ti=${encodeURIComponent(ti)}` : '/forgot-password'

  return (
    <AuthShell title="Login" subtitle="Enter your credentials. Try not to be dramatic about it.">
      <form onSubmit={handleSubmit} className="mt-1 grid gap-4">
        <label className="grid gap-1.5">
          <FieldLabel>Email</FieldLabel>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
          />
        </label>

        <label className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Password</FieldLabel>
            <Link href={forgotHref} className="text-[11px] font-black text-textSecondary/80 hover:text-textPrimary">
              Forgot password?
            </Link>
          </div>

          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            autoComplete="current-password"
          />
        </label>

        {error ? (
          <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
            {error}
          </div>
        ) : null}

        <div className="grid gap-2 pt-1">
          <PrimaryButton loading={loading}>{loading ? 'Logging in…' : 'Login'}</PrimaryButton>
          <SecondaryLinkButton href={signupHref}>Create an account</SecondaryLinkButton>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-textSecondary">
            <div className="text-textSecondary/70">No spam. Just bookings.</div>
            <Link href="/support" className="font-black text-textSecondary hover:text-textPrimary">
              Need help?
            </Link>
          </div>
        </div>
      </form>
    </AuthShell>
  )
}