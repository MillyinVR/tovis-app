// lib/consult/declineDepositSettlement.ts
//
// Book the Look, B6 — the sentence a pro reads back after she decides what
// happens to a declined client's deposit.
//
// Why this is its own module. The decision and the money are two different
// facts, and the screen used to conflate them: it rendered from the button the
// pro pressed, so a REFUND whose money never moved still printed "Recorded: you
// refunded her deposit of $X". The amount came from the booking's up-front
// charge, not from anything that had actually been returned.
//
// So the rule here is: the SETTLEMENT decides which sentence, and the settlement
// is derived from cents that actually moved. `inChairDeclineOutcome.ts` is
// `server-only` and cannot be imported by the client component that renders
// this, which is exactly why the shared type and the resolver live here instead
// of being written out twice.

import { COPY } from '@/lib/copy'
import { formatCents } from '@/lib/money'

export type ConsultDeclineDepositChoice = 'KEEP' | 'REFUND'

/**
 * What actually happened to the money, as distinct from what the pro chose.
 * See `ConsultDeclineDepositResult` in inChairDeclineOutcome.ts.
 */
export type ConsultDeclineDepositSettlement = 'KEPT' | 'REFUNDED' | 'NOT_MOVED'

/**
 * The settlement implied by a recorded decision plus the cents actually back
 * with the client.
 *
 * This is the read-back path: the decision row is written BEFORE Stripe is
 * called and is never revised, so on every later page load the recorded choice
 * is the only thing that survives — and on its own it cannot tell a refund that
 * worked from one that did not. `refundedCents` (the booking's own
 * `depositRefundedCents`) is the fact that can.
 */
export function settlementFromRecord(args: {
  choice: ConsultDeclineDepositChoice
  refundedCents: number
}): ConsultDeclineDepositSettlement {
  if (args.choice === 'KEEP') return 'KEPT'
  return args.refundedCents > 0 ? 'REFUNDED' : 'NOT_MOVED'
}

/**
 * The recorded-answer sentence. `refundedCents` is what moved; `chargeCents` is
 * what she paid up front. They differ on a partial refund, and saying so is the
 * point — a pro reading "you refunded her deposit of $200" when $50 went back
 * has been told something false just as surely as if nothing had moved.
 */
export function describeDeclineDepositSettlement(args: {
  settlement: ConsultDeclineDepositSettlement
  refundedCents: number
  chargeCents: number
}): string {
  const copy = COPY.consultDeclineDeposit

  if (args.settlement === 'KEPT') {
    return `${copy.keptRecorded} ${formatCents(args.chargeCents)}.`
  }

  if (args.settlement === 'NOT_MOVED') {
    return copy.refundedNothingMoved
  }

  if (args.refundedCents < args.chargeCents) {
    return `${copy.refundedPartial} ${formatCents(args.refundedCents)} ${
      copy.refundedPartialOf
    } ${formatCents(args.chargeCents)}.`
  }

  return `${copy.refundedRecorded} ${formatCents(args.refundedCents)}.`
}
