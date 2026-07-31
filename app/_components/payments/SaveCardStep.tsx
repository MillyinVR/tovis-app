// app/_components/payments/SaveCardStep.tsx
'use client'

// The one "save a card on file" flow: mint a SetupIntent, collect the card in
// Stripe's PaymentElement, confirm it, then attach it to the client.
//
// Extracted in K16 because the booking flow needed the exact same six steps the
// settings page already had. A second copy would be a money surface maintained
// in two places — and the copies drift in precisely the way that matters (which
// errors are shown, whether the attach POST is retried), so this is the one
// implementation and both callers render it.
//
// Starts its SetupIntent on mount: every caller renders this only once the
// client has already asked to add a card, so an extra "start" click inside the
// component would just be a second confirmation of the same intent.
//
// 🔴 The whole rail is dark unless ENABLE_NO_SHOW_PROTECTION is on — the
// setup-intent route 404s. Callers must not offer this while the flag is off;
// the failure here is honest (an error message) but it is not a surface any
// client should be able to reach.

import { useCallback, useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'

import Button from '@/app/_components/ui/Button'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'

// Created ONCE at module scope so Stripe.js isn't re-loaded per render.
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
)

/** Inner form rendered inside <Elements>; owns the Stripe.js confirm step. */
function AddCardForm(props: {
  setupIntentId: string
  saveLabel: string
  onSaved: () => void
  onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements || saving) return

    setSaving(true)
    setError(null)

    try {
      const { error: confirmError } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      })

      if (confirmError) {
        throw new Error(
          confirmError.message ?? 'We could not confirm that card.',
        )
      }

      const res = await fetch('/api/v1/client/payment-methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ setupIntentId: props.setupIntentId }),
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(raw) ?? 'Failed to save the card.')
      }

      props.onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save the card.')
      // Deliberately NOT cleared in a finally: on success the caller unmounts
      // this form, and leaving it disabled until then stops a double-submit
      // confirming the same SetupIntent twice.
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-4">
      <div className="rounded-card border border-white/10 bg-bgSecondary/35 p-3">
        <PaymentElement />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-card border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-xs font-bold text-toneDanger"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!stripe || !elements || saving}
        >
          {saving ? 'Saving…' : props.saveLabel}
        </Button>
      </div>
    </form>
  )
}

export default function SaveCardStep({
  onSaved,
  onCancel,
  saveLabel = 'Save card',
}: {
  /** Called after the card is confirmed AND attached to the client. */
  onSaved: () => void
  onCancel: () => void
  saveLabel?: string
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/v1/client/payment-methods/setup-intent', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(raw) ?? 'Failed to start setup.')
      }
      if (
        !isRecord(raw) ||
        typeof raw.clientSecret !== 'string' ||
        typeof raw.setupIntentId !== 'string'
      ) {
        throw new Error('Setup response was malformed.')
      }
      setClientSecret(raw.clientSecret)
      setSetupIntentId(raw.setupIntentId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start setup.')
    }
  }, [])

  useEffect(() => {
    void start()
  }, [start])

  if (error) {
    return (
      <div className="mt-4 grid gap-3">
        <div
          role="alert"
          className="rounded-card border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-xs font-bold text-toneDanger"
        >
          {error}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void start()}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (!clientSecret || !setupIntentId) {
    return (
      <div className="mt-4 text-xs font-semibold text-textSecondary">
        Preparing secure card entry…
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <AddCardForm
        setupIntentId={setupIntentId}
        saveLabel={saveLabel}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    </Elements>
  )
}
