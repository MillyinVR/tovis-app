// app/client/(gated)/bookings/[id]/ClientDepositCard.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCents, formatMoneyFromUnknown } from '@/lib/money'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

type Props = {
  bookingId: string
  depositStatus: string | null | undefined
  /** Deposit dollars (Decimal serialized to string). */
  depositAmount: string | number | null | undefined
  /** One-time platform fee in CENTS. */
  discoveryFeeCents: number | null | undefined
}

type DepositSessionResponse = {
  stripeCheckout?: { url?: string | null } | null
  error?: string
  message?: string
}

function centsToMoney(cents: number): string {
  return formatCents(cents)
}

export default function ClientDepositCard({
  bookingId,
  depositStatus,
  depositAmount,
  discoveryFeeCents,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const status = (depositStatus ?? 'NONE').toUpperCase()
  if (status !== 'PENDING' && status !== 'PAID') return null

  const depositLabel = formatMoneyFromUnknown(depositAmount)
  const feeCents = discoveryFeeCents ?? 0
  const feeLabel = feeCents > 0 ? centsToMoney(feeCents) : null

  async function startDepositCheckout() {
    setError(null)

    const idempotencyKey = buildClientIdempotencyKey({
      scope: 'client-deposit-stripe-session',
      entityId: bookingId,
      action: 'create-deposit-session',
    })

    try {
      const res = await fetch(
        `/api/v1/client/bookings/${encodeURIComponent(bookingId)}/deposit/stripe-session`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
          body: JSON.stringify({}),
        },
      )

      let data: DepositSessionResponse | null = null
      try {
        data = (await res.json()) as DepositSessionResponse
      } catch {
        data = null
      }

      if (!res.ok) {
        throw new Error(
          data?.message || data?.error || 'Could not start the deposit checkout.',
        )
      }

      const url = data?.stripeCheckout?.url
      if (!url) throw new Error('Stripe did not return a checkout URL.')

      window.location.assign(url)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start the deposit checkout.')
    }
  }

  if (status === 'PAID') {
    return (
      <section className="rounded-card border border-toneSuccess/30 bg-bgSecondary p-4">
        <div className="text-[13px] font-black text-textPrimary">Deposit paid ✓</div>
        <div className="mt-1 text-[12px] text-textSecondary">
          Your {depositLabel ?? 'deposit'} is held and will be credited toward your
          service total.
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="text-[13px] font-black text-textPrimary">
        Secure your booking
      </div>
      <div className="mt-1 text-[12px] text-textSecondary">
        This pro requires a deposit to hold your booking. Because you found them through
        the Looks feed or Discovery, a one-time booking fee also applies. Your
        deposit is credited toward your service total.
      </div>

      <div className="mt-3 grid gap-1 rounded-card border border-white/10 bg-bgPrimary p-3 text-[13px]">
        {depositLabel ? (
          <div className="flex items-center justify-between">
            <span className="text-textSecondary">Deposit (credited later)</span>
            <span className="font-semibold text-textPrimary">{depositLabel}</span>
          </div>
        ) : null}
        {feeLabel ? (
          <div className="flex items-center justify-between">
            <span className="text-textSecondary">One-time booking fee</span>
            <span className="font-semibold text-textPrimary">{feeLabel}</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 text-[12px] text-toneDanger">{error}</div>
      ) : null}

      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(startDepositCheckout)}
        className={[
          'mt-3 w-full rounded-card border px-4 py-3 text-[13px] font-black transition',
          pending
            ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
            : 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
        ].join(' ')}
      >
        {pending ? 'Starting secure checkout…' : 'Pay deposit & booking fee'}
      </button>

      <div className="mt-2 text-[11px] text-textSecondary">
        Paid securely by card through Stripe.
      </div>
    </section>
  )
}
