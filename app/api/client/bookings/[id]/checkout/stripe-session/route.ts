import type { NextRequest } from 'next/server'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  PaymentProvider,
  Prisma,
  StripeCheckoutSessionStatus,
  StripePaymentStatus,
  Role,
} from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe/server'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'

export const dynamic = 'force-dynamic'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

type JsonObjectPayload = {
  [key: string]: JsonValue
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readIdempotencyKey(req: NextRequest): string | null {
  return (
    trimmedString(req.headers.get('idempotency-key')) ??
    trimmedString(req.headers.get('x-idempotency-key')) ??
    null
  )
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function getAppUrl(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.VERCEL_URL

  if (!appUrl) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL, APP_URL, or VERCEL_URL is required to create Stripe checkout sessions.',
    )
  }

  return normalizeBaseUrl(appUrl.startsWith('http') ? appUrl : `https://${appUrl}`)
}

function buildSuccessUrl(bookingId: string): string {
  const explicit = process.env.STRIPE_CHECKOUT_SUCCESS_URL

  if (explicit) {
    return explicit.replace('{BOOKING_ID}', encodeURIComponent(bookingId))
  }

  return `${getAppUrl()}/client/bookings/${encodeURIComponent(
    bookingId,
  )}/checkout/success`
}

function buildCancelUrl(bookingId: string): string {
  const explicit = process.env.STRIPE_CHECKOUT_CANCEL_URL

  if (explicit) {
    return explicit.replace('{BOOKING_ID}', encodeURIComponent(bookingId))
  }

  return `${getAppUrl()}/client/bookings/${encodeURIComponent(
    bookingId,
  )}/checkout`
}

function decimalToCents(value: Prisma.Decimal | null): number | null {
  if (!value) return null

  const amount = value.toNumber()
  if (!Number.isFinite(amount)) return null

  return Math.round(amount * 100)
}

function buildIdempotencyRequestBody(args: {
  bookingId: string
  clientId: string
  actorUserId: string
}): JsonObjectPayload {
  return {
    bookingId: args.bookingId,
    clientId: args.clientId,
    actorUserId: args.actorUserId,
    provider: PaymentProvider.STRIPE,
    method: PaymentMethod.STRIPE_CARD,
  }
}

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(409, 'A matching Stripe checkout request is already in progress.', {
    code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  })
}

