// app/pro/bookings/[id]/ConfirmPaymentReceivedButton.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import Button, { type ButtonSize } from '@/app/_components/ui/Button'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import { COPY } from '@/lib/copy'

type Props = {
  /** The booking whose checkout is AWAITING_CONFIRMATION (the payment to confirm). */
  bookingId: string
  size?: ButtonSize
  fullWidth?: boolean
}

function errorFrom(res: Response, data: unknown): string {
  if (isRecord(data)) {
    const fromError = pickString(data.error)
    if (fromError) return fromError
    const fromMessage = pickString(data.message)
    if (fromMessage) return fromMessage
  }
  return COPY.proBookingCheckout.confirmError
}

/**
 * Pro action for an off-platform payment the client marked as sent: confirms
 * receipt, which closes out the booking (PAID + paymentCollectedAt) and
 * auto-approves any aftercare next booking coupled to this payment. Posts to the
 * dedicated confirm-payment route (PF2) — distinct from mark-paid — with no body
 * (the method was already recorded at client checkout). Idempotent + rate-limited
 * server-side; the route requires an idempotency key header.
 */
export default function ConfirmPaymentReceivedButton({
  bookingId,
  size = 'sm',
  fullWidth = false,
}: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pending) return
    setError(null)
    setPending(true)

    try {
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'booking-checkout-confirm-payment',
        entityId: bookingId,
        action: 'confirm-payment',
      })

      const res = await fetch(
        `/api/v1/pro/bookings/${encodeURIComponent(bookingId)}/checkout/confirm-payment`,
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

      router.refresh()
    } catch {
      setError(COPY.proBookingCheckout.confirmError)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="success"
        size={size}
        fullWidth={fullWidth}
        onClick={() => void submit()}
        disabled={pending}
      >
        {pending
          ? COPY.proBookingCheckout.confirmCtaPending
          : COPY.proBookingCheckout.confirmCta}
      </Button>

      {error ? (
        <p className="text-[11px] font-semibold text-toneDanger">{error}</p>
      ) : null}
    </div>
  )
}
