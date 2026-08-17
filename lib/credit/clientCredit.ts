// lib/credit/clientCredit.ts
//
// THE ledger for platform-funded client credit: what a creator earns when
// somebody else's booking from their look completes, and what a client puts
// against their own bill at checkout.
//
// Tori's settled numbers (2026-08-17) — do not re-derive any of them:
//   rate        3% of the booking's SERVICE subtotal (before tip and tax)
//   trigger     on COMPLETION
//   funded by   the PLATFORM — the pro's payout is untouched
//   redemption  a manual toggle at checkout, chosen per booking
//
// 🔴 THIS IS NOT THE REFERRAL REWARD, AND MUST NOT BECOME IT.
// `Referral` + `ProfessionalPaymentSettings.referralReward*`
// (lib/referral/referralConversion.ts) is pro-configured, PRO-funded,
// client→client and per-pro opt-in, and it writes one `rewardValue` onto one
// booking's `discountAmount`. This is platform-funded, universal, and a running
// balance. They share no column, no table and no code path on purpose: merging
// them would collapse two different funders into one rail, and the first
// symptom would be a pro paying for the platform's marketing out of their own
// payout.
//
// WHAT "ON COMPLETION" BUYS, AND WHY IT MUST BE PROTECTED
// Minting from a terminal state means there is no clawback, no reversal, no
// negative balance and no already-spent-it problem. A cancelled or no-show
// booking simply never mints. If anyone proposes moving the trigger to booking
// time, that is a different feature and the clawback comes back with it.
//
// WHY THE BALANCE IS A SUM AND NEVER A COLUMN
// A denormalized balance is a number that can silently disagree with the entries
// that produced it, and the first time it does, it is spendable money that
// disagrees. Every read here re-derives from the rows.
import {
  ClientCreditEntryKind,
  ClientCreditEntryStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client'

import { decimalToCents, parseMoney } from '@/lib/money'
import { envFlagEnabled } from '@/lib/env'
import { normalizeRequiredId } from '@/lib/guards'

type CreditDb = PrismaClient | Prisma.TransactionClient

// ── the master switch ────────────────────────────────────────────────────────

/**
 * Master switch for SPENDING client credit (Tori, 2026-08-17). Off (unset) =>
 * no balance is offered anywhere, no toggle renders, and nothing can be reserved
 * against a bill.
 *
 * Modelled on `platformFeesEnabled` (lib/booking/discoveryFee.ts) — this repo's
 * only other money rail — and default OFF for the same reason: flipping a rail
 * that changes what a client is charged should be a deliberate, Tori-only act,
 * and `.env.example`'s flag block is "default OFF unless set". Without it the
 * only way to stop credit was a revert.
 *
 * 🔴 GATES THE SPEND HALF ONLY. Three things deliberately do NOT consult it:
 *
 *  1. `mintCreatorCreditOnCompletion` — the earn path keeps running, so balances
 *     accrue honestly while the rail is shut and are simply correct on the day
 *     it opens. Gating the mint instead would silently under-credit every
 *     booking that completed while the switch was off, leaving no record it
 *     ever happened and no way to reconstruct one.
 *  2. `applyClientCreditForBooking` — it records a payment that ALREADY settled
 *     at a reduced amount. A switch able to suppress that would turn a charge
 *     that happened into a ledger entry that never did.
 *  3. The settlement job (lib/credit/creditSettlement.ts) — it pays professionals
 *     back the platform's top-up. Gating it would strand a pro who was
 *     short-paid while the rail was open, which is the one failure this whole
 *     feature is built to prevent.
 *
 * In short: the switch can stop new spending, and can never orphan money that
 * already moved.
 */
export function clientCreditSpendEnabled(): boolean {
  return envFlagEnabled('ENABLE_CLIENT_CREDIT')
}

/** Tori's rate: 3% of the booking's service subtotal. */
export const CREATOR_CREDIT_RATE_PERCENT = 3

/**
 * How long a quoted-but-unpaid reservation holds the balance before the
 * settlement job hands it back.
 *
 * Deliberately longer than a Stripe Checkout session's own 24-hour expiry, so
 * the ordinary "client opened checkout and wandered off" case is always resolved
 * by the session dying rather than by this sweep racing a payment that is still
 * legitimately in flight.
 */
export const CREDIT_RESERVATION_TTL_HOURS = 72

/** Statuses that hold spendable balance: quoted into a checkout, or paid. */
const COMMITTED_SPEND_STATUSES = [
  ClientCreditEntryStatus.PENDING,
  ClientCreditEntryStatus.APPLIED,
] as const

/**
 * The credit a completed booking mints, in cents.
 *
 * Rounded to the cent (half-up) because the ledger column is `Decimal(10,2)`:
 * 3% of $99.99 is $2.9997, and a third of a cent has to land somewhere. Rounding
 * UP the half is the direction that favours the creator, which is the right
 * default for money the platform is giving away.
 */
export function creatorCreditCentsFor(serviceSubtotalCents: number): number {
  if (!Number.isFinite(serviceSubtotalCents) || serviceSubtotalCents <= 0) {
    return 0
  }
  return Math.round((serviceSubtotalCents * CREATOR_CREDIT_RATE_PERCENT) / 100)
}

/** Cents → the `Decimal(10,2)` the ledger stores. */
function centsToMoney(cents: number): Prisma.Decimal {
  return parseMoney(cents / 100)
}

// ── balance ──────────────────────────────────────────────────────────────────

/**
 * Spendable balance, in cents: everything earned, less everything quoted or
 * paid.
 *
 * PENDING spends count AGAINST the balance. That is the whole reason the status
 * exists — a checkout is sized when its session is prepared and only settles
 * later, and without holding the balance across that window the same dollar
 * could be quoted onto two different bookings and both of them paid.
 *
 * 🔴 `excludeBookingId` is not an optimisation. A checkout being re-prepared
 * must discount ITS OWN live reservation, or the second attempt sees a balance
 * already spent by the first attempt and silently halves the credit on offer
 * every time the client backs out of Stripe and tries again.
 *
 * Floored at zero. The rows are always the truth; a floored READ is what stops a
 * late-settling payment against a reservation the sweep already released from
 * ever being rendered as a negative balance.
 */
export async function getClientCreditBalanceCents(
  db: CreditDb,
  clientIdInput: string,
  options: { excludeBookingId?: string | null } = {},
): Promise<number> {
  const clientId = normalizeRequiredId('clientId', clientIdInput)
  const excludeBookingId = options.excludeBookingId?.trim() || null

  const [earned, spent] = await Promise.all([
    db.clientCreditEntry.aggregate({
      where: {
        clientId,
        kind: ClientCreditEntryKind.EARNED_LOOK_BOOKING,
        status: ClientCreditEntryStatus.APPLIED,
      },
      _sum: { amount: true },
    }),
    db.clientCreditEntry.aggregate({
      where: {
        clientId,
        kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
        status: { in: [...COMMITTED_SPEND_STATUSES] },
        ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}),
      },
      _sum: { amount: true },
    }),
  ])

  const earnedCents = decimalToCents(earned._sum.amount) ?? 0
  const spentCents = decimalToCents(spent._sum.amount) ?? 0

  return Math.max(0, earnedCents - spentCents)
}

