'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import AuthShell from '../_components/AuthShell'
import { cn } from '@/lib/utils'
import {
  safeJsonRecord,
  readErrorMessage,
  readStringField,
} from '@/lib/http'

type VerifyEmailResult = {
  alreadyVerified: boolean
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
  requiresPhoneVerification: boolean
}

type VerificationStatus = {
  loaded: boolean
  nextUrl: string | null
  role: 'CLIENT' | 'PRO' | 'ADMIN' | null
}

const EMPTY_STATUS: VerificationStatus = {
  loaded: false,
  nextUrl: null,
  role: null,
}

function sanitizeToken(raw: string | null): string | null {
  const value = (raw ?? '').trim()
  return value.length > 0 ? value : null
}

function sanitizeNextUrl(raw: string | null): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  return value
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readRoleField(
  data: Record<string, unknown> | null,
): 'CLIENT' | 'PRO' | 'ADMIN' | null {
  const user = data?.user
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null
  const role = (user as Record<string, unknown>).role
  return role === 'CLIENT' || role === 'PRO' || role === 'ADMIN' ? role : null
}

function buildDefaultNextUrl(role: 'CLIENT' | 'PRO' | 'ADMIN' | null): string {
  if (role === 'PRO') return '/pro/calendar'
  if (role === 'ADMIN') return '/admin'
  return '/looks'
}

function PrimaryLinkButton({
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
        'relative inline-flex w-full items-center justify-center overflow-hidden rounded-full px-4 py-2.5 text-sm font-black transition',
        'border border-accentPrimary/35',
        'bg-accentPrimary/26 text-textPrimary',
        'before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.10),transparent)] before:opacity-0 before:transition',
        'hover:bg-accentPrimary/30 hover:border-accentPrimary/45 hover:before:opacity-100',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/20',
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]"
      />
      <span className="relative">{children}</span>
    </Link>
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
        'inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-sm font-black transition',
        'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
        'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
        'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
      )}
    >
      {children}
    </Link>
  )
}

export default function VerifyEmailPage() {
  const attemptedRef = useRef(false)

  const token = useMemo(() => {
    if (typeof window === 'undefined') return null
    const url = new URL(window.location.href)
    return sanitizeToken(url.searchParams.get('token'))
  }, [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VerifyEmailResult | null>(null)
  const [status, setStatus] = useState<VerificationStatus>(EMPTY_STATUS)

  async function refreshVerificationStatus(): Promise<VerificationStatus> {
    const res = await fetch('/api/auth/verification/status', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })

    const data = await safeJsonRecord(res)

    if (!res.ok) {
      return EMPTY_STATUS
    }

    const nextUrl = sanitizeNextUrl(readStringField(data, 'nextUrl'))

    const nextStatus: VerificationStatus = {
      loaded: true,
      nextUrl,
      role: readRoleField(data),
    }

    setStatus(nextStatus)
    return nextStatus
  }

  useEffect(() => {
    if (attemptedRef.current) return
    attemptedRef.current = true

    async function verifyEmail() {
      if (!token) {
        setLoading(false)
        setError('Verification token is missing.')
        return
      }

      setLoading(true)
      setError(null)

      try {
        const res = await fetch(
          `/api/auth/email/verify?token=${encodeURIComponent(token)}`,
          {
            method: 'POST',
            cache: 'no-store',
            credentials: 'include',
          },
        )

        const data = await safeJsonRecord(res)

        if (!res.ok) {
          setError(readErrorMessage(data) ?? 'Email verification failed.')
          setLoading(false)
          return
        }

        const nextResult: VerifyEmailResult = {
          alreadyVerified: readBoolean(data?.alreadyVerified),
          isPhoneVerified: readBoolean(data?.isPhoneVerified),
          isEmailVerified: readBoolean(data?.isEmailVerified),
          isFullyVerified: readBoolean(data?.isFullyVerified),
          requiresPhoneVerification: readBoolean(data?.requiresPhoneVerification),
        }

        setResult(nextResult)
        await refreshVerificationStatus()
      } catch (err) {
        console.error(err)
        setError('Network error.')
      } finally {
        setLoading(false)
      }
    }

    void verifyEmail()
  }, [token])

  const isSuccess = Boolean(result?.isEmailVerified)
  const isFullyVerified = Boolean(result?.isFullyVerified)
  const requiresPhoneVerification = Boolean(result?.requiresPhoneVerification)

  const continueHref =
    status.nextUrl ?? buildDefaultNextUrl(status.role)

  const title = loading
    ? 'Verifying your email'
    : isSuccess
      ? 'Email verified'
      : 'Email verification failed'

  const subtitle = loading
    ? 'Hang on while we confirm your email address.'
    : isSuccess
      ? isFullyVerified
        ? 'Your email is verified and your account is fully verified.'
        : 'Your email is verified. Phone verification is still required before full app access.'
      : 'That link is invalid, expired, or already used.'

  return (
    <AuthShell title={title} subtitle={subtitle}>
      <div className="grid gap-4">
        {loading ? (
          <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-2 text-sm font-bold text-textPrimary">
            Verifying your email…
          </div>
        ) : null}

        {isSuccess && result?.alreadyVerified ? (
          <div className="rounded-card border border-accentPrimary/25 bg-accentPrimary/10 px-3 py-2 text-sm font-bold text-textPrimary">
            This email was already verified. No drama, we’re still counting it.
          </div>
        ) : null}

        {isSuccess && !result?.alreadyVerified ? (
          <div className="rounded-card border border-accentPrimary/25 bg-accentPrimary/10 px-3 py-2 text-sm font-bold text-textPrimary">
            Your email is verified successfully.
          </div>
        ) : null}

        {isSuccess ? (
          <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
            <div>
              Email:{' '}
              <span className="font-black text-textPrimary">Verified</span>
            </div>
            <div className="mt-1">
              Phone:{' '}
              <span className="font-black text-textPrimary">
                {result?.isPhoneVerified ? 'Verified' : 'Still required'}
              </span>
            </div>
            <div className="mt-1">
              Account:{' '}
              <span className="font-black text-textPrimary">
                {isFullyVerified ? 'Fully verified' : 'Not fully verified yet'}
              </span>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
            {error}
          </div>
        ) : null}

        {!loading ? (
          <div className="grid gap-2 pt-1">
            {isFullyVerified ? (
              <PrimaryLinkButton href={continueHref}>
                Continue
              </PrimaryLinkButton>
            ) : requiresPhoneVerification ? (
              <PrimaryLinkButton href="/verify-phone">
                Continue to phone verification
              </PrimaryLinkButton>
            ) : (
              <PrimaryLinkButton href="/login">
                Go to sign in
              </PrimaryLinkButton>
            )}

            <SecondaryLinkButton href="/login">
              Back to sign in
            </SecondaryLinkButton>

            {!isFullyVerified ? (
              <div className="text-center text-xs text-textSecondary/80">
                Full app access is locked until both phone and email are verified.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AuthShell>
  )
}