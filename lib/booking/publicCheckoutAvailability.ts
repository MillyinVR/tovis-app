// lib/booking/publicCheckoutAvailability.ts
//
// Read-only helper for the PUBLIC aftercare page to decide whether to show the
// "Complete payment" action to an unclaimed client. The gates mirror
// performLockedPrepareClientStripeCheckoutSession() so the button only appears
// when a checkout would actually succeed.

import {
  BookingCheckoutStatus,
  BookingStatus,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type PublicCheckoutAvailability =
  | {
      status: 'PAYABLE'
      amountCents: number | null
      currency: string | null
    }
  | { status: 'ALREADY_PAID' }
  | { status: 'NOT_AVAILABLE' }

type Db = Prisma.TransactionClient | typeof prisma

function decimalToCents(value: Prisma.Decimal | null | undefined): number | null {
  if (value == null) return null
  return Math.round(Number(value) * 100)
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
      paymentCollectedAt: true,
      stripePaymentStatus: true,
      totalAmount: true,
      stripeCurrency: true,
      aftercareSummary: { select: { sentToClientAt: true } },
      professional: {
        select: {
          paymentSettings: {
            select: {
              acceptStripeCard: true,
              stripeChargesEnabled: true,
            },
          },
        },
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

  // Same prerequisites the prepare boundary enforces.
  if (booking.status === BookingStatus.CANCELLED) {
    return { status: 'NOT_AVAILABLE' }
  }

  if (!booking.aftercareSummary?.sentToClientAt) {
    return { status: 'NOT_AVAILABLE' }
  }

  const paymentSettings = booking.professional?.paymentSettings
  if (
    !paymentSettings?.acceptStripeCard ||
    !paymentSettings.stripeChargesEnabled
  ) {
    return { status: 'NOT_AVAILABLE' }
  }

  const amountCents = decimalToCents(booking.totalAmount)
  if (amountCents == null || amountCents <= 0) {
    return { status: 'NOT_AVAILABLE' }
  }

  return {
    status: 'PAYABLE',
    amountCents,
    currency: booking.stripeCurrency ?? 'usd',
  }
}
