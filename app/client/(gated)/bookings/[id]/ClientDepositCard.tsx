// app/client/(gated)/bookings/[id]/ClientDepositCard.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCents, formatMoneyFromUnknown, moneyToNumber } from '@/lib/money'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'

type Props = {
  bookingId: string
  /** Booking status — the deposit card is only truthful for an active booking. */
  bookingStatus: string | null | undefined
  depositStatus: string | null | undefined
  /**
   * The deposit charge is under (or lost) a Stripe dispute. depositStatus stays
   * PAID through a dispute, so without this the card would still say "Deposit
   * paid ✓ — held and will be credited" while the bank has pulled the funds.
   */
  depositDisputed?: boolean
  /** Deposit dollars (Decimal serialized to string). */
  depositAmount: string | number | null | undefined
  /** One-time platform fee in CENTS. */
  discoveryFeeCents: number | null | undefined
  /**
   * K10: this "deposit" is the whole bill — the pro marked the service
   * prepay-required, so it is a 100% deposit. Derived server-side by
   * `depositWouldCoverTotal`. The card must not call that a deposit that will
   * be "credited later": the client is paying for the appointment, and there
   * will be nothing to settle on the day.
   */
  prepaysInFull?: boolean
  /**
   * Deposit money the pro actually still holds, in cents
   * (`deriveNetDepositHeldCents`) — `depositAmount` minus anything refunded.
   *
   * Only the PAID branch uses it, and only that branch may: the DISPUTED branch
   * has to name the sum under dispute (the net is 0 while a dispute is open, so
   * it would read "your $0.00 is under dispute"), and a PENDING deposit is an
   * amount being ASKED for, not held. Without this a client refunded $50 of a
   * $210 prepay was still told "$210.00 is held".
   */
  netDepositHeldCents?: number | null
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
  bookingStatus,
  depositStatus,
  depositDisputed,
  depositAmount,
  discoveryFeeCents,
  prepaysInFull = false,
  netDepositHeldCents,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // On a terminal booking the deposit card lies: a <24h cancel FORFEITS the
  // deposit but leaves depositStatus=PAID, so the PAID branch below would still
  // tell the client their money "is held and will be credited toward your service
  // total." It won't — it's gone to the pro. And a still-PENDING deposit can't be
  // paid on a cancelled booking. So the card is only meaningful while the booking
  // is live; hide it once cancelled/completed/no-show. The honest cancel outcome
  // reaches the client via the cancel response + the refund receipt (M6).
  const bookingTerminal = ['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(
    (bookingStatus ?? '').toUpperCase(),
  )
  if (bookingTerminal) return null

  const status = (depositStatus ?? 'NONE').toUpperCase()
  if (status !== 'PENDING' && status !== 'PAID') return null

  const depositLabel = formatMoneyFromUnknown(depositAmount)
  const feeCents = discoveryFeeCents ?? 0
  const feeLabel = feeCents > 0 ? centsToMoney(feeCents) : null
  // Parsed through lib/money rather than a local Number() so a serialized Decimal
  // ("50", "50.00", 50) lands on the same cents the server charged.
  const depositNumber = moneyToNumber(depositAmount)
  const depositDueTodayCents =
    depositNumber == null ? null : Math.round(depositNumber * 100)

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
    // A disputed deposit stays PAID locally while the bank pulls the funds — it
    // must NOT read as money safely held (M11 display-truth).
    if (depositDisputed) {
      return (
        <section className="rounded-card border border-toneDanger/30 bg-bgSecondary p-4">
          <div className="text-[13px] font-black text-toneDanger">
            Deposit disputed
          </div>
          <div className="mt-1 text-[12px] text-textSecondary">
            {`Your ${depositLabel ?? 'deposit'} is under dispute with your bank and is on hold until it’s resolved.`}
          </div>
        </section>
      )
    }
    // What the pro still holds — not what was originally charged. A partial
    // refund leaves depositStatus PAID, so `depositAmount` alone would keep
    // quoting money that has already gone back to the client.
    const heldLabel =
      netDepositHeldCents == null
        ? depositLabel
        : centsToMoney(Math.max(0, netDepositHeldCents))

    return (
      <section className="rounded-card border border-toneSuccess/30 bg-bgSecondary p-4">
        <div className="text-[13px] font-black text-textPrimary">
          {prepaysInFull ? 'Paid in full ✓' : 'Deposit paid ✓'}
        </div>
        <div className="mt-1 text-[12px] text-textSecondary">
          {prepaysInFull
            ? `Your ${heldLabel ?? 'payment'} covers this appointment. There’s nothing to pay on the day.`
            : `Your ${heldLabel ?? 'deposit'} is held and will be credited toward your service total.`}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="text-[13px] font-black text-textPrimary">
        {prepaysInFull ? 'Pay for your appointment' : 'Secure your booking'}
      </div>
      <div className="mt-1 text-[12px] text-textSecondary">
        {prepaysInFull
          ? 'This pro asks for this service to be paid in full when you book, so there’s nothing left to settle on the day.'
          : 'This pro requires a deposit to hold your booking. Your deposit is credited toward your service total.'}
        {/* The one-time platform fee only applies to a cold Looks/Discovery
            match. Since K10-A the deposit can be required far more widely (the
            pro's depositScope, and now a prepay-required service), so this
            sentence has to follow the fee rather than the deposit — it used to
            tell every deposit-paying client they had come through Discovery. */}
        {feeLabel
          ? ' Because you found this pro through the Looks feed or Discovery, a one-time booking fee also applies.'
          : ''}
      </div>

      <div className="mt-3 grid gap-1 rounded-card border border-white/10 bg-bgPrimary p-3 text-[13px]">
        {depositLabel ? (
          <div className="flex items-center justify-between">
            {/* Not "Service total": the up-front charge can legitimately EXCEED
                the bill when a pro's flat deposit is larger than a discounted
                total (K10-A surfaces the difference as excessHeldCents), and a
                row labelled "total" showing more than the total is a lie. This
                label claims only that nothing is left to pay, which is true in
                both cases. */}
            <span className="text-textSecondary">
              {prepaysInFull ? 'Service (paid in full)' : 'Deposit (credited later)'}
            </span>
            <span className="font-semibold text-textPrimary">{depositLabel}</span>
          </div>
        ) : null}
        {feeLabel ? (
          <div className="flex items-center justify-between">
            <span className="text-textSecondary">One-time booking fee</span>
            <span className="font-semibold text-textPrimary">{feeLabel}</span>
          </div>
        ) : null}
        {/* The fee is no longer a flat amount a client could learn once — it is a
            percentage of the deposit within a floor and a cap, so the only honest
            way to show it is beside the deposit WITH the sum. Without this row the
            itemisation names two numbers and leaves the client to add them up
            before being sent to Stripe for a third. */}
        {feeLabel && depositDueTodayCents != null ? (
          <div className="mt-1 flex items-center justify-between border-t border-white/10 pt-2">
            <span className="font-semibold text-textPrimary">Total due today</span>
            <span className="font-black text-textPrimary">
              {centsToMoney(depositDueTodayCents + feeCents)}
            </span>
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
        {pending
          ? 'Starting secure checkout…'
          : prepaysInFull
            ? feeLabel
              ? 'Pay in full & booking fee'
              : 'Pay in full'
            : feeLabel
              ? 'Pay deposit & booking fee'
              : 'Pay deposit'}
      </button>

      <div className="mt-2 text-[11px] text-textSecondary">
        Paid securely by card through Stripe.
      </div>
    </section>
  )
}
