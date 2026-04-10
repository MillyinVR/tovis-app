'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import AuthShell from '../_components/AuthShell'
import { safeJsonRecord, readErrorMessage, readStringField } from '@/lib/http'
import { cn } from '@/lib/utils'

type VerificationStatus = {
  loaded: boolean
  sessionKind: 'ACTIVE' | 'VERIFICATION' | null
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
  nextUrl: string | null
  role: 'CLIENT' | 'PRO' | 'ADMIN' | null
  email: string | null
}

const EMPTY_STATUS: VerificationStatus = {
  loaded: false,
  sessionKind: null,
  isPhoneVerified: false,
  isEmailVerified: false,
  isFullyVerified: false,
  nextUrl: null,
  role: null,
  email: null,
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
        props.disabled && 'opacity-70',
        props.className ?? '',
      )}
    />
  )
}

function PrimaryButton({
  children,
  loading,
  disabled,
}: {
  children: React.ReactNode
  loading: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
        'border border-accentPrimary/35',
        'bg-accentPrimary/26 text-textPrimary',
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
      <span className="relative">{children}</span>
    </button>
  )
}

function TinyButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-black transition',
        'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
        'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {children}
    </button>
  )
}

function sanitizeNextUrl(raw: string | null) {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

function readRetryAfterSeconds(
  data: Record<string, unknown> | null,
): number | null {
  if (!data) return null
  const v = data.retryAfterSeconds
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function readBooleanField(
  data: Record<string, unknown> | null,
  key: string,
): boolean {
  return data?.[key] === true
}

function readRoleField(
  data: Record<string, unknown> | null,
): 'CLIENT' | 'PRO' | 'ADMIN' | null {
  const user = data?.user
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null
  const role = (user as Record<string, unknown>).role
  return role === 'CLIENT' || role === 'PRO' || role === 'ADMIN' ? role : null
}

function readEmailField(data: Record<string, unknown> | null): string | null {
  const user = data?.user
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null
  const email = (user as Record<string, unknown>).email
  return typeof email === 'string' && email.trim() ? email.trim() : null
}

function statusLabel(value: boolean): string {
  return value ? 'Verified' : 'Pending'
}

function buildDefaultNextUrl(role: 'CLIENT' | 'PRO' | 'ADMIN' | null): string {
  if (role === 'PRO') return '/pro/calendar'
  if (role === 'ADMIN') return '/admin'
  return '/looks'
}

export default function VerifyPhonePage() {
  const router = useRouter()
  const sp = useSearchParams()

  const nextFromQuery = useMemo(() => sanitizeNextUrl(sp.get('next')), [sp])
  const emailRetryRequested = useMemo(() => sp.get('email') === 'retry', [sp])

  const [status, setStatus] = useState<VerificationStatus>(EMPTY_STATUS)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sendingPhone, setSendingPhone] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  const resolvedNextUrl = useMemo(() => {
    return nextFromQuery ?? status.nextUrl ?? buildDefaultNextUrl(status.role)
  }, [nextFromQuery, status.nextUrl, status.role])

  async function refreshStatus() {
    const res = await fetch('/api/auth/verification/status', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
    })

    const data = await safeJsonRecord(res)

    if (!res.ok) {
      throw new Error(
        readErrorMessage(data) ?? 'Could not load verification status.',
      )
    }

    const nextUrl = sanitizeNextUrl(readStringField(data, 'nextUrl'))

    setStatus({
      loaded: true,
      sessionKind:
        data?.sessionKind === 'ACTIVE' || data?.sessionKind === 'VERIFICATION'
          ? data.sessionKind
          : null,
      isPhoneVerified: readBooleanField(data, 'isPhoneVerified'),
      isEmailVerified: readBooleanField(data, 'isEmailVerified'),
      isFullyVerified: readBooleanField(data, 'isFullyVerified'),
      nextUrl,
      role: readRoleField(data),
      email: readEmailField(data),
    })

    return {
      isFullyVerified: readBooleanField(data, 'isFullyVerified'),
      nextUrl,
      role: readRoleField(data),
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        const result = await refreshStatus()

        if (cancelled) return

        if (result.isFullyVerified) {
          const dest =
            nextFromQuery ??
            result.nextUrl ??
            buildDefaultNextUrl(result.role)
          router.replace(dest)
        }
      } catch (e) {
        if (cancelled) return
        console.error(e)
        setError(
          e instanceof Error ? e.message : 'Could not load verification status.',
        )
        setStatus((prev) => ({ ...prev, loaded: true }))
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [router, nextFromQuery])

  async function resendPhone() {
    if (sendingPhone || status.isPhoneVerified) return

    setError(null)
    setInfo(null)
    setSendingPhone(true)

    try {
      const res = await fetch('/api/auth/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const retryAfterSeconds = readRetryAfterSeconds(data)
        const retryMsg =
          retryAfterSeconds != null
            ? ` Try again in ~${Math.ceil(retryAfterSeconds / 60)} min.`
            : ''

        setError((readErrorMessage(data) ?? 'Could not resend code.') + retryMsg)
        return
      }

      await refreshStatus()
      setInfo('New phone verification code sent.')
    } catch (e) {
      console.error(e)
      setError('Network error.')
    } finally {
      setSendingPhone(false)
    }
  }

  async function resendEmail() {
    if (sendingEmail || status.isEmailVerified) return

    setError(null)
    setInfo(null)
    setSendingEmail(true)

    try {
      const res = await fetch('/api/auth/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const retryAfterSeconds = readRetryAfterSeconds(data)
        const retryMsg =
          retryAfterSeconds != null
            ? ` Try again in ~${Math.ceil(retryAfterSeconds / 60)} min.`
            : ''

        setError(
          (readErrorMessage(data) ?? 'Could not resend verification email.') +
            retryMsg,
        )
        return
      }

      await refreshStatus()
      setInfo('Verification email sent. Check your inbox.')
    } catch (e) {
      console.error(e)
      setError('Network error.')
    } finally {
      setSendingEmail(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || status.isPhoneVerified) return

    setError(null)
    setInfo(null)

    const trimmed = code.replace(/[^\d]/g, '')
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError(readErrorMessage(data) ?? 'Verification failed.')
        return
      }

      const refreshed = await refreshStatus()
      router.refresh()

      if (refreshed.isFullyVerified) {
        const dest =
          nextFromQuery ??
          refreshed.nextUrl ??
          buildDefaultNextUrl(refreshed.role)
        router.replace(dest)
        return
      }

      setInfo(
        'Phone verified. Email verification is still required before full app access.',
      )
    } catch (e) {
      console.error(e)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Complete your verification"
      subtitle="Both phone and email verification are required before full app access."
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
          <div className="flex items-center justify-between gap-3">
            <span>Phone</span>
            <span className="font-black text-textPrimary">
              {statusLabel(status.isPhoneVerified)}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <span>Email</span>
            <span className="font-black text-textPrimary">
              {statusLabel(status.isEmailVerified)}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <span>Account</span>
            <span className="font-black text-textPrimary">
              {status.isFullyVerified ? 'Fully verified' : 'Verification incomplete'}
            </span>
          </div>

          {status.email ? (
            <div className="mt-3 text-xs text-textSecondary/80">
              Verification email destination:{' '}
              <span className="font-black text-textPrimary">{status.email}</span>
            </div>
          ) : null}
        </div>

        {emailRetryRequested && !status.isEmailVerified ? (
          <div className="rounded-card border border-toneWarn/25 bg-toneWarn/10 px-3 py-2 text-sm font-bold text-toneWarn">
            We could not send your verification email during signup. Use the resend button below to send it now.
          </div>
        ) : null}

        {!status.isPhoneVerified ? (
          <label className="grid gap-1.5">
            <span className="text-xs font-black tracking-wide text-textSecondary">
              Phone verification code
            </span>

            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              disabled={loading || sendingPhone}
            />

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-textSecondary/80">
                Didn’t get the text?
              </span>
              <TinyButton
                onClick={resendPhone}
                disabled={sendingPhone || loading || status.isPhoneVerified}
              >
                {sendingPhone ? 'Sending…' : 'Resend code'}
              </TinyButton>
            </div>
          </label>
        ) : (
          <div className="rounded-card border border-accentPrimary/25 bg-accentPrimary/10 px-3 py-2 text-sm font-bold text-textPrimary">
            Your phone is verified.
          </div>
        )}

        {!status.isEmailVerified ? (
          <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
            <div className="font-black text-textPrimary">Verify your email</div>
            <div className="mt-1 text-xs text-textSecondary/80">
              Click the verification link we emailed you. You can resend it here if needed.
            </div>
            <div className="mt-3">
              <TinyButton
                onClick={resendEmail}
                disabled={sendingEmail || status.isEmailVerified}
              >
                {sendingEmail ? 'Sending…' : 'Resend verification email'}
              </TinyButton>
            </div>
          </div>
        ) : (
          <div className="rounded-card border border-accentPrimary/25 bg-accentPrimary/10 px-3 py-2 text-sm font-bold text-textPrimary">
            Your email is verified.
          </div>
        )}

        {info ? (
          <div className="rounded-card border border-accentPrimary/25 bg-accentPrimary/10 px-3 py-2 text-sm font-bold text-textPrimary">
            {info}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
            {error}
          </div>
        ) : null}

        {!status.isPhoneVerified ? (
          <PrimaryButton loading={loading} disabled={loading || sendingPhone}>
            {loading ? 'Verifying…' : 'Verify phone'}
          </PrimaryButton>
        ) : status.isFullyVerified ? (
          <Link
            href={resolvedNextUrl}
            className={cn(
              'relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
              'border border-accentPrimary/35',
              'bg-accentPrimary/26 text-textPrimary',
              'hover:bg-accentPrimary/30 hover:border-accentPrimary/45',
              'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
            )}
          >
            Continue
          </Link>
        ) : null}

        <div className="text-center text-xs text-textSecondary/80">
          <Link
            href="/login"
            className="font-black text-textPrimary hover:text-accentPrimary"
          >
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}