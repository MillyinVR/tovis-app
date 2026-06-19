'use client'

import { useState } from 'react'

import { isRecord } from '@/lib/guards'

type InviteContext = 'consultation' | 'aftercare'

type Props = {
  /** The ClientActionToken from the page URL (consultation or aftercare). */
  actionToken: string
  context: InviteContext
}

const COPY: Record<
  InviteContext,
  { headline: string; body: string }
> = {
  consultation: {
    headline: 'Want to keep this in one place?',
    body: 'Your consultation summary is saved to this secure link. If you’d like to keep track of your summaries and book other services down the road, you can create a free account — we’ll carry everything over.',
  },
  aftercare: {
    headline: 'Want to keep your summaries?',
    body: 'Everything from this visit lives on this secure link. If you’d like to keep your aftercare and before/after photos in one place and book other services, you can create a free account — we’ll carry it all over.',
  },
}

export function CreateAccountInviteCard({ actionToken, context }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  const copy = COPY[context]
  const headline = copy.headline

  async function handleCreate() {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/public/account-invite/${encodeURIComponent(actionToken)}`,
        { method: 'POST' },
      )

      const payload: unknown = await response.json().catch(() => null)
      const claimUrl =
        isRecord(payload) && typeof payload.claimUrl === 'string'
          ? payload.claimUrl
          : null

      if (response.ok && claimUrl) {
        window.location.href = claimUrl
        return
      }

      if (
        response.ok &&
        isRecord(payload) &&
        payload.alreadyClaimed === true
      ) {
        setError(
          'This profile already has an account. Try logging in instead.',
        )
        setBusy(false)
        return
      }

      const message =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : 'We couldn’t start account setup just now. Please try again.'
      setError(message)
      setBusy(false)
    } catch {
      setError('We couldn’t start account setup just now. Please try again.')
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card border border-accentPrimary/25 bg-accentPrimary/5 p-5">
      <div className="text-[14px] font-black text-textPrimary">{headline}</div>
      <div className="mt-1.5 text-sm text-textSecondary">{copy.body}</div>

      {error ? (
        <div className="mt-3 rounded-card border border-toneDanger/20 bg-toneDanger/5 px-3 py-2 text-xs font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-5 py-2.5 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Setting up…' : 'Create your account'}
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2.5 text-sm font-black text-textSecondary transition hover:text-textPrimary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Maybe later
        </button>
      </div>
    </section>
  )
}