/**
 * What may be OFFERED to spend right now: the balance above, or 0 while the
 * master switch is off.
 *
 * Separate from `getClientCreditBalanceCents` on purpose, and the distinction is
 * the whole point of the switch. The balance read stays honest — the activity
 * banner still shows a creator what they have earned, because they did earn it —
 * while every surface that invites a client to SPEND asks this one instead.
 *
 * It exists as a named function rather than a flag check at each call site so
 * that the next surface to offer credit inherits the gate by using the obvious
 * helper. A half-wired switch that covers two of three offer sites is worse than
 * none: it reads as "credit is off" while one screen still spends it.
 */
export async function getOfferableClientCreditBalanceCents(
  db: CreditDb,
  clientIdInput: string,
  options: { excludeBookingId?: string | null } = {},
): Promise<number> {
  if (!clientCreditSpendEnabled()) return 0
  return getClientCreditBalanceCents(db, clientIdInput, options)
}

// ── earn ─────────────────────────────────────────────────────────────────────

const MINT_BOOKING_SELECT = {
  id: true,
  clientId: true,
  serviceSubtotalSnapshot: true,
  subtotalSnapshot: true,
  sourceLookPostId: true,
  sourceLookPost: { select: { clientAuthorId: true } },
} satisfies Prisma.BookingSelect

