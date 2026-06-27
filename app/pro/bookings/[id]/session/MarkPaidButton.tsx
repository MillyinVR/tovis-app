// app/pro/bookings/[id]/session/MarkPaidButton.tsx
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
import type { ManualCollectablePaymentMethod } from '@/lib/payments/acceptedMethods'

type Props = {
  bookingId: string
  methods: ManualCollectablePaymentMethod[]
}

function errorFrom(res: Response, data: unknown): string {
  if (isRecord(data)) {
    const fromError = pickString(data.error)
    if (fromError) return fromError
    const fromMessage = pickString(data.message)
    if (fromMessage) return fromMessage
  }
  return `Could not record payment (${res.status}).`
}

/**
 * Lets a pro record that the client paid in person — for when the client never
 * completes checkout on their own device. Posts to the existing mark-paid route
 * (idempotent + rate-limited); the chosen method is recorded on the booking.
 */
export default function MarkPaidButton({ bookingId, methods }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [method, setMethod] = useState<string>(methods[0]?.value ?? '')
  const [error, setError] = useState<string | null>(null)

  if (methods.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-textSecondary">
        Turn on a payment method in your payment settings to record an in-person
        payment here.
      </p>
    )
  }

  async function submit() {
    if (pending) return
    setError(null)
    setPending(true)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'booking-checkout-mark-paid',
        entityId: bookingId,
        action: 'mark-paid',
        nonce: method,
      })

      const res = await fetch(
        `/api/v1/pro/bookings/${encodeURIComponent(bookingId)}/checkout/mark-paid`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
          body: JSON.stringify({ selectedPaymentMethod: method }),
        },
      )

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFrom(res, data))
        return
      }

      router.refresh()
    } catch {
      setError('Could not record payment. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`mark-paid-method-${bookingId}`}>
          Payment method
        </label>
        <select
          id={`mark-paid-method-${bookingId}`}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          disabled={pending}
          className="h-8 rounded-[10px] border border-textPrimary/16 bg-transparent px-2 text-[12px] text-textPrimary"
        >
          {methods.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Button
          variant="success"
          size="xs"
          onClick={() => void submit()}
          disabled={pending || !method}
        >
          {pending ? 'Recording…' : 'Mark as paid'}
        </Button>
      </div>

      {error ? (
        <p className="text-[11px] text-toneDanger">{error}</p>
      ) : null}
    </div>
  )
}
