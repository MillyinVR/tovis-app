// app/(auth)/verify-phone/page.tsx
'use client'

import Link from 'next/link'
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import AuthNotice from '../_components/AuthNotice'
import AuthShell from '../_components/AuthShell'
import Input from '../_components/Input'
import PrimaryButton, {
  primaryButtonClassName,
} from '../_components/PrimaryButton'
import {
  RESEND_COOLDOWN_SECONDS,
  formatCooldown,
  readRetryAfterSeconds,
} from '../_components/otpCooldown'
import {
  safeJsonRecord,
  readBooleanField,
  readErrorMessage,
  readStringField,
} from '@/lib/http'
import { cn } from '@/lib/utils'
import { useBrand } from '@/lib/brand/BrandProvider'

const NEXT_URL_RECOVERY_DELAY_MS = 3000

/**
 * Which control a notice reports on, so it renders directly above the button
 * that was pressed: the code submit ('submit'), the phone resend row
 * ('phone'), the phone-correction card ('phone-correct'), or the email resend
 * card ('email'). One shared error state used to dump everything above the
 * bottom submit button — ~100 lines below the resend buttons that produced it.
 */
type NoticeAt = 'submit' | 'phone' | 'phone-correct' | 'email'

type Notice = { at: NoticeAt; message: string }

type VerificationStatus = {
  loaded: boolean
  sessionKind: 'ACTIVE' | 'VERIFICATION' | null
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
  nextUrl: string | null
  role: 'CLIENT' | 'PRO' | 'ADMIN' | null
  email: string | null
  phone: string | null
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
  phone: null,
}

function TinyButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
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

function sanitizeNextUrl(raw: string | null): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

function sanitizeOptionalText(raw: string | null): string | null {
  const s = (raw ?? '').trim()
  return s || null
}

function appendIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value) params.set(key, value)
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

