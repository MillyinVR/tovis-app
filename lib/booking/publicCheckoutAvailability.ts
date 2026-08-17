// lib/booking/publicCheckoutAvailability.ts
//
// Read-only helper for the PUBLIC aftercare page to decide what an unclaimed
// client can pay with. The gates mirror the write boundaries the two public
// checkout routes enforce, so an affordance only appears when the write behind
// it would actually succeed.
//
// This used to gate the whole surface on Stripe: unless the pro had a chargeable
// connected account, it returned NOT_AVAILABLE and the page rendered no way to
// pay at all. For a pro who takes Venmo/Zelle/cash and has never touched Stripe
// — the common case — the client was simply shown nothing, then had to create an
// account to discover the pro's methods were there all along. Stripe is now one
// option among the pro's accepted methods rather than the price of entry.

import {
  BookingCheckoutStatus,
  BookingStatus,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'

import type { ClientBookingPaymentOptionsDTO } from '@/lib/dto/clientBooking'
import {
  buildClientPaymentOptions,
  clientPaymentOptionsSelect,
} from '@/lib/payments/clientPaymentOptions'
import { resolveChargeCurrency } from '@/lib/payments/resolveChargeCurrency'
import { prisma } from '@/lib/prisma'

export type PublicCheckoutAmounts = {
  serviceSubtotal: string | null
  productSubtotal: string | null
  tipAmount: string | null
  taxAmount: string | null
  discountAmount: string | null
  totalAmount: string | null
  /** Total in minor units, for the Stripe-only summary. Null when unset. */
  amountCents: number | null
  currency: string | null
}

export type PublicCheckoutAvailability =
  | {
      status: 'PAYABLE'
      checkoutStatus: BookingCheckoutStatus
      selectedPaymentMethod: string | null
      amounts: PublicCheckoutAmounts
      /** The pro's client-selectable methods + tip config. */
      paymentOptions: ClientBookingPaymentOptionsDTO
    }
  | { status: 'ALREADY_PAID' }
  | { status: 'AWAITING_CONFIRMATION' }
  | { status: 'NOT_AVAILABLE' }

type Db = Prisma.TransactionClient | typeof prisma

function decimalToCents(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) return null
  return Math.round(Number(value) * 100)
}

function decimalToString(
  value: Prisma.Decimal | null | undefined,
): string | null {
  return value == null ? null : value.toString()
}

export async function getPublicCheckoutAvailability(args: {
  bookingId: string
  clientId: string
  tx?: Db
}): Promise<PublicCheckoutAvailability> {
  const db = args.tx ?? prisma

  const booking = await db.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      clientId: true,
      status: true,
      checkoutStatus: true,
      selectedPaymentMethod: true,
      paymentCollectedAt: true,
      stripePaymentStatus: true,
      serviceSubtotalSnapshot: true,
      productSubtotalSnapshot: true,
      tipAmount: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      stripeCurrency: true,
      aftercareSummary: { select: { sentToClientAt: true } },
      professional: {
        select: { paymentSettings: { select: clientPaymentOptionsSelect } },
      },
    },
  })

  if (!booking || booking.clientId !== args.clientId) {
    return { status: 'NOT_AVAILABLE' }
  }

  // Already settled.
  if (
    booking.checkoutStatus === BookingCheckoutStatus.PAID ||
    booking.checkoutStatus === BookingCheckoutStatus.WAIVED ||
    booking.paymentCollectedAt != null ||
    booking.stripePaymentStatus === StripePaymentStatus.SUCCEEDED
  ) {
    return { status: 'ALREADY_PAID' }
  }

  // The client already attested an off-platform payment; the pro owes them a
  // receipt confirmation. Re-offering the pay controls here would invite a
  // second payment for the same booking.
  if (booking.checkoutStatus === BookingCheckoutStatus.AWAITING_CONFIRMATION) {
    return { status: 'AWAITING_CONFIRMATION' }
  }

  // Same prerequisites the prepare boundary enforces.
  if (booking.status === BookingStatus.CANCELLED) {
    return { status: 'NOT_AVAILABLE' }
  }

  if (!booking.aftercareSummary?.sentToClientAt) {
    return { status: 'NOT_AVAILABLE' }
  }

  const amountCents = decimalToCents(booking.totalAmount)
  if (amountCents == null || amountCents <= 0) {
    return { status: 'NOT_AVAILABLE' }
  }

  // buildClientPaymentOptions gates Stripe to "actually chargeable" and drops
  // the pro-run card rails, so what comes back is exactly what this client may
  // choose. A pro with no settings row still yields Cash, so the page is never
  // dead — the failure this whole helper existed to cause.
  const paymentOptions = buildClientPaymentOptions(
    booking.professional?.paymentSettings ?? null,
  )

  if (paymentOptions.methods.length === 0) {
    return { status: 'NOT_AVAILABLE' }
  }

  return {
    status: 'PAYABLE',
    checkoutStatus: booking.checkoutStatus,
    selectedPaymentMethod: booking.selectedPaymentMethod,
    amounts: {
      serviceSubtotal: decimalToString(booking.serviceSubtotalSnapshot),
      productSubtotal: decimalToString(booking.productSubtotalSnapshot),
      tipAmount: decimalToString(booking.tipAmount),
      taxAmount: decimalToString(booking.taxAmount),
      discountAmount: decimalToString(booking.discountAmount),
      totalAmount: decimalToString(booking.totalAmount),
      amountCents,
      currency: resolveChargeCurrency(booking.stripeCurrency),
    },
    paymentOptions,
  }
}