function idempotencyConflictFail(): Response {
  return jsonFail(409, 'This idempotency key was already used with a different request body.', {
    code: 'IDEMPOTENCY_KEY_CONFLICT',
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((error) => {
    console.error(
      'POST /api/client/bookings/[id]/checkout/stripe-session idempotency failure update error:',
      error,
    )
  })
}

function getSessionPaymentIntentId(
  paymentIntent: string | { id?: string } | null,
): string | null {
  if (!paymentIntent) return null
  if (typeof paymentIntent === 'string') return paymentIntent
  return typeof paymentIntent.id === 'string' ? paymentIntent.id : null
}

const bookingSelect = {
  id: true,
  clientId: true,
  professionalId: true,
  status: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  totalAmount: true,
  subtotalSnapshot: true,
  tipAmount: true,
  stripeCheckoutSessionId: true,
  stripePaymentIntentId: true,
  professional: {
    select: {
      paymentSettings: {
        select: {
          acceptStripeCard: true,
          stripeAccountId: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
        },
      },
    },
  },
  service: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.BookingSelect

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const actorUserId = auth.user.id
    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return jsonFail(400, 'Booking id is required.', {
        code: 'BOOKING_ID_REQUIRED',
      })
    }

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_CHECKOUT_CONFIRM,
      key: readIdempotencyKey(req),
      requestBody: buildIdempotencyRequestBody({
        bookingId,
        clientId: auth.clientId,
        actorUserId,
      }),
    })

    if (idempotency.kind === 'missing_key') {
      return idempotencyMissingKeyFail()
    }

    if (idempotency.kind === 'in_progress') {
      return idempotencyInProgressFail()
    }

    if (idempotency.kind === 'conflict') {
      return idempotencyConflictFail()
    }

    if (idempotency.kind === 'replay') {
      return jsonOk(idempotency.responseBody, idempotency.responseStatus)
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: bookingSelect,
    })

    if (!booking) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(404, 'Booking not found.', {
        code: 'BOOKING_NOT_FOUND',
      })
    }

    if (booking.clientId !== auth.clientId) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(403, 'You are not allowed to check out this booking.', {
        code: 'FORBIDDEN',
      })
    }

    if (booking.checkoutStatus === BookingCheckoutStatus.PAID) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(409, 'This booking is already paid.', {
        code: 'BOOKING_ALREADY_PAID',
      })
    }

    if (booking.checkoutStatus === BookingCheckoutStatus.WAIVED) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(409, 'This booking checkout has been waived.', {
        code: 'BOOKING_CHECKOUT_WAIVED',
      })
    }

    const paymentSettings = booking.professional.paymentSettings

    if (!paymentSettings?.stripeAccountId) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(400, 'This provider has not connected Stripe yet.', {
        code: 'STRIPE_ACCOUNT_REQUIRED',
      })
    }

    if (
      !paymentSettings.acceptStripeCard ||
      !paymentSettings.stripeChargesEnabled ||
      !paymentSettings.stripePayoutsEnabled
    ) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(400, 'This provider is not ready to accept card payments.', {
        code: 'STRIPE_ACCOUNT_NOT_READY',
      })
    }

    const amountCents =
      decimalToCents(booking.totalAmount) ??
      decimalToCents(booking.subtotalSnapshot)

    if (!amountCents || amountCents <= 0) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(400, 'Booking total must be greater than zero.', {
        code: 'INVALID_PAYMENT_AMOUNT',
      })
    }

    const stripe = getStripe()

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      client_reference_id: booking.id,
      success_url: buildSuccessUrl(booking.id),
      cancel_url: buildCancelUrl(booking.id),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: booking.service.name
                ? `TOVIS booking: ${booking.service.name}`
                : `TOVIS booking ${booking.id}`,
            },
          },
        },
      ],
      metadata: {
        bookingId: booking.id,
        clientId: booking.clientId,
        professionalId: booking.professionalId,
      },
      payment_intent_data: {
        metadata: {
          bookingId: booking.id,
          clientId: booking.clientId,
          professionalId: booking.professionalId,
        },
        transfer_data: {
          destination: paymentSettings.stripeAccountId,
        },
      },
    })

    const stripePaymentIntentId = getSessionPaymentIntentId(
      session.payment_intent,
    )

    const updatedBooking = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentProvider: PaymentProvider.STRIPE,
        selectedPaymentMethod: PaymentMethod.STRIPE_CARD,
        checkoutStatus: BookingCheckoutStatus.READY,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId,
        stripeConnectedAccountId: paymentSettings.stripeAccountId,
        stripeCheckoutSessionStatus: StripeCheckoutSessionStatus.OPEN,
        stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
        stripeAmountSubtotal:
          typeof session.amount_subtotal === 'number'
            ? session.amount_subtotal
            : amountCents,
        stripeAmountTotal:
          typeof session.amount_total === 'number'
            ? session.amount_total
            : amountCents,
        stripeApplicationFeeAmount: null,
        stripeCurrency:
          typeof session.currency === 'string'
            ? session.currency.toUpperCase()
            : 'USD',
        stripeLastEventId: null,
      },
      select: {
        id: true,
        checkoutStatus: true,
        selectedPaymentMethod: true,
        paymentProvider: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
        stripeCheckoutSessionStatus: true,
        stripePaymentStatus: true,
        stripeAmountTotal: true,
        stripeCurrency: true,
      } satisfies Prisma.BookingSelect,
    })

    const responseBody: JsonObjectPayload = {
      booking: {
        id: updatedBooking.id,
        checkoutStatus: updatedBooking.checkoutStatus,
        selectedPaymentMethod: updatedBooking.selectedPaymentMethod,
        paymentProvider: updatedBooking.paymentProvider,
        stripeCheckoutSessionId: updatedBooking.stripeCheckoutSessionId,
        stripePaymentIntentId: updatedBooking.stripePaymentIntentId,
        stripeCheckoutSessionStatus:
          updatedBooking.stripeCheckoutSessionStatus,
        stripePaymentStatus: updatedBooking.stripePaymentStatus,
        stripeAmountTotal: updatedBooking.stripeAmountTotal,
        stripeCurrency: updatedBooking.stripeCurrency,
      },
      stripeCheckout: {
        sessionId: session.id,
        url: session.url,
      },
    }

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failStartedIdempotency(idempotencyRecordId)
    }

    console.error(
      'POST /api/client/bookings/[id]/checkout/stripe-session error',
      error,
    )

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonFail(400, 'Database rejected the Stripe checkout update.', {
        code: error.code,
        detail: error.message,
      })
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      return jsonFail(400, 'Invalid Stripe checkout update.', {
        detail: error.message,
      })
    }

    return jsonFail(500, 'Failed to create Stripe checkout session.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}