export type MintCreatorCreditResult = {
  /** Cents written. 0 whenever nothing was minted, for any of the reasons below. */
  mintedCents: number
  reason:
    | 'MINTED'
    /** Already minted — the unique constraint refused a second row. */
    | 'ALREADY_MINTED'
    /** The booking was not made from a look. */
    | 'NO_SOURCE_LOOK'
    /** The look is pro-authored, or its author's profile is gone. */
    | 'NO_CREATOR'
    /** The creator booked their own look; nobody pays themselves to recreate it. */
    | 'SELF_BOOKING'
    /** 3% of the service subtotal rounds to nothing (a $0 service bill). */
    | 'NO_AMOUNT'
}

/**
 * Mint the creator's credit for a booking that has just completed.
 *
 * Idempotent BY THE DATABASE, not by checking first: the completion path runs
 * more than once for the same booking (pro closeout, aftercare send, the Stripe
 * webhook), and a read-then-write would race itself into two mints. The
 * `@@unique([bookingId, kind])` index is the guarantee and `skipDuplicates` is
 * how this call declines to fight it.
 *
 * Call it INSIDE the completion transaction so a booking can never be recorded
 * complete without its credit, or credited without completing.
 */
export async function mintCreatorCreditOnCompletion(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; now: Date },
): Promise<MintCreatorCreditResult> {
  const bookingId = normalizeRequiredId('bookingId', args.bookingId)

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: MINT_BOOKING_SELECT,
  })

  if (!booking?.sourceLookPostId) {
    return { mintedCents: 0, reason: 'NO_SOURCE_LOOK' }
  }

  const creatorId = booking.sourceLookPost?.clientAuthorId ?? null
  if (!creatorId) {
    // A pro-authored look. The creator credit is the client-creator economy;
    // a pro is already paid for the booking itself.
    return { mintedCents: 0, reason: 'NO_CREATOR' }
  }

  if (creatorId === booking.clientId) {
    // Recreating your own look is not somebody else discovering it. Without this
    // a creator could mint themselves 3% of every appointment they book.
    return { mintedCents: 0, reason: 'SELF_BOOKING' }
  }

  // The SERVICE subtotal, before tip and tax — Tori's wording. Products are not
  // services, so `subtotalSnapshot` (service + product) is only the fallback
  // for a legacy row that never carried the split, matching exactly how
  // `buildBookingCheckoutRollupUpdate` resolves the same column.
  const serviceSubtotalCents =
    decimalToCents(booking.serviceSubtotalSnapshot ?? booking.subtotalSnapshot) ??
    0

  const mintedCents = creatorCreditCentsFor(serviceSubtotalCents)
  if (mintedCents <= 0) {
    return { mintedCents: 0, reason: 'NO_AMOUNT' }
  }

  const created = await tx.clientCreditEntry.createMany({
    data: [
      {
        clientId: creatorId,
        kind: ClientCreditEntryKind.EARNED_LOOK_BOOKING,
        status: ClientCreditEntryStatus.APPLIED,
        amount: centsToMoney(mintedCents),
        bookingId: booking.id,
        sourceLookPostId: booking.sourceLookPostId,
        createdAt: args.now,
        updatedAt: args.now,
      },
    ],
    skipDuplicates: true,
  })

  if (created.count === 0) {
    return { mintedCents: 0, reason: 'ALREADY_MINTED' }
  }

  return { mintedCents, reason: 'MINTED' }
}

// ── spend ────────────────────────────────────────────────────────────────────

/**
 * Put as much of the client's balance as the bill can take against one booking,
 * and hold it until that checkout settles.
 *
 * Returns the cents actually reserved — `0` is a normal answer (no balance, or
 * the client did not ask for it), and the caller must charge the full bill on
 * that answer rather than treating it as an error.
 *
 * 🔴 Never touches a spend that has already been APPLIED. That row is a payment
 * that happened; re-sizing it would rewrite history to match a bill the client
 * was never charged.
 */
