// app/(auth)/verify-phone/page.tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '../_components/AuthShell'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
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
      className={cx(
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
      className={cx(
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

export default function VerifyPhonePage() {
  const router = useRouter()
  const sp = useSearchParams()

  const nextUrl = useMemo(() => sanitizeNextUrl(sp.get('next')), [sp])

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  async function resend() {
    if (sending) return
    setError(null)
    setInfo(null)
    setSending(true)

    try {
      const res = await fetch('/api/auth/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await safeJson(res)

      if (!res.ok) {
        const retry =
          data?.retryAfterSeconds ? ` Try again in ~${Math.ceil(Number(data.retryAfterSeconds) / 60)} min.` : ''
        setError((data?.error || 'Could not resend code.') + retry)
        return
      }

      setInfo('New code sent.')
    } catch (e) {
      console.error(e)
      setError('Network error.')
    } finally {
      setSending(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

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
      const data = await safeJson(res)

      if (!res.ok) {
        setError(data?.error || 'Verification failed.')
        return
      }

      router.refresh()
      router.replace(nextUrl ?? '/looks') // ✅ fix: /client/looks was 404 in prod
    } catch (e) {
      console.error(e)
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Verify your phone" subtitle="Enter the 6-digit code we sent. This keeps bookings and reminders reliable.">
      <form onSubmit={onSubmit} className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-xs font-black tracking-wide text-textSecondary">Verification code</span>

          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
          />

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-textSecondary/80">Didn’t get it?</span>
            <TinyButton onClick={resend} disabled={sending || loading}>
              {sending ? 'Sending…' : 'Resend code'}
            </TinyButton>
          </div>
        </label>

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

        <PrimaryButton loading={loading} disabled={loading || sending}>
          {loading ? 'Verifying…' : 'Verify phone'}
        </PrimaryButton>

        <div className="text-center text-xs text-textSecondary/80">
          <Link href="/login" className="font-black text-textPrimary hover:text-accentPrimary">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
