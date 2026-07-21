// app/api/v1/client/rebook/[token]/checkout/route.ts
//
// Public (no-login) Stripe checkout for unclaimed clients, authenticated by the
// AFTERCARE_ACCESS ClientActionToken. Mirrors the authed
// /api/v1/client/bookings/[id]/checkout/stripe-session route but resolves the
// booking + client from the aftercare token instead of requireClient(). Reuses
// the same write-boundary prepare/record functions, so payment behaviour and
// validation stay identical to the authed flow.

import { PaymentMethod, PaymentProvider, Role } from '@prisma/client'

import { jsonFail, pickString } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { resolveAftercareAccessTokenForMutation } from '@/lib/aftercare/aftercareAccessTokens'
import { isBookingError } from '@/lib/booking/errors'
import { safeError } from '@/lib/security/logging'
import {
  prepareClientStripeCheckoutSession,
  recordStripeCheckoutSessionAttached,
} from '@/lib/booking/writeBoundary'
import { isRecord } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { getStripe } from '@/lib/stripe/server'
import { parseTipAmount } from '@/lib/money'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/v1/client/rebook/[token]/checkout'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

type JsonObjectPayload = { [key: string]: JsonValue }


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

  return normalizeBaseUrl(
    appUrl.startsWith('http') ? appUrl : `https://${appUrl}`,
  )
}

/**
 * Unclaimed clients return to the PUBLIC aftercare page (not the authed booking
 * page, which would bounce them to /login).
 */
function buildPublicCheckoutReturnUrl(
  rawToken: string,
  status: 'success' | 'cancelled',
): string {
  const url = new URL(
    `/client/rebook/${encodeURIComponent(rawToken)}`,
    getAppUrl(),
  )
  url.searchParams.set('checkout', status)
  return url.toString()
}

function buildStripeApiIdempotencyKey(args: {
  bookingId: string
  idempotencyKey: string
}): string {
  return `tovis:public-stripe-session:${args.bookingId}:${args.idempotencyKey}`
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

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return bookingJsonFail('AFTERCARE_TOKEN_MISSING', {
        message: 'Aftercare access token is missing from route params.',
        userMessage: 'That payment link is invalid or expired.',
      })
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const parsedTip = parseTipAmount(body.tipAmount)
    if (!parsedTip.ok) {
      return jsonFail(400, parsedTip.error)
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'client:checkout:token',
      key: tokenActorRateLimitKey({
        actorKey: rawToken,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const resolved = await resolveAftercareAccessTokenForMutation({
      rawToken,
    })

    const bookingId = resolved.booking.id
    const clientId = resolved.booking.clientId

    return await withRouteIdempotency<JsonObjectPayload>(
      {
        request: req,
        actor: {
          actorKey: resolved.idempotencyActorKey,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.PUBLIC_AFTERCARE_CHECKOUT_STRIPE_SESSION,
        requestLabel: 'public aftercare Stripe checkout session',
        requestBody: {
          aftercareTokenId: resolved.token.id,
          bookingId,
          clientId,
          provider: PaymentProvider.STRIPE,
          method: PaymentMethod.STRIPE_CARD,
          tipAmountProvided: parsedTip.tipAmount !== undefined,
          tipAmount: parsedTip.tipAmount ?? null,
        },
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
          clientId,
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
            success_url: buildPublicCheckoutReturnUrl(rawToken, 'success'),
            cancel_url: buildPublicCheckoutReturnUrl(rawToken, 'cancelled'),
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
              clientId,
              professionalId: prepared.booking.professionalId,
            },
            payment_intent_data: {
              metadata: {
                bookingId: prepared.booking.id,
                clientId,
                professionalId: prepared.booking.professionalId,
              },
              transfer_data: {
                destination: prepared.stripe.connectedAccountId,
              },
            },
          },
          { idempotencyKey: stripeApiIdempotencyKey },
        )

        const stripePaymentIntentId = getSessionPaymentIntentId(
          session.payment_intent,
        )

        const attached = await recordStripeCheckoutSessionAttached({
          bookingId: prepared.booking.id,
          clientId,
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
            stripeCheckoutSessionId: attached.booking.stripeCheckoutSessionId,
            stripePaymentIntentId: attached.booking.stripePaymentIntentId,
            stripePaymentStatus: attached.booking.stripePaymentStatus,
            stripeAmountTotal: attached.booking.stripeAmountTotal,
            stripeCurrency: attached.booking.stripeCurrency,
            totalAmount: prepared.booking.totalAmount?.toString() ?? null,
          },
          stripeCheckout: {
            sessionId: session.id,
            url: nullableString(session.url),
          },
        }

        return { status: 200, body: responseBody }
      },
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingErrorJsonFail(error)
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
