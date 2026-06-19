'use client'

import { useState } from 'react'

import { isRecord } from '@/lib/guards'

type Props = {
  /** The AFTERCARE_ACCESS ClientActionToken from the page URL. */
  token: string
  amountCents: number
  currency: string
}

function buildIdempotencyKey(token: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `public-checkout-${token}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}

function formatAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountCents / 100)
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

export function CompletePaymentCard({ token, amountCents, currency }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountLabel = formatAmount(amountCents, currency)

  async function handlePay() {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const idempotencyKey = buildIdempotencyKey(token)

      const response = await fetch(
        `/api/client/rebook/${encodeURIComponent(token)}/checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({}),
        },
      )

      const payload: unknown = await response.json().catch(() => null)
      const checkoutUrl =
        isRecord(payload) &&
        isRecord(payload.stripeCheckout) &&
        typeof payload.stripeCheckout.url === 'string'
          ? payload.stripeCheckout.url
          : null

      if (response.ok && checkoutUrl) {
        window.location.href = checkoutUrl
        return
      }

      const message =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : 'We couldn’t start checkout just now. Please try again.'
      setError(message)
      setBusy(false)
    } catch {
      setError('We couldn’t start checkout just now. Please try again.')
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card border border-white/10 bg-bgSecondary p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-black text-textPrimary">
            Complete your payment
          </div>
          <div className="mt-1 text-sm text-textSecondary">
            Pay securely with card. No account required.
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[12px] font-black text-textPrimary">
          {amountLabel}
        </span>
      </div>

      {error ? (
        <div className="mt-3 rounded-card border border-toneDanger/20 bg-toneDanger/5 px-3 py-2 text-xs font-semibold text-toneDanger">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void handlePay()}
        disabled={busy}
        className="mt-4 inline-flex items-center justify-center rounded-full bg-accentPrimary px-5 py-2.5 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Starting checkout…' : `Pay ${amountLabel}`}
      </button>
    </section>
  )
}
