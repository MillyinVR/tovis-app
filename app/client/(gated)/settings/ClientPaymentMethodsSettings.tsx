// app/client/(gated)/settings/ClientPaymentMethodsSettings.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'

import Badge from '@/app/_components/ui/Badge'
import Button from '@/app/_components/ui/Button'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'
import type { ClientPaymentMethodDTO } from '@/lib/dto/clientPaymentMethods'

// Created ONCE at module scope so Stripe.js isn't re-loaded per render.
const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
)

function pickPaymentMethod(raw: unknown): ClientPaymentMethodDTO | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : ''
  if (!id || !createdAt) return null
  return {
    id,
    brand: typeof raw.brand === 'string' ? raw.brand : null,
    last4: typeof raw.last4 === 'string' ? raw.last4 : null,
    expMonth: typeof raw.expMonth === 'number' ? raw.expMonth : null,
    expYear: typeof raw.expYear === 'number' ? raw.expYear : null,
    isDefault: raw.isDefault === true,
    createdAt,
  }
}

function pickList(raw: unknown): ClientPaymentMethodDTO[] {
  if (!isRecord(raw) || !Array.isArray(raw.paymentMethods)) return []
  const out: ClientPaymentMethodDTO[] = []
  for (const entry of raw.paymentMethods) {
    const parsed = pickPaymentMethod(entry)
    if (parsed) out.push(parsed)
  }
  return out
}

function formatBrand(brand: string | null): string {
  if (!brand) return 'Card'
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

function formatExpiry(month: number | null, year: number | null): string | null {
  if (!month || !year) return null
  const mm = String(month).padStart(2, '0')
  const yy = String(year).slice(-2)
  return `${mm}/${yy}`
}

/** Inner form rendered inside <Elements>; owns the Stripe.js confirm step. */
function AddCardForm(props: {
  setupIntentId: string
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
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-4">
      <div className="rounded-card border border-white/10 bg-bgSecondary/35 p-3">
        <PaymentElement />
      </div>

      {error ? (
        <div className="rounded-card border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-xs font-bold text-toneDanger">
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
          {saving ? 'Saving…' : 'Save card'}
        </Button>
      </div>
    </form>
  )
}

export default function ClientPaymentMethodsSettings() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cards, setCards] = useState<ClientPaymentMethodDTO[]>([])
  const [removingId, setRemovingId] = useState<string | null>(null)

  const [starting, setStarting] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null)

  const loadCards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/client/payment-methods', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(raw) ?? 'Failed to load cards.')
      }
      setCards(pickList(raw))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load cards.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCards()
  }, [loadCards])

  const startAddCard = useCallback(async () => {
    if (starting) return
    setStarting(true)
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
    } finally {
      setStarting(false)
    }
  }, [starting])

  const cancelAddCard = useCallback(() => {
    setClientSecret(null)
    setSetupIntentId(null)
  }, [])

  const onSaved = useCallback(() => {
    setClientSecret(null)
    setSetupIntentId(null)
    void loadCards()
  }, [loadCards])

  async function removeCard(id: string) {
    if (removingId) return
    setRemovingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/v1/client/payment-methods/${id}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(readErrorMessage(raw) ?? 'Failed to remove card.')
      }
      setCards((prev) => prev.filter((c) => c.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove card.')
    } finally {
      setRemovingId(null)
    }
  }

  const adding = clientSecret !== null && setupIntentId !== null

  return (
    <div className="mt-4">
      <div className="rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-xs leading-5 text-textSecondary">
        Saving a card lets a pro charge a no-show or late-cancellation fee
        according to their booking policy. Your full card number is never stored
        here — only a secure token and the last four digits.
      </div>

      {error ? (
        <div className="mt-4 rounded-card border border-toneDanger/30 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-3 text-sm font-semibold text-textSecondary">
          Loading cards…
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {cards.length === 0 ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-3 text-sm font-semibold text-textSecondary">
              No cards saved yet.
            </div>
          ) : (
            cards.map((card) => {
              const expiry = formatExpiry(card.expMonth, card.expYear)
              return (
                <div
                  key={card.id}
                  className="flex items-center justify-between gap-3 rounded-card border border-white/10 bg-bgSecondary/35 px-3 py-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-textPrimary">
                      {formatBrand(card.brand)}
                    </span>
                    <span className="text-sm font-semibold text-textSecondary">
                      •••• {card.last4 ?? '––––'}
                    </span>
                    {expiry ? (
                      <span className="text-xs font-semibold text-textSecondary/80">
                        exp {expiry}
                      </span>
                    ) : null}
                    {card.isDefault ? (
                      <Badge tone="success" size="sm">
                        Default
                      </Badge>
                    ) : null}
                  </div>

                  <Button
                    type="button"
                    variant="danger"
                    size="xs"
                    onClick={() => void removeCard(card.id)}
                    disabled={removingId === card.id}
                  >
                    {removingId === card.id ? 'Removing…' : 'Remove'}
                  </Button>
                </div>
              )
            })
          )}
        </div>
      )}

      {adding && clientSecret ? (
        <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary/20 p-3 sm:p-4">
          <div className="text-xs font-black tracking-[var(--ls-caps)] text-textSecondary">
            Add a card
          </div>
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <AddCardForm
              setupIntentId={setupIntentId}
              onSaved={onSaved}
              onCancel={cancelAddCard}
            />
          </Elements>
        </div>
      ) : (
        <div className="mt-4">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void startAddCard()}
            disabled={starting || loading}
          >
            {starting ? 'Starting…' : 'Add a card'}
          </Button>
        </div>
      )}
    </div>
  )
}