function readUserField(
  data: Record<string, unknown> | null,
  key: string,
): string | null {
  const user = data?.user
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null

  const value = (user as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRoleField(
  data: Record<string, unknown> | null,
): 'CLIENT' | 'PRO' | 'ADMIN' | null {
  const role = readUserField(data, 'role')
  return role === 'CLIENT' || role === 'PRO' || role === 'ADMIN' ? role : null
}

function statusLabel(value: boolean): string {
  return value ? 'Verified' : 'Pending'
}

function buildDefaultNextUrl(role: 'CLIENT' | 'PRO' | 'ADMIN' | null): string {
  if (role === 'PRO') return '/pro/calendar'
  if (role === 'ADMIN') return '/admin'
  return '/looks'
}

function getPhoneDisplayDigits(value: string): string {
  return Array.from(value)
    .filter((char) => char >= '0' && char <= '9')
    .join('')
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null

  const displayDigits = getPhoneDisplayDigits(phone)

  if (displayDigits.length < 4) return phone

  return `*** *** ${displayDigits.slice(-4)}`
}

export default function VerifyPhonePage() {
  const router = useRouter()
  const sp = useSearchParams()
  const { brand } = useBrand()

  const nextFromQuery = useMemo(() => sanitizeNextUrl(sp.get('next')), [sp])
  const emailRetryRequested = useMemo(() => sp.get('email') === 'retry', [sp])
  const smsRetryRequested = useMemo(() => sp.get('sms') === 'retry', [sp])
  const intent = useMemo(() => sanitizeOptionalText(sp.get('intent')), [sp])
  const inviteToken = useMemo(
    () => sanitizeOptionalText(sp.get('inviteToken')),
    [sp],
  )

  const [status, setStatus] = useState<VerificationStatus>(EMPTY_STATUS)
  const [recoveredNextUrl, setRecoveredNextUrl] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<Notice | null>(null)
  const [info, setInfo] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(false)
  const [sendingPhone, setSendingPhone] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  const [phoneCooldownSeconds, setPhoneCooldownSeconds] = useState(0)
  const [emailCooldownSeconds, setEmailCooldownSeconds] = useState(0)

  const [showPhoneCorrection, setShowPhoneCorrection] = useState(false)
  const [correctPhone, setCorrectPhone] = useState('')
  const [correctingPhone, setCorrectingPhone] = useState(false)

  const resolvedNextUrl = useMemo(() => {
    return (
      nextFromQuery ??
      recoveredNextUrl ??
      status.nextUrl ??
      buildDefaultNextUrl(status.role)
    )
  }, [nextFromQuery, recoveredNextUrl, status.nextUrl, status.role])

  const loginHref = useMemo(
    () =>
      buildLoginHref({
        next: resolvedNextUrl,
        email: status.email,
        intent,
        inviteToken,
      }),
    [resolvedNextUrl, status.email, intent, inviteToken],
  )

  const maskedPhone = useMemo(() => maskPhone(status.phone), [status.phone])

  useEffect(() => {
    if (phoneCooldownSeconds <= 0 && emailCooldownSeconds <= 0) return

    const interval = window.setInterval(() => {
      setPhoneCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0))
      setEmailCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => window.clearInterval(interval)
  }, [phoneCooldownSeconds, emailCooldownSeconds])

  async function refreshStatus() {
    const res = await fetch('/api/v1/auth/verification/status', {
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

    const nextStatus: VerificationStatus = {
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
      email: readUserField(data, 'email'),
      phone: readUserField(data, 'phone'),
    }

    setStatus(nextStatus)

    return {
      isFullyVerified: nextStatus.isFullyVerified,
      sessionKind: nextStatus.sessionKind,
      nextUrl,
      role: nextStatus.role,
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        const result = await refreshStatus()

        if (cancelled) return

        // Only leave once the session cookie is ACTIVE — the status call
        // upgrades stale VERIFICATION sessions itself, so this holds on the
        // first load. Redirecting on isFullyVerified alone loops against the
        // app shells, which reject VERIFICATION-kind sessions.
        if (result.isFullyVerified && result.sessionKind === 'ACTIVE') {
          const dest =
            nextFromQuery ?? result.nextUrl ?? buildDefaultNextUrl(result.role)
          router.replace(dest)
        }
      } catch (e) {
        if (cancelled) return
        console.error(e)
        setError({
          at: 'submit',
          message:
            e instanceof Error
              ? e.message
              : 'Could not load verification status.',
        })
        setStatus((prev) => ({ ...prev, loaded: true }))
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [router, nextFromQuery])

  useEffect(() => {
    if (!status.loaded) return
    if (nextFromQuery) return
    if (status.nextUrl) return
    if (recoveredNextUrl) return

    let cancelled = false

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch('/api/v1/auth/session/next-url', {
            method: 'GET',
            cache: 'no-store',
            credentials: 'include',
          })

          const data = await safeJsonRecord(res)
          if (!res.ok || cancelled) return

          const nextUrl = sanitizeNextUrl(readStringField(data, 'nextUrl'))
          if (nextUrl) {
            setRecoveredNextUrl(nextUrl)
          }
        } catch {
          // best-effort recovery only; do not surface a new error banner here
        }
      })()
    }, NEXT_URL_RECOVERY_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [status.loaded, status.nextUrl, nextFromQuery, recoveredNextUrl])

  async function resendPhone() {
    if (
      sendingPhone ||
      status.isPhoneVerified ||
      phoneCooldownSeconds > 0 ||
      correctingPhone
    ) {
      return
    }

    setError(null)
    setInfo(null)
    setSendingPhone(true)

    try {
      const res = await fetch('/api/v1/auth/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const retryAfterSeconds = readRetryAfterSeconds(data)
        if (retryAfterSeconds != null && retryAfterSeconds > 0) {
          setPhoneCooldownSeconds(retryAfterSeconds)
          setError({
            at: 'phone',
            message: `You already requested a ${brand.displayName} verification code. Wait ${formatCooldown(
              retryAfterSeconds,
            )} and try again.`,
          })
          return
        }

        setError({
          at: 'phone',
          message: readErrorMessage(data) ?? 'Could not resend code.',
        })
        return
      }

      await refreshStatus()
      setPhoneCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setInfo({
        at: 'phone',
        message: `We sent a new ${brand.displayName} verification code.`,
      })
    } catch (e) {
      console.error(e)
      setError({ at: 'phone', message: 'Network error.' })
    } finally {
      setSendingPhone(false)
    }
  }

  async function resendEmail() {
    if (sendingEmail || status.isEmailVerified || emailCooldownSeconds > 0) {
      return
    }

    setError(null)
    setInfo(null)
    setSendingEmail(true)

    try {
      const res = await fetch('/api/v1/auth/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          next: resolvedNextUrl,
          intent,
          inviteToken,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const retryAfterSeconds = readRetryAfterSeconds(data)
        if (retryAfterSeconds != null && retryAfterSeconds > 0) {
          setEmailCooldownSeconds(retryAfterSeconds)
          setError({
            at: 'email',
            message: `You already requested a ${brand.displayName} verification email. Wait ${formatCooldown(
              retryAfterSeconds,
            )} and try again.`,
          })
          return
        }

        setError({
          at: 'email',
          message:
            readErrorMessage(data) ?? 'Could not resend verification email.',
        })
        return
      }

      await refreshStatus()
      setEmailCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setInfo({
        at: 'email',
        message: `${brand.displayName} sent a new verification email. Check your inbox and spam.`,
      })
    } catch (e) {
      console.error(e)
      setError({ at: 'email', message: 'Network error.' })
    } finally {
      setSendingEmail(false)
    }
  }

  async function submitPhoneCorrection() {
    if (
      correctingPhone ||
      sendingPhone ||
      status.isPhoneVerified ||
      phoneCooldownSeconds > 0
    ) {
      return
    }

    setError(null)
    setInfo(null)
    setCorrectingPhone(true)

    try {
      const res = await fetch('/api/v1/auth/phone/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          phone: correctPhone.trim(),
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const retryAfterSeconds = readRetryAfterSeconds(data)
        if (retryAfterSeconds != null && retryAfterSeconds > 0) {
          setPhoneCooldownSeconds(retryAfterSeconds)
          setError({
            at: 'phone-correct',
            message: `You already requested a ${brand.displayName} verification code. Wait ${formatCooldown(
              retryAfterSeconds,
            )} and try again.`,
          })
          return
        }

        setError({
          at: 'phone-correct',
          message: readErrorMessage(data) ?? 'Could not update phone number.',
        })
        return
      }

      setCode('')
      setCorrectPhone('')
      setShowPhoneCorrection(false)
      await refreshStatus()
      setPhoneCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      // 'phone', not 'phone-correct': success collapses the correction card,
      // so the notice lands in the phone block the user is looking at.
      setInfo({
        at: 'phone',
        message: `We updated your ${brand.displayName} phone number and sent a fresh code.`,
      })
    } catch (e) {
      console.error(e)
      setError({ at: 'phone-correct', message: 'Network error.' })
    } finally {
      setCorrectingPhone(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading || status.isPhoneVerified) return

    setError(null)
    setInfo(null)

    const trimmed = code.replace(/[^\d]/g, '')
    if (!/^\d{6}$/.test(trimmed)) {
      setError({ at: 'submit', message: 'Enter the 6-digit code.' })
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: trimmed }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError({
          at: 'submit',
          message: readErrorMessage(data) ?? 'Verification failed.',
        })
        return
      }

      const refreshed = await refreshStatus()
      router.refresh()

      if (refreshed.isFullyVerified && refreshed.sessionKind === 'ACTIVE') {
        const dest =
          nextFromQuery ??
          recoveredNextUrl ??
          refreshed.nextUrl ??
          buildDefaultNextUrl(refreshed.role)
        router.replace(dest)
        return
      }

      setInfo({
        at: 'submit',
        message:
          'Phone verified. Email verification is still required before full app access.',
      })
    } catch (e) {
      console.error(e)
      setError({ at: 'submit', message: 'Network error.' })
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
              {status.isFullyVerified
                ? 'Fully verified'
                : 'Verification incomplete'}
            </span>
          </div>

          {maskedPhone ? (
            <div className="mt-3 text-xs text-textSecondary/80">
              Texts go to{' '}
              <span className="font-black text-textPrimary">{maskedPhone}</span>
            </div>
          ) : null}

          {status.email ? (
            <div className="mt-1 text-xs text-textSecondary/80">
              Verification email destination:{' '}
              <span className="font-black text-textPrimary">{status.email}</span>
            </div>
          ) : null}
        </div>

        {smsRetryRequested && !status.isPhoneVerified ? (
          <AuthNotice tone="warn">
            {brand.displayName} could not send your first verification text. Resend a code or
            fix your phone number below.
          </AuthNotice>
        ) : null}

        {emailRetryRequested && !status.isEmailVerified ? (
          <AuthNotice tone="warn">
            {brand.displayName} could not send your first verification email. Resend it, then
            check your inbox and spam.
          </AuthNotice>
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
              disabled={loading || sendingPhone || correctingPhone}
            />

            {/* Resend-row outcomes render directly above the buttons that
                produced them, not at the bottom of the page. */}
            {info?.at === 'phone' ? (
              <AuthNotice tone="accent">{info.message}</AuthNotice>
            ) : null}
            {error?.at === 'phone' ? (
              <AuthNotice tone="danger">{error.message}</AuthNotice>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-textSecondary/80">
                Didn’t get the text?
              </span>

              <div className="flex items-center gap-2">
                <TinyButton
                  onClick={() => {
                    setError(null)
                    setInfo(null)
                    setShowPhoneCorrection((prev) => !prev)
                  }}
                  disabled={
                    sendingPhone ||
                    loading ||
                    correctingPhone ||
                    status.isPhoneVerified
                  }
                >
                  {showPhoneCorrection ? 'Cancel' : 'Wrong number?'}
                </TinyButton>

                <TinyButton
                  onClick={resendPhone}
                  disabled={
                    sendingPhone ||
                    loading ||
                    correctingPhone ||
                    status.isPhoneVerified ||
                    phoneCooldownSeconds > 0
                  }
                >
                  {sendingPhone
                    ? 'Sending…'
                    : phoneCooldownSeconds > 0
                      ? `Resend code in ${formatCooldown(phoneCooldownSeconds)}`
                      : 'Resend code'}
                </TinyButton>
              </div>
            </div>

            {showPhoneCorrection ? (
              <div className="mt-2 grid gap-2 rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-3">
                <div className="text-xs font-black tracking-wide text-textSecondary">
                  Update phone number
                </div>

                <Input
                  value={correctPhone}
                  onChange={(e) => setCorrectPhone(e.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 555 123 4567"
                  disabled={correctingPhone || sendingPhone}
                />

                {error?.at === 'phone-correct' ? (
                  <AuthNotice tone="danger">{error.message}</AuthNotice>
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <TinyButton
                    onClick={() => {
                      setError(null)
                      setInfo(null)
                      setCorrectPhone('')
                      setShowPhoneCorrection(false)
                    }}
                    disabled={correctingPhone}
                  >
                    Cancel
                  </TinyButton>

                  <TinyButton
                    onClick={submitPhoneCorrection}
                    disabled={
                      correctingPhone ||
                      sendingPhone ||
                      phoneCooldownSeconds > 0 ||
                      !correctPhone.trim()
                    }
                  >
                    {correctingPhone
                      ? 'Updating…'
                      : 'Update number and resend'}
                  </TinyButton>
                </div>
              </div>
            ) : null}
          </label>
        ) : (
          <AuthNotice tone="accent">Your phone is verified.</AuthNotice>
        )}

        {!status.isEmailVerified ? (
          <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
            <div className="font-black text-textPrimary">Verify your email</div>
            <div className="mt-1 text-xs text-textSecondary/80">
              Click the verification link we emailed you. You can resend it here
              if needed.
            </div>

            {info?.at === 'email' ? (
              <AuthNotice tone="accent" className="mt-3">
                {info.message}
              </AuthNotice>
            ) : null}
            {error?.at === 'email' ? (
              <AuthNotice tone="danger" className="mt-3">
                {error.message}
              </AuthNotice>
            ) : null}

            <div className="mt-3">
              <TinyButton
                onClick={resendEmail}
                disabled={
                  sendingEmail ||
                  status.isEmailVerified ||
                  emailCooldownSeconds > 0
                }
              >
                {sendingEmail
                  ? 'Sending…'
                  : emailCooldownSeconds > 0
                    ? `Resend email in ${formatCooldown(emailCooldownSeconds)}`
                    : 'Resend verification email'}
              </TinyButton>
            </div>
          </div>
        ) : (
          <AuthNotice tone="accent">Your email is verified.</AuthNotice>
        )}

        {info?.at === 'submit' ? (
          <AuthNotice tone="accent">{info.message}</AuthNotice>
        ) : null}

        {error?.at === 'submit' ? (
          <AuthNotice tone="danger">{error.message}</AuthNotice>
        ) : null}

        {!status.isPhoneVerified ? (
          <PrimaryButton
            withArrow
            loading={loading}
            disabled={loading || sendingPhone || correctingPhone}
          >
            {loading ? 'Verifying…' : 'Verify phone'}
          </PrimaryButton>
        ) : status.isFullyVerified ? (
          <Link href={resolvedNextUrl} className={primaryButtonClassName()}>
            Continue
          </Link>
        ) : null}

        <div className="text-center text-xs text-textSecondary/80">
          <Link
            href={loginHref}
            className="font-black text-textPrimary hover:text-accentPrimary"
          >
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}