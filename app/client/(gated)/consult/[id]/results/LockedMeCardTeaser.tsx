'use client'

import { useState } from 'react'

import type { BrandClientConsultResultsCopy } from '@/lib/brand/types'

export default function LockedMeCardTeaser({
  consultId,
  copy,
  initiallyTapped,
}: {
  consultId: string
  copy: BrandClientConsultResultsCopy
  initiallyTapped: boolean
}) {
  const [tapped, setTapped] = useState(initiallyTapped)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function recordTap() {
    if (tapped || sending) return
    setSending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/client/consult/${encodeURIComponent(consultId)}/results/teaser-tap`,
        { method: 'POST' },
      )
      if (!response.ok) throw new Error('teaser tap failed')
      setTapped(true)
    } catch {
      setError(copy.meCardError)
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      aria-labelledby={`${consultId}-me-card`}
      className="rounded-2xl border border-surfaceGlass/10 bg-surfaceGlass/5 p-5"
      data-me-card-state="locked"
    >
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-textMuted">
        {copy.meCardEyebrow}
      </div>
      <h2
        id={`${consultId}-me-card`}
        className="mt-2 font-display text-xl font-black text-textPrimary"
      >
        {copy.meCardTitle}
      </h2>
      <p className="mt-2 text-sm leading-6 text-textSecondary">
        {copy.meCardBody}
      </p>
      <button
        type="button"
        onClick={recordTap}
        disabled={tapped || sending}
        aria-disabled={tapped || sending}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-surfaceGlass/15 bg-surfaceGlass/10 px-5 text-sm font-black text-textPrimary disabled:cursor-default disabled:opacity-70"
      >
        {tapped
          ? copy.meCardTappedLabel
          : sending
            ? copy.meCardSendingLabel
            : copy.meCardTapLabel}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-toneDanger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
