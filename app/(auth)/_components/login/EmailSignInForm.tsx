'use client'

import { useEffect, useState, type FormEvent } from 'react'

import AuthNotice from '../AuthNotice'
import FieldLabel from '../FieldLabel'
import Input from '../Input'
import PrimaryButton from '../PrimaryButton'
import {
  RESEND_COOLDOWN_SECONDS,
  formatCooldown,
  readRetryAfterSeconds,
} from '../otpCooldown'
import { resolvePostAuthNavigation } from '../postAuthRedirect'
import { cn } from '@/lib/utils'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'

type Step = 'email' | 'code'

/**
 * Which control a notice belongs to, so it renders directly above the button
 * that was pressed: the primary submit ('form') or the inline resend link
 * ('resend').
 */
type NoticeAt = 'form' | 'resend'

type Notice = { at: NoticeAt; message: string }

type EmailSignInFormProps = {
  /** Sanitized `next`/`from` fallbacks, so post-auth routing matches password login. */
  nextSafe: string | null
  fromSafe: string | null
  /** Optional prefill from a `?email=` query param or the password form. */
  initialEmail?: string
  /** Switch the login surface back to the email + password form. */
  onUsePassword: () => void
}

/** Small link-styled button for the secondary affordances (resend / switch mode). */
function TextButton({
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
        'text-[11px] font-black text-textSecondary/80 transition hover:text-textPrimary',
        'focus:outline-none focus-visible:underline',
        disabled && 'cursor-not-allowed opacity-60 hover:text-textSecondary/80',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Passwordless "email me a link" flow (item 58).
 *
 * `POST /api/v1/auth/email-sign-in/request` sends ONE email carrying both a
 * magic link and a 6-digit code, and answers `{ ok: true }` whether or not the
 * address has an account — so this form advances to the code step regardless,
 * and its copy is careful to say "if an account exists". Anything that branched
 * the UI on account existence would undo the route's enumeration safety from
 * the client side.
 *
 * The code step exists for the case the link cannot serve: opening it from an
 * in-app browser (Instagram/TikTok) mints the session in a webview cookie jar
 * that vanishes when they leave the app. Typing six digits signs them in where
 * they already are.
 *
 * `POST /api/v1/auth/email-sign-in/verify` returns an AuthLoginResponseDTO, so
 * success routes through the shared `resolvePostAuthNavigation` — identical to
 * LoginClient's password path, honoring `next`/`from` and the verification gate.
 */
export default function EmailSignInForm({
  nextSafe,
  fromSafe,
  initialEmail,
  onUsePassword,
}: EmailSignInFormProps) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState<Notice | null>(null)
  const [info, setInfo] = useState<Notice | null>(null)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const id = window.setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(id)
  }, [cooldownSeconds])

  async function sendLink(kind: 'initial' | 'resend') {
    if (sending) return
    if (kind === 'resend' && cooldownSeconds > 0) return

    const at: NoticeAt = kind === 'resend' ? 'resend' : 'form'

    const trimmed = email.trim()
    if (!trimmed) {
      setError({ at, message: 'Enter your email address.' })
      return
    }

    setError(null)
    setInfo(null)
    setSending(true)

    try {
      const res = await fetch('/api/v1/auth/email-sign-in/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ email: trimmed }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const retryAfterSeconds = readRetryAfterSeconds(data)
        if (retryAfterSeconds != null && retryAfterSeconds > 0) {
          setCooldownSeconds(retryAfterSeconds)
          setError({
            at,
            message: `Too many requests. Wait ${formatCooldown(retryAfterSeconds)} and try again.`,
          })
          return
        }
        setError({
          at,
          message: readErrorMessage(data) ?? 'Could not send a sign-in email.',
        })
        return
      }

      // Response is intentionally generic (enumeration-safe): advance to the
      // code step regardless of whether an account exists for that address.
      setStep('code')
      setCode('')
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setInfo({
        at,
        message:
          'If an account exists for that address, we sent a sign-in link and a code.',
      })
    } catch (err) {
      console.error(err)
      setError({ at, message: 'Network error.' })
    } finally {
      setSending(false)
    }
  }

  async function verifyCode() {
    if (verifying) return

    const trimmedCode = code.replace(/[^\d]/g, '')
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError({ at: 'form', message: 'Enter the 6-digit code.' })
      return
    }

    setError(null)
    setInfo(null)
    setVerifying(true)

    try {
      const res = await fetch('/api/v1/auth/email-sign-in/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ email: email.trim(), code: trimmedCode }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError({
          at: 'form',
          message:
            readErrorMessage(data) ?? 'That link or code is invalid or expired.',
        })
        return
      }

      const nav = resolvePostAuthNavigation(data, { nextSafe, fromSafe })
      if (nav.kind === 'missing-role') {
        setError({
          at: 'form',
          message:
            'Sign in succeeded, but your account role is missing. Please contact support.',
        })
        return
      }
      if (nav.kind === 'error') {
        setError({ at: 'form', message: nav.message })
        return
      }

      window.location.assign(nav.url)
    } catch (err) {
      console.error(err)
      setError({ at: 'form', message: 'Network error.' })
    } finally {
      setVerifying(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (step === 'email') {
      void sendLink('initial')
    } else {
      void verifyCode()
    }
  }

  function changeEmail() {
    setStep('email')
    setCode('')
    setError(null)
    setInfo(null)
    setCooldownSeconds(0)
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-1 grid gap-4">
      {step === 'email' ? (
        <label className="grid gap-1.5">
          <FieldLabel>Email</FieldLabel>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            disabled={sending}
          />
        </label>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Code from the email</FieldLabel>
            <TextButton onClick={changeEmail} disabled={sending || verifying}>
              Change email
            </TextButton>
          </div>

          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            required
            disabled={verifying}
          />

          <div className="text-xs text-textSecondary/80">
            Tap the link in the email, or enter the code here if the link opens
            in an app instead of your browser.
          </div>

          {/* Resend outcomes render directly above the resend control. */}
          {info?.at === 'resend' ? (
            <AuthNotice tone="accent">{info.message}</AuthNotice>
          ) : null}
          {error?.at === 'resend' ? (
            <AuthNotice tone="danger">{error.message}</AuthNotice>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-textSecondary/80">
              Sent to{' '}
              <span className="font-black text-textPrimary">{email.trim()}</span>
            </span>
            <TextButton
              onClick={() => void sendLink('resend')}
              disabled={sending || verifying || cooldownSeconds > 0}
            >
              {sending
                ? 'Sending…'
                : cooldownSeconds > 0
                  ? `Resend in ${formatCooldown(cooldownSeconds)}`
                  : 'Resend email'}
            </TextButton>
          </div>
        </div>
      )}

      {info?.at === 'form' ? (
        <AuthNotice tone="accent">{info.message}</AuthNotice>
      ) : null}

      {error?.at === 'form' ? (
        <AuthNotice tone="danger">{error.message}</AuthNotice>
      ) : null}

      <div className="grid gap-2 pt-1">
        {step === 'email' ? (
          <PrimaryButton loading={sending} withArrow>
            {sending ? 'Sending…' : 'Email me a link'}
          </PrimaryButton>
        ) : (
          <PrimaryButton loading={verifying} withArrow>
            {verifying ? 'Signing in…' : 'Sign in'}
          </PrimaryButton>
        )}

        <div className="flex justify-center pt-1">
          <TextButton onClick={onUsePassword} disabled={sending || verifying}>
            Use your password instead
          </TextButton>
        </div>
      </div>
    </form>
  )
}
