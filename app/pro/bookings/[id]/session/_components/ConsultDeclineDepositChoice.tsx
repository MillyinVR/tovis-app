'use client'

// app/pro/bookings/[id]/session/_components/ConsultDeclineDepositChoice.tsx
//
// Book the Look, B6 — "your client said no. What about her deposit?"
//
// Tori, 2026-08-31: the pro decides each time, in the moment, and the choice is
// recorded with who made it and which way it went. So this is two buttons and
// no default — a preselected answer about somebody else's money is not a
// decision, and a screen that quietly kept the deposit because nobody pressed
// anything is exactly what "recorded on the outcome" exists to prevent.
//
// Once answered it stops being a question and becomes the record, in place.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { COPY } from '@/lib/copy'
import { errorFromResponse, safeJson } from '@/lib/http'
import { formatCents } from '@/lib/money'

type Choice = 'KEEP' | 'REFUND'

const STATUS_COPY = {
  401: 'Please log in again.',
  403: 'You don’t have access to do that.',
  409: 'This deposit decision is no longer open.',
}

export default function ConsultDeclineDepositChoice({
  bookingId,
  depositChargeCents,
  decidedChoice,
  disabled = false,
}: {
  bookingId: string
  depositChargeCents: number
  decidedChoice: Choice | null
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<Choice | null>(null)
  const [settled, setSettled] = useState<Choice | null>(decidedChoice)
  const [error, setError] = useState<string | null>(null)

  async function choose(choice: Choice) {
    if (disabled || pending || settled) return
    setError(null)
    setPending(choice)

    try {
      const res = await fetch(
        `/api/v1/pro/bookings/${encodeURIComponent(
          bookingId,
        )}/consult-decline-deposit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ choice }),
        },
      )

      const data = await safeJson(res)
      if (!res.ok) {
        throw new Error(errorFromResponse(res, data, { byStatus: STATUS_COPY }))
      }

      setSettled(choice)
      router.refresh()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.')
    } finally {
      setPending(null)
    }
  }

  const amount = formatCents(depositChargeCents)

  return (
    <div className="mt-3">
      <div className="brand-pro-session-section-title">
        {COPY.consultDeclineDeposit.title}
      </div>

      <div className="brand-pro-session-card-body">
        {settled
          ? settled === 'KEEP'
            ? `${COPY.consultDeclineDeposit.keptRecorded} ${amount}.`
            : `${COPY.consultDeclineDeposit.refundedRecorded} ${amount}.`
          : `${COPY.consultDeclineDeposit.body} ${amount}.`}
      </div>

      {settled ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => choose('KEEP')}
            disabled={disabled || pending !== null}
            className={[
              'rounded-full px-4 py-2 text-sm font-black transition',
              disabled || pending
                ? 'cursor-not-allowed border border-textPrimary/10 bg-bgPrimary text-textSecondary'
                : 'border border-textPrimary/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass/10',
            ].join(' ')}
          >
            {pending === 'KEEP'
              ? COPY.consultDeclineDeposit.working
              : COPY.consultDeclineDeposit.keep}
          </button>

          <button
            type="button"
            onClick={() => choose('REFUND')}
            disabled={disabled || pending !== null}
            className={[
              'rounded-full px-4 py-2 text-sm font-black transition',
              disabled || pending
                ? 'cursor-not-allowed border border-textPrimary/10 bg-bgPrimary text-textSecondary'
                : 'border border-toneWarn/40 bg-bgPrimary text-toneWarn hover:bg-toneWarn/10',
            ].join(' ')}
          >
            {pending === 'REFUND'
              ? COPY.consultDeclineDeposit.working
              : COPY.consultDeclineDeposit.refund}
          </button>
        </div>
      )}

      {error ? (
        <div className="mt-3 text-sm font-semibold text-toneDanger">{error}</div>
      ) : null}
    </div>
  )
}
