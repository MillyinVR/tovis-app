'use client'

// Entry point for the booking-attached AI consult (2026-08-26 full-analysis
// launch). Rendered only when the server already verified eligibility, so the
// only work here is creating/continuing the session and navigating.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AiConsultCard({
  bookingId,
  consultId,
  consultStatus,
}: {
  bookingId: string
  consultId: string | null
  consultStatus: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const completed = consultStatus === 'COMPLETED'

  const open = async () => {
    setError(null)
    if (consultId) {
      router.push(
        completed
          ? `/client/consult/${encodeURIComponent(consultId)}/results`
          : `/client/consult/${encodeURIComponent(consultId)}`,
      )
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/v1/client/consult', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId }),
        cache: 'no-store',
      })
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean
        consult?: { id: string }
        error?: string
      } | null
      if (!response.ok || !body?.consult?.id) {
        setError(body?.error ?? 'The consult could not be started. Try again.')
        return
      }
      router.push(`/client/consult/${encodeURIComponent(body.consult.id)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-microAccent">
        Beauty consult
      </div>
      <h3 className="mt-1 text-[15px] font-black text-textPrimary">
        See what will flatter you most
      </h3>
      <p className="mt-1 text-[12.5px] leading-5 text-textSecondary">
        Before your appointment, a photo-based analysis of your features — hair
        color, cut, bangs, brows, lashes, makeup, and your color palette — so
        the plan enhances what is already yours.
      </p>
      {error ? (
        <p className="mt-2 rounded-lg border border-toneDanger/30 bg-toneDanger/10 px-2 py-1.5 text-[12px] text-textPrimary">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void open()}
        className="mt-3 rounded-xl bg-textPrimary px-4 py-2 text-[13px] font-black text-bgPrimary disabled:opacity-50"
      >
        {completed
          ? 'See your results'
          : consultId
            ? 'Continue your consult'
            : busy
              ? 'Starting…'
              : 'Start your consult'}
      </button>
    </section>
  )
}
