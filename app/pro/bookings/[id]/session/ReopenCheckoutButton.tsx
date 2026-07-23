// app/pro/bookings/[id]/session/ReopenCheckoutButton.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import Button from '@/app/_components/ui/Button'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'

type Props = {
  bookingId: string
}

function errorFrom(res: Response, data: unknown): string {
  if (isRecord(data)) {
    const fromError = pickString(data.error)
    if (fromError) return fromError
    const fromMessage = pickString(data.message)
    if (fromMessage) return fromMessage
  }
  return `Could not reopen checkout (${res.status}).`
}

/**
 * Lets a pro UNDO a mistaken manual mark-paid / waive — the M9 follow-up.
 * Reverses the checkout record (PAID/WAIVED → READY, clears the collected
 * timestamps) via the reopen route so the pro can re-collect correctly. A live
 * Stripe-card payment is refused server-side (that reverses via a refund), so
 * this control is only rendered for a manual close-out. A two-step confirm
 * guards against an accidental un-collection.
 */
export default function ReopenCheckoutButton({ bookingId }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pending) return
    setError(null)
    setPending(true)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'booking-checkout-reopen',
        entityId: bookingId,
        action: 'reopen',
      })

      const res = await fetch(
        `/api/v1/pro/bookings/${encodeURIComponent(bookingId)}/checkout/reopen`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
        },
      )

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFrom(res, data))
        return
      }

      setConfirming(false)
      router.refresh()
    } catch {
      setError('Could not reopen checkout. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            size="xs"
            onClick={() => void submit()}
            disabled={pending}
          >
            {pending ? 'Reopening…' : 'Confirm reopen'}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start text-[11px] text-textSecondary underline underline-offset-2 hover:text-textPrimary"
        >
          Recorded by mistake? Undo &amp; reopen checkout
        </button>
      )}

      {error ? <p className="text-[11px] text-toneDanger">{error}</p> : null}
    </div>
  )
}
