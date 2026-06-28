// app/api/v1/client/bookings/[id]/deposit/stripe-session/route.ts
//
// Creates a Stripe Checkout Session for a brand-new client's discovery deposit +
// one-time platform fee. This is the ONLY charge that carries the platform fee — it
// rides as the Stripe application fee on a destination charge to the pro. Distinct
// from the post-service client checkout (which has no fee and is aftercare-gated).

import type { NextRequest } from 'next/server'
import { PaymentMethod, PaymentProvider, Prisma, Role } from '@prisma/client'

import { jsonFail, requireClient } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { isBookingError } from '@/lib/booking/errors'
import { safeError } from '@/lib/security/logging'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  DISCOVERY_DEPOSIT_CHECKOUT_KIND,
  prepareClientDepositCheckout,
  recordDepositCheckoutAttached,
} from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { getStripe } from '@/lib/stripe/server'
import type { DepositStripeSessionResponseDTO } from '@/lib/dto/checkout'
import {
  buildCheckoutReturnUrl,
  isNativeCheckoutReturn,
} from '@/lib/checkout/nativeReturn'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION = 'POST /api/v1/client/bookings/[id]/deposit/stripe-session'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObjectPayload = { [key: string]: JsonValue }

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function buildStripeApiIdempotencyKey(args: {
  bookingId: string
  idempotencyKey: string
}): string {
  return `tovis:deposit-session:${args.bookingId}:${args.idempotencyKey}`
}

function getSessionPaymentIntentId(
  paymentIntent: string | { id?: string } | null | undefined,
): string | null {
  if (!paymentIntent) return null
  if (typeof paymentIntent === 'string') return paymentIntent
  return typeof paymentIntent.id === 'string' ? paymentIntent.id : null
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
        userMessage: 'You are not allowed to create a deposit checkout.',
      })
    }

    const { id } = await resolveRouteParams(props)
    const bookingId = trimmedString(id)
    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const native = isNativeCheckoutReturn(req)

    return await withRouteIdempotency<JsonObjectPayload>(
      {
        request: req,
        actor: { actorUserId, actorRole: Role.CLIENT },
        route: IDEMPOTENCY_ROUTES.CLIENT_DEPOSIT_STRIPE_SESSION,
        requestLabel: 'client deposit checkout session',
        requestBody: {
          bookingId,
          clientId: auth.clientId,
          actorUserId,
          provider: PaymentProvider.STRIPE,
          method: PaymentMethod.STRIPE_CARD,
          kind: DISCOVERY_DEPOSIT_CHECKOUT_KIND,
        },
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress: 'A matching deposit checkout request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: ROUTE_OPERATION,
      },
      async (idem) => {
        const prepared = await prepareClientDepositCheckout({
          bookingId,
          clientId: auth.clientId,
          requestId: null,
          idempotencyKey: idem.idempotencyKey,
        })

        const stripe = getStripe()

        const session = await stripe.checkout.sessions.create(
          {
            mode: 'payment',
            payment_method_types: ['card'],
            client_reference_id: prepared.booking.id,
            success_url: buildCheckoutReturnUrl({
              bookingId: prepared.booking.id,
              status: 'success',
              kind: 'deposit',
              native,
            }),
            cancel_url: buildCheckoutReturnUrl({
              bookingId: prepared.booking.id,
              status: 'cancelled',
              kind: 'deposit',
              native,
            }),
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: prepared.stripe.currency.toLowerCase(),
                  unit_amount: prepared.stripe.totalCents,
                  product_data: {
                    name: `Deposit + booking fee — ${prepared.stripe.lineItemDescription}`,
                  },
                },
              },
            ],
            metadata: {
              bookingId: prepared.booking.id,
              clientId: auth.clientId,
              professionalId: prepared.booking.professionalId,
              kind: DISCOVERY_DEPOSIT_CHECKOUT_KIND,
            },
            payment_intent_data: {
              // The platform keeps the one-time fee; the deposit settles to the pro.
              application_fee_amount: prepared.stripe.feeCents,
              transfer_data: {
                destination: prepared.stripe.connectedAccountId,
              },
              metadata: {
                bookingId: prepared.booking.id,
                clientId: auth.clientId,
                professionalId: prepared.booking.professionalId,
                kind: DISCOVERY_DEPOSIT_CHECKOUT_KIND,
                depositCents: String(prepared.stripe.depositCents),
                feeCents: String(prepared.stripe.feeCents),
              },
            },
          },
          { idempotencyKey: buildStripeApiIdempotencyKey({ bookingId, idempotencyKey: idem.idempotencyKey }) },
        )

        await recordDepositCheckoutAttached({
          bookingId: prepared.booking.id,
          clientId: auth.clientId,
          stripePaymentIntentId: getSessionPaymentIntentId(session.payment_intent),
        })

        const responseBody: JsonObjectPayload = {
          booking: { id: prepared.booking.id },
          deposit: {
            depositCents: prepared.stripe.depositCents,
            feeCents: prepared.stripe.feeCents,
            totalCents: prepared.stripe.totalCents,
            currency: prepared.stripe.currency,
          },
          stripeCheckout: {
            sessionId: session.id,
            url: nullableString(session.url),
          },
        } satisfies DepositStripeSessionResponseDTO

        return { status: 200, body: responseBody }
      },
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return jsonFail(400, 'Database rejected the deposit checkout update.', {
        code: error.code,
        detail: error.message,
      })
    }

    console.error(`${ROUTE_OPERATION} error`, { error: safeError(error) })
    captureBookingException({ error, route: ROUTE_OPERATION })

    return jsonFail(500, 'Failed to create deposit checkout session.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
