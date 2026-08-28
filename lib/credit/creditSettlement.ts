// lib/credit/creditSettlement.ts
//
// The two housekeeping duties of the credit ledger, both driven by
// /api/internal/jobs/client-credit-settlement:
//
//   1. RELEASE reservations that were quoted into a checkout nobody paid, so an
//      abandoned Stripe session stops holding a client's own balance hostage.
//   2. TOP UP the professional for every credit a client actually spent, so
//      "platform-funded" is a transfer that happened rather than a claim.
//
// 🔴 WHY (2) EXISTS AT ALL — read this before touching the redemption path.
// The client's final bill is a Stripe DESTINATION charge with NO
// `application_fee_amount` (app/api/v1/client/bookings/[id]/checkout/
// stripe-session/route.ts; see also the header of lib/booking/refunds.ts). The
// connected account is therefore transferred the WHOLE charge. So the moment the
// client is charged `total − credit`, the pro receives `total − credit` too —
// the credit comes straight out of the professional's payout unless the platform
// puts it back. Tori's decision is explicit and is the whole point of the
// feature: the pro's payout is UNTOUCHED and the platform funds it. This module
// is that funding, and it is the only thing standing between a spent credit and
// a silently short-paid pro.
//
// The transfer is a separate `transfers.create` from the platform balance rather
// than anything attached to the charge, because `transfer_data.amount` cannot
// exceed the charge and the charge is, by construction, the smaller number.
//
// FAILURE IS VISIBLE, NOT SILENT. A spend that has settled but not been topped
// up is a row with `platformTopUpAt IS NULL`, which is queryable, is retried on
// every run, and is reported by the job as an outstanding liability. Nothing
// here swallows an error into a success.
import {
  ClientCreditEntryKind,
  ClientCreditEntryStatus,
  type PrismaClient,
} from '@prisma/client'

import { decimalToCents } from '@/lib/money'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { resolveChargeCurrencyLower } from '@/lib/payments/resolveChargeCurrency'
import { getStripe } from '@/lib/stripe/server'
import { safeError } from '@/lib/security/logging'
import { CREDIT_RESERVATION_TTL_HOURS } from '@/lib/credit/clientCredit'

/**
 * The slice of the Prisma client this module actually touches. Derived from the
 * generated client (Prisma stays the source of truth), narrowed so a caller —
 * the cron route in production, a stub in a test — can satisfy it without
 * standing up a whole PrismaClient. A real `PrismaClient` still satisfies it.
 */
export type CreditSettlementDb = {
  clientCreditEntry: Pick<
    PrismaClient['clientCreditEntry'],
    'findMany' | 'aggregate' | 'update' | 'updateMany'
  >
}

/** Ceiling on transfers per run, so one bad afternoon cannot fan out unbounded. */
const MAX_TOP_UPS_PER_RUN = 100

export type ReleaseExpiredCreditResult = {
  released: number
  cutoff: Date
}

/**
 * Hand back credit that was quoted into a checkout which never settled.
 *
 * Only PENDING rows, and only ones older than
 * {@link CREDIT_RESERVATION_TTL_HOURS} — comfortably longer than a Stripe
 * Checkout session's own 24-hour life, so this sweep never races a payment that
 * is still legitimately in flight. If one ever did land late, the payment path
 * promotes a RELEASED row straight to APPLIED: the charge is a fact, and the
 * ledger records what happened.
 */
export async function releaseExpiredCreditReservations(
  db: CreditSettlementDb,
  now: Date,
): Promise<ReleaseExpiredCreditResult> {
  const cutoff = new Date(
    now.getTime() - CREDIT_RESERVATION_TTL_HOURS * 60 * 60 * 1000,
  )

  const result = await db.clientCreditEntry.updateMany({
    where: {
      kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
      status: ClientCreditEntryStatus.PENDING,
      createdAt: { lt: cutoff },
    },
    data: { status: ClientCreditEntryStatus.RELEASED, updatedAt: now },
  })

  return { released: result.count, cutoff }
}

export type SettleCreditTopUpsResult = {
  /** Transfers created this run. */
  settled: number
  /** Cents moved to professionals this run. */
  settledCents: number
  /** Rows that failed and stay owing — retried next run. */
  failed: number
  /** Cents still owed to professionals AFTER this run. */
  outstandingCents: number
}

