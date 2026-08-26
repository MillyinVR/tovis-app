'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import AuthNotice from '../AuthNotice'
import AuthShell from '../AuthShell'
import SecondaryLinkButton from '../SecondaryLinkButton'
import { HeroTopHairline, primaryButtonClassName } from '../PrimaryButton'
import {
  resolvePostAuthNavigation,
  sanitizeInternalPath,
  sanitizeRedirectTarget,
} from '../postAuthRedirect'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'

/**
 * The magic link's landing page.
 *
 * 🔴 THE WHOLE REASON THIS PAGE EXISTS is that it does NOT sign anyone in on
 * load. There is deliberately no `useEffect` here that POSTs the token.
 *
 * Mail scanners, corporate link-rewriters (Outlook Safe Links, Proofpoint,
 * Mimecast) and chat link-preview bots all FETCH urls found in email, often
 * within seconds of delivery and before the human has looked at their inbox. A
 * single-use token consumed on page load is therefore burned by a robot, and
 * the person who actually clicks is told their link is invalid — a bug that
 * looks like flaky email and is miserable to diagnose.
 *
 * An explicit button press cannot be produced by a scanner. `/verify-email`
 * already sets this precedent in this codebase, for the same reason.
 *
 * The rendered page is inert: a GET here reads nothing, writes nothing and
 * consumes nothing.
 */
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
  const isDisabled = Boolean(disabled || loading)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={primaryButtonClassName({
        disabled: isDisabled,
        withArrow: true,
      })}
    >
      <HeroTopHairline />
      <span className="relative">{children}</span>
    </button>
  )
}

export default function EmailSignInLandingClient({
  token,
}: {
  token: string
}) {
  const searchParams = useSearchParams()

  const fromRaw = searchParams.get('from')
  const nextRaw = searchParams.get('next')

  const fromSafe = useMemo(
    () => sanitizeRedirectTarget(sanitizeInternalPath(fromRaw)),
    [fromRaw],
  )
  const nextSafe = useMemo(
    () => sanitizeRedirectTarget(sanitizeInternalPath(nextRaw)),
    [nextRaw],
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasToken = token.trim().length > 0

  async function handleSignIn() {
    if (submitting) return

    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/v1/auth/email-sign-in/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({ token }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError(
          readErrorMessage(data) ??
            'This sign-in link is invalid or has expired.',
        )
        return
      }

      const nav = resolvePostAuthNavigation(data, { nextSafe, fromSafe })
      if (nav.kind === 'missing-role') {
        setError(
          'Sign in succeeded, but your account role is missing. Please contact support.',
        )
        return
      }
      if (nav.kind === 'error') {
        setError(nav.message)
        return
      }

      window.location.assign(nav.url)
    } catch (err) {
      console.error(err)
      setError('Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="One tap and you’re back in. No password required."
    >
      <div className="grid gap-4">
        <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
          For your security, this link is only used once you confirm it here —
          and it works only once.
        </div>

        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}

        <div className="grid gap-2 pt-1">
          {hasToken ? (
            <PrimaryActionButton
              loading={submitting}
              onClick={() => void handleSignIn()}
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign me in'}
            </PrimaryActionButton>
          ) : null}

          <SecondaryLinkButton href="/login">
            Back to login
          </SecondaryLinkButton>
        </div>
      </div>
    </AuthShell>
  )
}
