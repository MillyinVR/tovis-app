// app/(auth)/verify-email/page.tsx
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

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
  email: string | null
}

const EMPTY_STATUS: VerificationStatus = {
  loaded: false,
  nextUrl: null,
  role: null,
  email: null,
}

function sanitizeToken(raw: string | null): string | null {
  const value = (raw ?? '').trim()
  return value.length > 0 ? value : null
}

function sanitizeVerificationId(raw: string | null): string | null {
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

function sanitizeOptionalText(raw: string | null): string | null {
  const value = (raw ?? '').trim()
  return value || null
}

function appendIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value) params.set(key, value)
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

function readEmailField(data: Record<string, unknown> | null): string | null {
  const user = data?.user
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null
  const email = (user as Record<string, unknown>).email
  return typeof email === 'string' && email.trim() ? email.trim() : null
}

function buildDefaultNextUrl(role: 'CLIENT' | 'PRO' | 'ADMIN' | null): string {
  if (role === 'PRO') return '/pro/calendar'
  if (role === 'ADMIN') return '/admin'
  return '/looks'
}

function buildVerifyPhoneHref(args: {
  next: string | null
  emailRetry?: boolean
  intent: string | null
  inviteToken: string | null
}): string {
  const params = new URLSearchParams()

  appendIfPresent(params, 'next', args.next)
  appendIfPresent(params, 'intent', args.intent)
  appendIfPresent(params, 'inviteToken', args.inviteToken)
  if (args.emailRetry) params.set('email', 'retry')

  const qs = params.toString()
  return qs ? `/verify-phone?${qs}` : '/verify-phone'
}

function buildLoginHref(args: {
  next: string | null
  email: string | null
  intent: string | null
  inviteToken: string | null
}): string {
  const params = new URLSearchParams()

  appendIfPresent(params, 'from', args.next)
  appendIfPresent(params, 'next', args.next)
  appendIfPresent(params, 'email', args.email)
  appendIfPresent(params, 'intent', args.intent)
  appendIfPresent(params, 'inviteToken', args.inviteToken)

  const qs = params.toString()
  return qs ? `/login?${qs}` : '/login'
}

function PrimaryActionButton({
  children,
  loading,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  loading: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
  const searchParams = useSearchParams()

  const verificationId = useMemo(
    () => sanitizeVerificationId(searchParams.get('verificationId')),
    [searchParams],
  )
  const token = useMemo(
    () => sanitizeToken(searchParams.get('token')),
    [searchParams],
  )
  const nextFromQuery = useMemo(
    () => sanitizeNextUrl(searchParams.get('next')),
    [searchParams],
  )
  const intent = useMemo(
    () => sanitizeOptionalText(searchParams.get('intent')),
    [searchParams],
  )
  const inviteToken = useMemo(
    () => sanitizeOptionalText(searchParams.get('inviteToken')),
    [searchParams],
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VerifyEmailResult | null>(null)
  const [status, setStatus] = useState<VerificationStatus>(EMPTY_STATUS)

  const hasValidParams = Boolean(verificationId && token)

  async function refreshVerificationStatus(): Promise<VerificationStatus> {
    const res = await fetch('/api/auth/verification/status', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })

    const data = await safeJsonRecord(res)

    if (!res.ok) {
      const fallback = { ...EMPTY_STATUS, loaded: true }
      setStatus(fallback)
      return fallback
    }

    const nextUrl = sanitizeNextUrl(readStringField(data, 'nextUrl'))

    const nextStatus: VerificationStatus = {
      loaded: true,
      nextUrl,
      role: readRoleField(data),
      email: readEmailField(data),
    }

    setStatus(nextStatus)
    return nextStatus
  }

  async function onConfirm() {
    if (!verificationId || !token || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/email/verify', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verificationId,
          token,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError(readErrorMessage(data) ?? 'Email verification failed.')
        return
      }

      const nextResult: VerifyEmailResult = {
        alreadyVerified: readBoolean(data?.alreadyVerified),
        isPhoneVerified: readBoolean(data?.isPhoneVerified),
        isEmailVerified: readBoolean(data?.isEmailVerified),
        isFullyVerified: readBoolean(data?.isFullyVerified),
        requiresPhoneVerification: readBoolean(
          data?.requiresPhoneVerification,
        ),
      }

      setResult(nextResult)
      await refreshVerificationStatus()
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  const isSuccess = Boolean(result?.isEmailVerified)
  const isFullyVerified = Boolean(result?.isFullyVerified)
  const requiresPhoneVerification = Boolean(result?.requiresPhoneVerification)

  const resolvedNextUrl =
    nextFromQuery ?? status.nextUrl ?? buildDefaultNextUrl(status.role)

  const continueHref = resolvedNextUrl
  const verifyPhoneHref = buildVerifyPhoneHref({
    next: resolvedNextUrl,
    intent,
    inviteToken,
  })
  const verifyPhoneRetryHref = buildVerifyPhoneHref({
    next: resolvedNextUrl,
    emailRetry: true,
    intent,
    inviteToken,
  })
  const loginHref = buildLoginHref({
    next: resolvedNextUrl,
    email: status.email,
    intent,
    inviteToken,
  })

  const title = isSuccess
    ? 'Email verified'
    : hasValidParams
      ? 'Confirm your email'
      : 'Email verification failed'

  const subtitle = isSuccess
    ? isFullyVerified
      ? 'Your email is verified and your account is fully verified.'
      : 'Your email is verified. Phone verification is still required before full app access.'
    : hasValidParams
      ? 'Confirm this email verification to continue setting up your TOVIS account.'
      : 'That verification link is missing required information.'

  return (
    <AuthShell title={title} subtitle={subtitle}>
      <div className="grid gap-4">
        {!isSuccess && hasValidParams ? (
          <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
            <div className="font-black text-textPrimary">Ready to verify</div>
            <div className="mt-1 text-xs text-textSecondary/80">
              For safety, email verification is only consumed after you confirm
              it here.
            </div>
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

        {!isSuccess ? (
          <div className="grid gap-2 pt-1">
            {hasValidParams ? (
              <PrimaryActionButton
                loading={submitting}
                onClick={onConfirm}
                disabled={submitting}
              >
                {submitting ? 'Confirming…' : 'Confirm email verification'}
              </PrimaryActionButton>
            ) : (
              <PrimaryLinkButton href={verifyPhoneRetryHref}>
                Go to verification
              </PrimaryLinkButton>
            )}

            {error ? (
              <PrimaryLinkButton href={verifyPhoneRetryHref}>
                Request a new verification email
              </PrimaryLinkButton>
            ) : null}

            <SecondaryLinkButton href={loginHref}>
              Back to sign in
            </SecondaryLinkButton>

            <div className="text-center text-xs text-textSecondary/80">
              Full app access is locked until both phone and email are verified.
            </div>
          </div>
        ) : (
          <div className="grid gap-2 pt-1">
            {isFullyVerified ? (
              <PrimaryLinkButton href={continueHref}>Continue</PrimaryLinkButton>
            ) : requiresPhoneVerification ? (
              <PrimaryLinkButton href={verifyPhoneHref}>
                Continue to phone verification
              </PrimaryLinkButton>
            ) : (
              <PrimaryLinkButton href={loginHref}>
                Go to sign in
              </PrimaryLinkButton>
            )}

            <SecondaryLinkButton href={loginHref}>
              Back to sign in
            </SecondaryLinkButton>

            {!isFullyVerified ? (
              <div className="text-center text-xs text-textSecondary/80">
                Full app access is locked until both phone and email are
                verified.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </AuthShell>
  )
}