/**
 * Pay every professional the platform still owes for a spent credit.
 *
 * Idempotent at Stripe: the key is derived from the ledger row's id, so a run
 * that dies after `transfers.create` but before the local write cannot create a
 * second transfer — the retry returns the SAME transfer object and the row is
 * stamped with it.
 */
export async function settleCreditTopUps(
  db: CreditSettlementDb,
  now: Date,
): Promise<SettleCreditTopUpsResult> {
  const owing = await db.clientCreditEntry.findMany({
    where: {
      kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
      status: ClientCreditEntryStatus.APPLIED,
      platformTopUpAt: null,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_TOP_UPS_PER_RUN,
    select: {
      id: true,
      amount: true,
      bookingId: true,
      booking: {
        select: {
          id: true,
          professionalId: true,
          stripeCurrency: true,
          professional: {
            select: {
              // pii-plaintext-read-ok: the destination of the platform's own
              // transfer. There is no way to pay a connected account without
              // its id, and it never leaves this module — it is handed to
              // Stripe and is not serialized onto any wire or surface.
              paymentSettings: { select: { stripeAccountId: true } },
            },
          },
        },
      },
    },
  })

  const stripe = getStripe()
  let settled = 0
  let settledCents = 0
  let failed = 0

  for (const entry of owing) {
    const amountCents = decimalToCents(entry.amount) ?? 0
    // The transfer's destination. Used only as an argument to
    // `stripe.transfers.create` below; never serialized onto a wire or surface.
    const destination =
      entry.booking.professional.paymentSettings?.stripeAccountId ?? null // pii-plaintext-read-ok: Stripe transfer destination, argument-only

    if (amountCents <= 0 || !destination) {
      // Not retryable by waiting: a spend with no amount, or a pro with no
      // connected account, needs a human. Counted as failed so the run reports
      // a debt that is not going down on its own.
      failed += 1
      console.error('credit top-up is unpayable', {
        entryId: entry.id,
        bookingId: entry.bookingId,
        amountCents,
        hasDestination: Boolean(destination),
      })
      // Waiting does not fix this one — a spend with no amount, or a pro with
      // no connected account, needs a human. The cron reports it in
      // `outstandingCents` and the route's own comment says it "should not grow
      // run over run", but nothing reads a cron's 200 body. Money the platform
      // owes a professional must not be waiting on someone opening a log.
      captureBookingException({
        error: new Error('Creator credit top-up is unpayable'),
        route: 'settleCreditTopUps',
        event: 'CREDIT_TOP_UP_UNPAYABLE',
        bookingId: entry.bookingId,
      })
      continue
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: amountCents,
          // The pro was paid the charge in the booking's own currency; the
          // top-up has to arrive in the same one or it is a different amount.
          currency: resolveChargeCurrencyLower(entry.booking.stripeCurrency),
          destination,
          metadata: {
            bookingId: entry.bookingId,
            creditEntryId: entry.id,
            reason: 'creator_credit_platform_top_up',
          },
        },
        { idempotencyKey: `tovis:credit-topup:${entry.id}` },
      )

      await db.clientCreditEntry.update({
        where: { id: entry.id },
        data: {
          platformTopUpAt: now,
          platformTopUpTransferId: transfer.id,
          updatedAt: now,
        },
        select: { id: true },
      })

      settled += 1
      settledCents += amountCents
    } catch (error: unknown) {
      // Left owing on purpose. The next run picks it up again with the same
      // idempotency key, so a transfer that actually succeeded before the error
      // is returned rather than duplicated.
      failed += 1
      console.error('credit top-up failed', {
        entryId: entry.id,
        bookingId: entry.bookingId,
        error: safeError(error),
      })
      // The retry above is only a backstop for a TRANSIENT failure. A permanent
      // one (a restricted or de-authorized connected account) re-fails on every
      // run forever, and the outstanding balance grows where nobody is looking.
      captureBookingException({
        error,
        route: 'settleCreditTopUps',
        event: 'CREDIT_TOP_UP_TRANSFER_FAILED',
        bookingId: entry.bookingId,
      })
    }
  }

  const outstanding = await db.clientCreditEntry.aggregate({
    where: {
      kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
      status: ClientCreditEntryStatus.APPLIED,
      platformTopUpAt: null,
    },
    _sum: { amount: true },
  })

  return {
    settled,
    settledCents,
    failed,
    outstandingCents: decimalToCents(outstanding._sum.amount) ?? 0,
  }
}
