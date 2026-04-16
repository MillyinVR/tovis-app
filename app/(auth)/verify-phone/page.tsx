'use client'

import Link from 'next/link'
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import AuthShell from '../_components/AuthShell'
import { safeJsonRecord, readErrorMessage, readStringField } from '@/lib/http'
import { cn } from '@/lib/utils'

const RESEND_COOLDOWN_SECONDS = 60

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

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
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
  children: ReactNode
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

function readRetryAfterSeconds(
  data: Record<string, unknown> | null,
): number | null {
  if (!data) return null

  const value = data.retryAfterSeconds
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.ceil(value))
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.ceil(parsed))
    }
  }

  return null
}

function readBooleanField(
  data: Record<string, unknown> | null,
  key: string,
): boolean {
  return data?.[key] === true
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

function formatCooldown(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return phone
  return `*** *** ${digits.slice(-4)}`
}

export default function VerifyPhonePage() {
  const router = useRouter()
  const sp = useSearchParams()

  const nextFromQuery = useMemo(() => sanitizeNextUrl(sp.get('next')), [sp])
  const emailRetryRequested = useMemo(() => sp.get('email') === 'retry', [sp])
  const smsRetryRequested = useMemo(() => sp.get('sms') === 'retry', [sp])
  const intent = useMemo(() => sanitizeOptionalText(sp.get('intent')), [sp])
  const inviteToken = useMemo(
    () => sanitizeOptionalText(sp.get('inviteToken')),
    [sp],
  )

  const [status, setStatus] = useState<VerificationStatus>(EMPTY_STATUS)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sendingPhone, setSendingPhone] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  const [phoneCooldownSeconds, setPhoneCooldownSeconds] = useState(0)
  const [emailCooldownSeconds, setEmailCooldownSeconds] = useState(0)

  const [showPhoneCorrection, setShowPhoneCorrection] = useState(false)
  const [correctPhone, setCorrectPhone] = useState('')
  const [correctingPhone, setCorrectingPhone] = useState(false)

  const resolvedNextUrl = useMemo(() => {
    return nextFromQuery ?? status.nextUrl ?? buildDefaultNextUrl(status.role)
  }, [nextFromQuery, status.nextUrl, status.role])

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

        if (result.isFullyVerified) {
          const dest =
            nextFromQuery ?? result.nextUrl ?? buildDefaultNextUrl(result.role)
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
      const res = await fetch('/api/auth/phone/send', {
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
          setError(
            `You already requested a TOVIS verification code. Wait ${formatCooldown(
              retryAfterSeconds,
            )} and try again.`,
          )
          return
        }

        setError(readErrorMessage(data) ?? 'Could not resend code.')
        return
      }

      await refreshStatus()
      setPhoneCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setInfo('We sent a new TOVIS verification code.')
    } catch (e) {
      console.error(e)
      setError('Network error.')
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
      const res = await fetch('/api/auth/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          next:
            nextFromQuery ?? status.nextUrl ?? buildDefaultNextUrl(status.role),
          intent,
          inviteToken,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const retryAfterSeconds = readRetryAfterSeconds(data)
        if (retryAfterSeconds != null && retryAfterSeconds > 0) {
          setEmailCooldownSeconds(retryAfterSeconds)
          setError(
            `You already requested a TOVIS verification email. Wait ${formatCooldown(
              retryAfterSeconds,
            )} and try again.`,
          )
          return
        }

        setError(
          readErrorMessage(data) ?? 'Could not resend verification email.',
        )
        return
      }

      await refreshStatus()
      setEmailCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setInfo('TOVIS sent a new verification email. Check your inbox and spam.')
    } catch (e) {
      console.error(e)
      setError('Network error.')
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
      const res = await fetch('/api/auth/phone/correct', {
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
          setError(
            `You already requested a TOVIS verification code. Wait ${formatCooldown(
              retryAfterSeconds,
            )} and try again.`,
          )
          return
        }

        setError(readErrorMessage(data) ?? 'Could not update phone number.')
        return
      }

      setCode('')
      setCorrectPhone('')
      setShowPhoneCorrection(false)
      await refreshStatus()
      setPhoneCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setInfo('We updated your TOVIS phone number and sent a fresh code.')
    } catch (e) {
      console.error(e)
      setError('Network error.')
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
      setError('Enter the 6-digit code.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
          <div className="rounded-card border border-toneWarn/25 bg-toneWarn/10 px-3 py-2 text-sm font-bold text-toneWarn">
            TOVIS could not send your first verification text. Resend a code or
            fix your phone number below.
          </div>
        ) : null}

        {emailRetryRequested && !status.isEmailVerified ? (
          <div className="rounded-card border border-toneWarn/25 bg-toneWarn/10 px-3 py-2 text-sm font-bold text-toneWarn">
            TOVIS could not send your first verification email. Resend it, then
            check your inbox and spam.
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
              disabled={loading || sendingPhone || correctingPhone}
            />

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
          <div className="rounded-card border border-accentPrimary/25 bg-accentPrimary/10 px-3 py-2 text-sm font-bold text-textPrimary">
            Your phone is verified.
          </div>
        )}

        {!status.isEmailVerified ? (
          <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
            <div className="font-black text-textPrimary">Verify your email</div>
            <div className="mt-1 text-xs text-textSecondary/80">
              Click the verification link we emailed you. You can resend it here
              if needed.
            </div>
            <div className="mt-3">
              <TinyButton
                onClick={resendEmail}
                disabled={
                  sendingEmail || status.isEmailVerified || emailCooldownSeconds > 0
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
          <PrimaryButton
            loading={loading}
            disabled={loading || sendingPhone || correctingPhone}
          >
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