export async function reserveClientCreditForBooking(
  tx: Prisma.TransactionClient,
  args: {
    clientId: string
    bookingId: string
    /** The most this bill can absorb — normally what is still due. */
    maxApplicableCents: number
    now: Date
  },
): Promise<number> {
  const clientId = normalizeRequiredId('clientId', args.clientId)
  const bookingId = normalizeRequiredId('bookingId', args.bookingId)

  const existing = await tx.clientCreditEntry.findUnique({
    where: {
      bookingId_kind: {
        bookingId,
        kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
      },
    },
    select: { id: true, status: true, amount: true },
  })

  if (existing?.status === ClientCreditEntryStatus.APPLIED) {
    return Math.max(0, decimalToCents(existing.amount) ?? 0)
  }

  const cap = Math.max(0, Math.trunc(args.maxApplicableCents))
  // 🔴 The OFFERABLE balance, not the raw one — this is where the master switch
  // reaches the write. With it off this resolves to 0 and falls through to the
  // release branch below; it deliberately does NOT return early. Flipping the
  // switch off has to hand back the reservations it had already taken, or a
  // client's own balance sits PENDING against a bill they can no longer spend it
  // on, invisible to them, until the settlement sweep's TTL expires it.
  const available = await getOfferableClientCreditBalanceCents(tx, clientId, {
    // This booking's own live reservation is not somebody else's money.
    excludeBookingId: bookingId,
  })
  const reservedCents = Math.min(available, cap)

  if (reservedCents <= 0) {
    if (existing) {
      await tx.clientCreditEntry.update({
        where: { id: existing.id },
        data: {
          status: ClientCreditEntryStatus.RELEASED,
          updatedAt: args.now,
        },
        select: { id: true },
      })
    }
    return 0
  }

  const amount = centsToMoney(reservedCents)

  if (existing) {
    await tx.clientCreditEntry.update({
      where: { id: existing.id },
      data: {
        amount,
        status: ClientCreditEntryStatus.PENDING,
        // Re-quoting restarts the reservation's clock: the sweep must not
        // expire a hold the client renewed thirty seconds ago.
        createdAt: args.now,
        updatedAt: args.now,
      },
      select: { id: true },
    })
  } else {
    await tx.clientCreditEntry.create({
      data: {
        clientId,
        kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
        status: ClientCreditEntryStatus.PENDING,
        amount,
        bookingId,
        createdAt: args.now,
        updatedAt: args.now,
      },
      select: { id: true },
    })
  }

  return reservedCents
}

/**
 * Hand a booking's held credit back — the client turned the toggle off, or
 * abandoned the checkout it was quoted into.
 *
 * Only ever touches a PENDING row. An APPLIED spend is money that moved.
 */
export async function releaseClientCreditForBooking(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; now: Date },
): Promise<number> {
  const result = await tx.clientCreditEntry.updateMany({
    where: {
      bookingId: normalizeRequiredId('bookingId', args.bookingId),
      kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
      status: ClientCreditEntryStatus.PENDING,
    },
    data: { status: ClientCreditEntryStatus.RELEASED, updatedAt: args.now },
  })
  return result.count
}

/**
 * Commit a booking's held credit: the payment settled at the reduced amount, so
 * the balance is genuinely spent and the platform now owes the pro a top-up.
 *
 * 🔴 Accepts a RELEASED row as well as a PENDING one. If the settlement sweep
 * handed a reservation back moments before a slow webhook landed, the client was
 * still charged the discounted bill — the charge is a fact, and the ledger has
 * to record what happened rather than what it expected. `getClientCreditBalance`
 * floors at zero so the (very narrow) overlap can never render as a negative.
 */
export async function applyClientCreditForBooking(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; now: Date },
): Promise<number> {
  const result = await tx.clientCreditEntry.updateMany({
    where: {
      bookingId: normalizeRequiredId('bookingId', args.bookingId),
      kind: ClientCreditEntryKind.SPENT_ON_BOOKING,
      status: {
        in: [ClientCreditEntryStatus.PENDING, ClientCreditEntryStatus.RELEASED],
      },
    },
    data: { status: ClientCreditEntryStatus.APPLIED, updatedAt: args.now },
  })
  return result.count
}

// ── read: the activity banner ────────────────────────────────────────────────

/**
 * A booking whose checkout is open enough to put credit against, newest first —
 * or null when the client has no bill to spend on.
 *
 * This is what stops the banner's "Use" affordance from being a control that
 * leads nowhere: with nothing to spend on it does not render at all. Two halves:
 *
 *  1. The checkout is open. Mirrors `assertClientCanUpdateBookingCheckout` in
 *     the write boundary — aftercare sent, payment not collected, checkout not
 *     already closed — deliberately as a READ predicate, because the boundary
 *     states them as per-condition throws that a query cannot consume.
 *
 *  2. 🔴 The professional actually takes card. Credit is card-only (the pro is
 *     made whole by a platform→pro Stripe transfer, which needs a connected
 *     account), so a cash-only pro's checkout can NEVER spend a balance. Found
 *     by looking: the demo pro takes no card, and the banner still offered a
 *     "Use" button that landed on a checkout with no credit control anywhere on
 *     it. Same four conditions `assertProSettingsAcceptStripeCard` throws on.
 *
 * The boundary is still the authority; the worst a drift here can do is offer a
 * link to a checkout that then declines, never spend anything.
 */
