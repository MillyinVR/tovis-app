// app/pro/bookings/[id]/RefundButton.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

type Props = {
  bookingId: string
  /** Captured total in minor units (cents); used for the default-full hint. */
  amountTotalCents: number | null
  currency: string | null
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function errorFromResponse(res: Response, data: unknown): string {
  const root = isRecord(data) ? data : null
  const error = root ? readString(root.error) : null
  if (error) return error
  if (res.status === 403) return 'You are not allowed to refund this booking.'
  if (res.status === 404) return 'Booking not found.'
  if (res.status === 409) return 'This booking has nothing left to refund.'
  if (res.status === 422) return 'This booking has no Stripe payment to refund.'
  return `Refund failed (${res.status}).`
}

function buildIdempotencyKey(bookingId: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `pro-refund:${bookingId}:${suffix}`
}

/** Dollars string → integer cents, or null for blank (= full refund). Returns
 *  'invalid' when the input is present but not a positive money amount. */
function parseAmountToCents(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const dollars = Number(trimmed)
  if (!Number.isFinite(dollars) || dollars <= 0) return 'invalid'

  return Math.round(dollars * 100)
}

function formatMoney(cents: number, currency: string | null): string {
  const amount = (cents / 100).toFixed(2)
  const code = (currency ?? 'usd').toUpperCase()
  return `${amount} ${code}`
}

export default function RefundButton({
  bookingId,
  amountTotalCents,
  currency,
}: Props) {
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  async function submit() {
    if (pending) return

    const cents = parseAmountToCents(amount)
    if (cents === 'invalid') {
      setError('Enter a positive amount, or leave blank to refund in full.')
      return
    }

    const fullLabel =
      typeof amountTotalCents === 'number'
        ? ` (full: ${formatMoney(amountTotalCents, currency)})`
        : ''
    const confirmCopy =
      cents === null
        ? `Refund this booking in full${fullLabel}? This cannot be undone.`
        : `Refund ${formatMoney(cents, currency)} for this booking? This cannot be undone.`

    if (typeof window === 'undefined') return
    if (!window.confirm(confirmCopy)) return

    setError(null)
    setPending(true)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const idempotencyKey = buildIdempotencyKey(bookingId)

    try {
      const res = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}/refund`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            ...(cents !== null ? { amountCents: cents } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }),
          signal: controller.signal,
        },
      )

      const data: unknown = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      setDone(true)
      setOpen(false)
      router.refresh()
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error(err)
      setError(
        err instanceof Error ? err.message : 'Network error while refunding.',
      )
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setPending(false)
      }
    }
  }

  const btnBase =
    'inline-flex items-center justify-center rounded-full px-3 py-2 text-[12px] font-black transition ' +
    'disabled:cursor-not-allowed disabled:opacity-60 border border-white/10'

  if (done) {
    return (
      <div className="text-[12px] font-black text-textSecondary">
        Refund issued.
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        className={`${btnBase} bg-bgPrimary text-textPrimary hover:border-white/20`}
      >
        Refund
      </button>
    )
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-bgPrimary p-3">
      <label className="grid gap-1 text-[11px] font-black text-textSecondary">
        Amount ({(currency ?? 'usd').toUpperCase()})
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={
            typeof amountTotalCents === 'number'
              ? `Full: ${(amountTotalCents / 100).toFixed(2)}`
              : 'Full amount'
          }
          className="rounded-lg border border-white/10 bg-surfaceGlass px-2 py-1 text-[13px] font-black text-textPrimary"
        />
      </label>

      <label className="grid gap-1 text-[11px] font-black text-textSecondary">
        Reason (optional)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="e.g. client cancelled late"
          className="rounded-lg border border-white/10 bg-surfaceGlass px-2 py-1 text-[13px] font-black text-textPrimary"
        />
      </label>

      {error ? (
        <div
          aria-live="polite"
          className="text-[11px] font-black text-microAccent"
        >
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={`${btnBase} bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover`}
        >
          {pending ? 'Refunding…' : 'Confirm refund'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={pending}
          className={`${btnBase} bg-bgPrimary text-textPrimary hover:border-white/20`}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
