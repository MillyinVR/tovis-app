'use client'

import Link from 'next/link'
import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'

import AuthShell from '../AuthShell'
import { cn } from '@/lib/utils'
import { safeJsonRecord, readErrorMessage, readStringField } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type UserRole = 'ADMIN' | 'PRO' | 'CLIENT'
type LoginReason =
  | 'PRO_REQUIRED'
  | 'PRO_SETUP_REQUIRED'
  | 'ADMIN_REQUIRED'
  | 'LOGIN_REQUIRED'

const PRO_HOME = '/pro/calendar'

function sanitizeInternalPath(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

function isAuthPath(path: string): boolean {
  return (
    path === '/login' ||
    path.startsWith('/login?') ||
    path === '/signup' ||
    path.startsWith('/signup?') ||
    path === '/forgot-password' ||
    path.startsWith('/forgot-password?')
  )
}

function sanitizeRedirectTarget(path: string | null): string | null {
  if (!path) return null
  if (isAuthPath(path)) return null
  return path
}

function sanitizeReason(raw: string | null): LoginReason | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()
  if (
    s === 'PRO_REQUIRED' ||
    s === 'PRO_SETUP_REQUIRED' ||
    s === 'ADMIN_REQUIRED' ||
    s === 'LOGIN_REQUIRED'
  ) {
    return s
  }
  return null
}

function readUserRole(data: unknown): UserRole | null {
  if (!isRecord(data)) return null
  const user = data.user
  if (!isRecord(user)) return null
  const role = user.role
  return role === 'ADMIN' || role === 'PRO' || role === 'CLIENT' ? role : null
}

function readBooleanField(data: unknown, key: string): boolean {
  if (!isRecord(data)) return false
  return data[key] === true
}

function roleIntentFromPath(path: string | null): UserRole | null {
  if (!path) return null
  if (path === '/admin' || path.startsWith('/admin/')) return 'ADMIN'
  if (path === '/pro' || path.startsWith('/pro/')) return 'PRO'
  return null
}

function normalizeLanding(path: string, role: UserRole): string {
  if (role === 'PRO') {
    if (path === '/pro' || path.startsWith('/pro?')) return PRO_HOME
  }
  return path
}

function buildVerificationHref(nextPath: string): string {
  return `/verify-phone?next=${encodeURIComponent(nextPath)}`
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-black tracking-wide text-textSecondary">
      {children}
    </span>
  )
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

function PrimaryButton({
  children,
  loading,
}: {
  children: React.ReactNode
  loading?: boolean
}) {
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
        <span
          aria-hidden="true"
          className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
    </button>
  )
}

function SecondaryLinkButton({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
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
  const searchParams = useSearchParams()

  const fromRaw = searchParams.get('from')
  const from = useMemo(() => sanitizeInternalPath(fromRaw), [fromRaw])
  const fromSafe = useMemo(() => sanitizeRedirectTarget(from), [from])

  const reasonRaw = searchParams.get('reason')
  const explicitReason = useMemo(() => sanitizeReason(reasonRaw), [reasonRaw])

  const ti = searchParams.get('ti')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const inferredReason = useMemo<LoginReason | null>(() => {
    if (explicitReason) return explicitReason
    const intent = roleIntentFromPath(fromSafe)
    if (intent === 'ADMIN') return 'ADMIN_REQUIRED'
    if (intent === 'PRO') return 'PRO_REQUIRED'
    return null
  }, [explicitReason, fromSafe])

  const reasonCopy = useMemo(() => {
    if (!inferredReason) return null

    switch (inferredReason) {
      case 'LOGIN_REQUIRED':
        return {
          title: 'Login required',
          body: 'Please log in to continue.',
        }
      case 'ADMIN_REQUIRED':
        return {
          title: 'Admin account required',
          body: 'You tried to open an admin-only page. Log in with your admin account.',
        }
      case 'PRO_REQUIRED':
        return {
          title: 'Professional account required',
          body: 'You tried to open a Pro-only page. Log in with your Pro account (or create one).',
        }
      case 'PRO_SETUP_REQUIRED':
        return {
          title: 'Professional setup required',
          body: 'Your account is Pro, but it isn’t fully set up yet (missing a professional profile). Finish setup or contact support.',
        }
    }
  }, [inferredReason])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setLoading(true)

    try {
      const emailTrimmed = email.trim()
      const passwordTrimmed = password.trim()

      if (!emailTrimmed || !passwordTrimmed) {
        setError('Email and password are required.')
        return
      }

      const expectedRole = roleIntentFromPath(fromSafe)

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          email: emailTrimmed,
          password: passwordTrimmed,
          expectedRole: expectedRole ?? undefined,
          tapIntentId: ti ?? undefined,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError(readErrorMessage(data) ?? 'Login failed.')
        return
      }

      const role = readUserRole(data)
      if (!role) {
        setError(
          'Login succeeded, but your account role is missing. Please contact support.',
        )
        return
      }

      const nextUrlRaw = readStringField(data, 'nextUrl')
      const nextUrl = sanitizeRedirectTarget(
        sanitizeInternalPath(nextUrlRaw ?? null),
      )

      const roleDefault =
        role === 'ADMIN' ? '/admin' : role === 'PRO' ? PRO_HOME : '/looks'

      const rawDest = nextUrl ?? fromSafe ?? roleDefault
      const dest = normalizeLanding(rawDest, role)

      const isPhoneVerified = readBooleanField(data, 'isPhoneVerified')
      const isEmailVerified = readBooleanField(data, 'isEmailVerified')
      const isFullyVerified = readBooleanField(data, 'isFullyVerified')

      if (!isFullyVerified) {
        if (role === 'ADMIN') {
          setError(
            'This account is not fully verified yet. Full app access is blocked until phone and email verification are complete.',
          )
          return
        }

        const verificationDest = buildVerificationHref(dest)

        if (!isPhoneVerified || !isEmailVerified) {
          window.location.assign(verificationDest)
          return
        }
      }

      window.location.assign(dest)
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const signupHref = ti ? `/signup?ti=${encodeURIComponent(ti)}` : '/signup'
  const forgotHref = ti
    ? `/forgot-password?ti=${encodeURIComponent(ti)}`
    : '/forgot-password'

  return (
    <AuthShell
      title="Login"
      subtitle="Enter your credentials. Try not to be dramatic about it."
    >
      <form noValidate onSubmit={handleSubmit} className="mt-1 grid gap-4">
        {reasonCopy ? (
          <div className="rounded-card border border-toneWarn/25 bg-toneWarn/10 px-3 py-2 text-sm font-semibold text-toneWarn">
            <div className="font-black">{reasonCopy.title}</div>
            <div className="mt-0.5 text-[13px] font-semibold text-toneWarn/90">
              {reasonCopy.body}
            </div>
          </div>
        ) : null}

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
            <Link
              href={forgotHref}
              className="text-[11px] font-black text-textSecondary/80 hover:text-textPrimary"
            >
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
          <PrimaryButton loading={loading}>
            {loading ? 'Logging in…' : 'Login'}
          </PrimaryButton>

          <SecondaryLinkButton href={signupHref}>
            Create an account
          </SecondaryLinkButton>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-textSecondary">
            <div className="text-textSecondary/70">No spam. Just bookings.</div>
            <Link
              href="/support"
              className="font-black text-textSecondary hover:text-textPrimary"
            >
              Need help?
            </Link>
          </div>
        </div>
      </form>
    </AuthShell>
  )
}