export async function findSpendableCheckoutBookingId(
  db: CreditDb,
  clientIdInput: string,
): Promise<string | null> {
  const clientId = normalizeRequiredId('clientId', clientIdInput)

  // 🔴 With the master switch off there is no spendable checkout, by definition:
  // the toggle this href exists to reach does not render. Leaving the link alive
  // would land the client on a checkout with no credit control anywhere on it —
  // the exact dead end the `?step=aftercare` note below was written to close.
  if (!clientCreditSpendEnabled()) return null

  const booking = await db.booking.findFirst({
    where: {
      clientId,
      status: { not: 'CANCELLED' },
      paymentCollectedAt: null,
      checkoutStatus: { notIn: ['PAID', 'WAIVED'] },
      aftercareSummary: { is: { sentToClientAt: { not: null } } },
      professional: {
        is: {
          paymentSettings: {
            is: {
              acceptStripeCard: true,
              stripeChargesEnabled: true,
              stripePayoutsEnabled: true,
              stripeAccountId: { not: null }, // pii-plaintext-read-ok: existence test only, the id is never selected or read
            },
          },
        },
      },
    },
    orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })

  return booking?.id ?? null
}

/**
 * Where a client goes to actually spend their balance.
 *
 * 🔴 `?step=aftercare` is load-bearing, not decoration. The booking page opens
 * on OVERVIEW by default and the checkout card — the only place the credit
 * toggle exists — lives under the aftercare step. Linking at the bare booking
 * dropped the client on a tab with no sign of the thing the button said they
 * could do, which is a dead end wearing a working link's clothes.
 */
export function spendCreditHref(bookingId: string): string {
  return `/client/bookings/${encodeURIComponent(bookingId)}?step=aftercare`
}

export type ClientCreditSummary = {
  /** Spendable balance in cents. Always > 0 when this object exists. */
  balanceCents: number
  /** The most recent mint, when the ledger holds one. */
  latestEarned: {
    amountCents: number
    /** The author's own look that was booked. Null if it has since been removed. */
    lookName: string | null
    /** `@handle` of the booker, or null when they are not publicly addressable. */
    bookerHandle: string | null
    earnedAt: Date
  } | null
}

/**
 * The client's credit standing for the activity banner, or null when there is
 * nothing to show.
 *
 * Null on a zero balance, deliberately: "$0.00 banked" under a currency glyph is
 * the `incentiveLabel` bug again — a bright empty promise. A client who has
 * earned nothing, and one who has spent everything, both correctly see no
 * banner at all.
 *
 * Booker identity follows the activity feed's PII rule exactly: named only when
 * publicly addressable (`isPublicProfile` AND a handle), never by legal name.
 * The designer's §7 left "who is named to whom" open; this is the answer the
 * rest of the surface already gives.
 */
export async function getClientCreditSummary(
  db: CreditDb,
  clientIdInput: string,
): Promise<ClientCreditSummary | null> {
  const clientId = normalizeRequiredId('clientId', clientIdInput)

  const balanceCents = await getClientCreditBalanceCents(db, clientId)
  if (balanceCents <= 0) return null

  const latest = await db.clientCreditEntry.findFirst({
    where: {
      clientId,
      kind: ClientCreditEntryKind.EARNED_LOOK_BOOKING,
      status: ClientCreditEntryStatus.APPLIED,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      amount: true,
      createdAt: true,
      sourceLookPost: { select: { caption: true } },
      booking: {
        select: { client: { select: { handle: true, isPublicProfile: true } } },
      },
    },
  })

  if (!latest) {
    // A positive balance with no mint behind it is not reachable — credit only
    // enters the ledger as an EARNED row — so this is a defensive null rather
    // than a state to render.
    return { balanceCents, latestEarned: null }
  }

  const booker = latest.booking.client
  const handle =
    booker.isPublicProfile && booker.handle ? booker.handle : null

  return {
    balanceCents,
    latestEarned: {
      amountCents: Math.max(0, decimalToCents(latest.amount) ?? 0),
      // The caller turns the caption into a name — `lookNameFromCaption` lives
      // in the looks module and this one stays free of that dependency.
      lookName: latest.sourceLookPost?.caption ?? null,
      bookerHandle: handle,
      earnedAt: latest.createdAt,
    },
  }
}
