'use client'

// K10-B: the pay CTA on the public deposit page. Mints the Stripe Checkout
// session through the token route and hands the browser to Stripe. The token
// is not single-use, so a bailed checkout can come back and tap again.

import { useState } from 'react'

import { isRecord } from '@/lib/guards'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

type Props = {
  token: string
  amountLabel: string
}

export function PayDepositButton({ token, amountLabel }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout() {
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'public-deposit-checkout',
        entityId: token,
        action: 'stripe-session',
      })

      const response = await fetch(
        `/api/v1/public/deposit/${encodeURIComponent(token)}/stripe-session`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
          body: JSON.stringify({}),
        },
      )

      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : 'Unable to start the deposit checkout.'
        throw new Error(message)
      }

      const checkout = isRecord(payload) ? payload.stripeCheckout : null
      const url =
        isRecord(checkout) && typeof checkout.url === 'string'
          ? checkout.url
          : null

      if (!url) {
        throw new Error('The checkout session did not return a payment page.')
      }

      window.location.assign(url)
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim()
          ? err.message
          : 'Unable to start the deposit checkout.',
      )
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-5 py-2.5 text-sm font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Opening secure checkout…' : `Pay ${amountLabel} deposit`}
      </button>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-card border border-toneDanger/20 bg-toneDanger/5 px-4 py-3 text-sm text-textPrimary"
        >
          {error}
          <div className="mt-1 text-xs text-textSecondary">
            This link is still valid — you can try again.
          </div>
        </div>
      ) : null}
    </div>
  )
}
