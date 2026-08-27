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
import {
  compactPhoneInputForSubmit,
  formatPhoneInputValue,
  isLikelyValidPhoneInput,
} from '@/lib/phoneInputFormat'

type Step = 'phone' | 'code'

/**
 * Which control a notice belongs to, so it renders directly above the button
 * that was pressed: the primary submit ('form') or the inline resend link
 * ('resend').
 */
type NoticeAt = 'form' | 'resend'

type Notice = { at: NoticeAt; message: string }

type PhoneLoginFormProps = {
  /** Sanitized `next`/`from` fallbacks, so post-auth routing matches password login. */
  nextSafe: string | null
  fromSafe: string | null
  /** Optional prefill from a `?phone=` query param. */
  initialPhone?: string
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
 * Passwordless "sign in with a code" flow. The backend already exists:
 * `POST /api/v1/auth/phone-login/send` mails a Twilio Verify code to a number
 * that belongs to an account (enumeration-safe), and
 * `POST /api/v1/auth/phone-login/verify` mints the SAME session cookie as email
 * login and returns an AuthLoginResponseDTO — so we route the success through
 * the shared `resolvePostAuthNavigation`, identical to LoginClient's password
 * path (honoring `next`/`from` and the verification gate).
 */
export default function PhoneLoginForm({
  nextSafe,
  fromSafe,
  initialPhone,
  onUsePassword,
}: PhoneLoginFormProps) {
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState(() =>
    formatPhoneInputValue(initialPhone ?? ''),
  )
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

  async function sendCode(kind: 'initial' | 'resend') {
    if (sending) return
    if (kind === 'resend' && cooldownSeconds > 0) return

    const at: NoticeAt = kind === 'resend' ? 'resend' : 'form'

    const compact = compactPhoneInputForSubmit(phone)
    if (!compact) {
      setError({ at, message: 'Enter your phone number.' })
      return
    }
    if (!isLikelyValidPhoneInput(phone)) {
      setError({ at, message: 'Enter a valid phone number.' })
      return
    }

    setError(null)
    setInfo(null)
    setSending(true)

    try {
      const res = await fetch('/api/v1/auth/phone-login/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ phone: compact }),
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
          message: readErrorMessage(data) ?? 'Could not send a code.',
        })
        return
      }

      // Response is intentionally generic (enumeration-safe): advance to the
      // code step regardless of whether an account exists for that number.
      setStep('code')
      setCode('')
      setCooldownSeconds(RESEND_COOLDOWN_SECONDS)
      setInfo({
        at,
        message:
          'If an account exists for that number, we sent a verification code.',
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
      const res = await fetch('/api/v1/auth/phone-login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          phone: compactPhoneInputForSubmit(phone),
          code: trimmedCode,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError({
          at: 'form',
          message: readErrorMessage(data) ?? 'Incorrect or expired code.',
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
    if (step === 'phone') {
      void sendCode('initial')
    } else {
      void verifyCode()
    }
  }

  function changeNumber() {
    setStep('phone')
    setCode('')
    setError(null)
    setInfo(null)
    setCooldownSeconds(0)
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-1 grid gap-4">
      {step === 'phone' ? (
        <label className="grid gap-1.5">
          <FieldLabel>Phone number</FieldLabel>
          <Input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInputValue(e.target.value))}
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            placeholder="(555) 123-4567"
            disabled={sending}
          />
        </label>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Verification code</FieldLabel>
            <TextButton onClick={changeNumber} disabled={sending || verifying}>
              Change number
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

          {/* Resend outcomes render directly above the resend control. */}
          {info?.at === 'resend' ? (
            <AuthNotice tone="accent">{info.message}</AuthNotice>
          ) : null}
          {error?.at === 'resend' ? (
            <AuthNotice tone="danger">{error.message}</AuthNotice>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-textSecondary/80">
              Sent to <span className="font-black text-textPrimary">{phone.trim()}</span>
            </span>
            <TextButton
              onClick={() => void sendCode('resend')}
              disabled={sending || verifying || cooldownSeconds > 0}
            >
              {sending
                ? 'Sending…'
                : cooldownSeconds > 0
                  ? `Resend in ${formatCooldown(cooldownSeconds)}`
                  : 'Resend code'}
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
        {step === 'phone' ? (
          <PrimaryButton loading={sending} withArrow>
            {sending ? 'Sending…' : 'Send code'}
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
