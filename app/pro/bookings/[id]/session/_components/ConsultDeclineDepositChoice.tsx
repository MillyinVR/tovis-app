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
//
// 🔴 THE RECORD IS THE MONEY, NOT THE BUTTON. This component used to set its
// settled state to the choice the pro pressed and print the booking's up-front
// charge next to it — so a refund that moved nothing (already returned, or
// frozen under a dispute) still read "Recorded: you refunded her deposit of
// $X", on the click AND on every reload afterwards. Both paths now render from
// cents that actually moved: the POST's `settlement`/`refundedCents` on the
// click, and the booking's own `depositRefundedCents` on the reload.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { COPY } from '@/lib/copy'
import {
  describeDeclineDepositSettlement,
  settlementFromRecord,
  type ConsultDeclineDepositChoice as Choice,
  type ConsultDeclineDepositSettlement as Settlement,
} from '@/lib/consult/declineDepositSettlement'
import { errorFromResponse, safeJson } from '@/lib/http'
import { formatCents } from '@/lib/money'

type Settled = { settlement: Settlement; refundedCents: number }

/** The POST's answer, narrowed off the wire rather than trusted. */
function readSettled(data: unknown, choice: Choice): Settled {
  const body = typeof data === 'object' && data !== null ? data : {}
  const record = body as Record<string, unknown>
  const refundedCents =
    typeof record.refundedCents === 'number' && Number.isFinite(record.refundedCents)
      ? record.refundedCents
      : 0
  const settlement = record.settlement

  if (settlement === 'KEPT' || settlement === 'REFUNDED' || settlement === 'NOT_MOVED') {
    return { settlement, refundedCents }
  }

  // An older/unknown body shape: fall back to what the money says, which is the
  // same rule the reload path uses. Never assume the refund worked.
  return { settlement: settlementFromRecord({ choice, refundedCents }), refundedCents }
}

const STATUS_COPY = {
  401: 'Please log in again.',
  403: 'You don’t have access to do that.',
  409: 'This deposit decision is no longer open.',
}

export default function ConsultDeclineDepositChoice({
  bookingId,
  depositChargeCents,
  decidedChoice,
  refundedCents,
  disabled = false,
}: {
  bookingId: string
  depositChargeCents: number
  decidedChoice: Choice | null
  /** Cents actually back with the client — the booking's depositRefundedCents. */
  refundedCents: number
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<Choice | null>(null)
  const [settled, setSettled] = useState<Settled | null>(
    decidedChoice
      ? {
          settlement: settlementFromRecord({ choice: decidedChoice, refundedCents }),
          refundedCents,
        }
      : null,
  )
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

      setSettled(readSettled(data, choice))
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
          ? describeDeclineDepositSettlement({
              settlement: settled.settlement,
              refundedCents: settled.refundedCents,
              chargeCents: depositChargeCents,
            })
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
