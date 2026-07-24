// app/api/v1/client/bookings/[id]/checkout/stripe-session/route.ts

import type { NextRequest } from 'next/server'
import {
  PaymentMethod,
  PaymentProvider,
  Prisma,
  Role,
} from '@prisma/client'

import { jsonFail, requireClient } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { safeError } from '@/lib/security/logging'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  prepareClientStripeCheckoutSession,
  recordStripeCheckoutSessionAttached,
} from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { getStripe } from '@/lib/stripe/server'
import { parseTipAmount } from '@/lib/money'
import type { CheckoutStripeSessionResponseDTO } from '@/lib/dto/checkout'
import {
  buildCheckoutReturnUrl,
  isNativeCheckoutReturn,
} from '@/lib/checkout/nativeReturn'
import { stripeExpandedId } from '@/lib/stripe/expandable'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION =
  'POST /api/v1/client/bookings/[id]/checkout/stripe-session'

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildIdempotencyRequestBody(args: {
  bookingId: string
  clientId: string
  actorUserId: string
  tipAmount: string | null | undefined
}): JsonObjectPayload {
  return {
    bookingId: args.bookingId,
    clientId: args.clientId,
    actorUserId: args.actorUserId,
    provider: PaymentProvider.STRIPE,
    method: PaymentMethod.STRIPE_CARD,
    tipAmountProvided: args.tipAmount !== undefined,
    tipAmount: args.tipAmount ?? null,
  }
}

function buildStripeApiIdempotencyKey(args: {
  bookingId: string
  idempotencyKey: string
}): string {
  return `tovis:stripe-session:${args.bookingId}:${args.idempotencyKey}`
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export async function POST(req: NextRequest, props: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const actorUserId = trimmedString(auth.user?.id)

    if (!actorUserId) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to create Stripe checkout.',
      })
    }

    const { id } = await resolveRouteParams(props)
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isObject(rawBody) ? rawBody : {}

    const parsedTip = parseTipAmount(body.tipAmount)
    if (!parsedTip.ok) {
      return jsonFail(400, parsedTip.error)
    }

    const native = isNativeCheckoutReturn(req)

    return await withRouteIdempotency<JsonObjectPayload>(
      {
        request: req,
        actor: {
          actorUserId,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.CLIENT_CHECKOUT_STRIPE_SESSION,
        requestLabel: 'client Stripe checkout session',
        requestBody: buildIdempotencyRequestBody({
          bookingId,
          clientId: auth.clientId,
          actorUserId,
          tipAmount: parsedTip.tipAmount,
        }),
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress:
            'A matching Stripe checkout request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: ROUTE_OPERATION,
      },
      async (idem) => {
        const prepared = await prepareClientStripeCheckoutSession({
          bookingId,
          clientId: auth.clientId,
          tipAmount: parsedTip.tipAmount,
          requestId: null,
          idempotencyKey: idem.idempotencyKey,
        })

        const stripe = getStripe()

        const stripeApiIdempotencyKey = buildStripeApiIdempotencyKey({
          bookingId,
          idempotencyKey: idem.idempotencyKey,
        })

        const session = await stripe.checkout.sessions.create(
          {
            mode: 'payment',
            payment_method_types: ['card'],
            client_reference_id: prepared.booking.id,
            success_url: buildCheckoutReturnUrl({
              bookingId: prepared.booking.id,
              status: 'success',
              kind: 'checkout',
              native,
            }),
            cancel_url: buildCheckoutReturnUrl({
              bookingId: prepared.booking.id,
              status: 'cancelled',
              kind: 'checkout',
              native,
            }),
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: prepared.stripe.currency.toLowerCase(),
                  unit_amount: prepared.stripe.amountCents,
                  product_data: {
                    name: prepared.stripe.lineItemDescription,
                  },
                },
              },
            ],
            metadata: {
              bookingId: prepared.booking.id,
              clientId: auth.clientId,
              professionalId: prepared.booking.professionalId,
            },
            payment_intent_data: {
              metadata: {
                bookingId: prepared.booking.id,
                clientId: auth.clientId,
                professionalId: prepared.booking.professionalId,
              },
              transfer_data: {
                destination: prepared.stripe.connectedAccountId,
              },
            },
          },
          { idempotencyKey: stripeApiIdempotencyKey },
        )

        const stripePaymentIntentId = stripeExpandedId(
          session.payment_intent,
        )

        const attached = await recordStripeCheckoutSessionAttached({
          bookingId: prepared.booking.id,
          clientId: auth.clientId,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId,
          stripeConnectedAccountId: prepared.stripe.connectedAccountId,
          stripeAmountSubtotal:
            typeof session.amount_subtotal === 'number'
              ? session.amount_subtotal
              : prepared.stripe.amountCents,
          stripeAmountTotal:
            typeof session.amount_total === 'number'
              ? session.amount_total
              : prepared.stripe.amountCents,
          stripeCurrency:
            typeof session.currency === 'string'
              ? session.currency
              : prepared.stripe.currency,
          requestId: null,
          idempotencyKey: idem.idempotencyKey,
        })

        const responseBody: JsonObjectPayload = {
          booking: {
            id: attached.booking.id,
            checkoutStatus: attached.booking.checkoutStatus,
            selectedPaymentMethod: attached.booking.selectedPaymentMethod,
            paymentProvider: attached.booking.paymentProvider,
            stripeCheckoutSessionId: attached.booking.stripeCheckoutSessionId,
            stripePaymentIntentId: attached.booking.stripePaymentIntentId,
            stripeCheckoutSessionStatus:
              attached.booking.stripeCheckoutSessionStatus,
            stripePaymentStatus: attached.booking.stripePaymentStatus,
            stripeAmountTotal: attached.booking.stripeAmountTotal,
            stripeCurrency: attached.booking.stripeCurrency,
            tipAmount: prepared.booking.tipAmount?.toString() ?? null,
            totalAmount: prepared.booking.totalAmount?.toString() ?? null,
          },
          stripeCheckout: {
            sessionId: session.id,
            url: nullableString(session.url),
          },
        } satisfies CheckoutStripeSessionResponseDTO

        return { status: 200, body: responseBody }
      },
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
    }

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

    console.error(`${ROUTE_OPERATION} error`, { error: safeError(error) })

    captureBookingException({
      error,
      route: ROUTE_OPERATION,
    })

    return jsonFail(500, 'Failed to create Stripe checkout session.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}