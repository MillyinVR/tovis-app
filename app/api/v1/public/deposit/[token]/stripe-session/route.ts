// app/api/v1/public/deposit/[token]/stripe-session/route.ts
//
// K10-B: public (no-login) Stripe checkout for a pro-created booking's deposit,
// authenticated by the DEPOSIT_PAYMENT ClientActionToken. Mirrors the authed
// /api/v1/client/bookings/[id]/deposit/stripe-session route but resolves the
// booking + client from the token instead of requireClient() — a pro-created
// client is often UNCLAIMED and structurally cannot log in. Reuses the same
// write-boundary prepare/record functions, so validation, the webhook's
// DISCOVERY_DEPOSIT metadata contract, and payment behaviour stay identical to
// the authed flow.

import { PaymentMethod, PaymentProvider, Prisma, Role } from '@prisma/client'

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
import {
  markDepositPaymentTokenUsed,
  resolveDepositPaymentTokenForMutation,
} from '@/lib/booking/depositPaymentTokens'
import { isBookingError } from '@/lib/booking/errors'
import {
  DISCOVERY_DEPOSIT_CHECKOUT_KIND,
  prepareClientDepositCheckout,
  recordDepositCheckoutAttached,
} from '@/lib/booking/writeBoundary'
import type { DepositStripeSessionResponseDTO } from '@/lib/dto/checkout'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { tokenActorRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'
import { stripeExpandedId } from '@/lib/stripe/expandable'
import { getStripe } from '@/lib/stripe/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/v1/public/deposit/[token]/stripe-session'

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
 * Unclaimed clients return to the PUBLIC deposit page (not the authed booking
 * page, which would bounce them to /login).
 */
function buildPublicDepositReturnUrl(
  rawToken: string,
  status: 'success' | 'cancelled',
): string {
  const url = new URL(
    `/client/deposit/${encodeURIComponent(rawToken)}`,
    getAppUrl(),
  )
  url.searchParams.set('checkout', status)
  return url.toString()
}

function buildStripeApiIdempotencyKey(args: {
  bookingId: string
  idempotencyKey: string
}): string {
  // Same key family as the authed deposit route: both create the SAME logical
  // Stripe session for this booking's deposit, so a client who has both
  // surfaces open cannot mint two competing PaymentIntents for one deposit.
  return `tovis:deposit-session:${args.bookingId}:${args.idempotencyKey}`
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export async function POST(req: Request, ctx: RouteContext<{ token: string }>) {
  try {
    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return bookingJsonFail('DEPOSIT_TOKEN_MISSING', {
        message: 'Deposit payment token is missing from route params.',
        userMessage: 'That payment link is invalid or expired.',
      })
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'client:deposit:token',
      key: tokenActorRateLimitKey({
        actorKey: rawToken,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const resolved = await resolveDepositPaymentTokenForMutation({ rawToken })

    const bookingId = resolved.booking.id
    const clientId = resolved.booking.clientId

    return await withRouteIdempotency<JsonObjectPayload>(
      {
        request: req,
        actor: {
          actorKey: resolved.idempotencyActorKey,
          actorRole: Role.CLIENT,
        },
        route: IDEMPOTENCY_ROUTES.PUBLIC_DEPOSIT_STRIPE_SESSION,
        requestLabel: 'public deposit checkout session',
        requestBody: {
          depositTokenId: resolved.token.id,
          bookingId,
          clientId,
          provider: PaymentProvider.STRIPE,
          method: PaymentMethod.STRIPE_CARD,
          kind: DISCOVERY_DEPOSIT_CHECKOUT_KIND,
        },
        messages: {
          missingKey: 'Missing idempotency key.',
          inProgress:
            'A matching deposit checkout request is already in progress.',
          conflict:
            'This idempotency key was already used with a different request body.',
        },
        operation: ROUTE_OPERATION,
      },
      async (idem) => {
        const prepared = await prepareClientDepositCheckout({
          bookingId,
          clientId,
          requestId: null,
          idempotencyKey: idem.idempotencyKey,
        })

        const stripe = getStripe()

        const session = await stripe.checkout.sessions.create(
          {
            mode: 'payment',
            payment_method_types: ['card'],
            client_reference_id: prepared.booking.id,
            success_url: buildPublicDepositReturnUrl(rawToken, 'success'),
            cancel_url: buildPublicDepositReturnUrl(rawToken, 'cancelled'),
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: prepared.stripe.currency.toLowerCase(),
                  unit_amount: prepared.stripe.totalCents,
                  product_data: {
                    // Fee can be 0 (pro-created deposits carry none) — don't
                    // bill a "booking fee" the client isn't paying.
                    name:
                      prepared.stripe.feeCents > 0
                        ? `Deposit + booking fee — ${prepared.stripe.lineItemDescription}`
                        : `Deposit — ${prepared.stripe.lineItemDescription}`,
                  },
                },
              },
            ],
            metadata: {
              bookingId: prepared.booking.id,
              clientId,
              professionalId: prepared.booking.professionalId,
              kind: DISCOVERY_DEPOSIT_CHECKOUT_KIND,
            },
            payment_intent_data: {
              // Both platform fees ride the application fee — the client's
              // convenience fee and the pro's $5 (which comes out of the pro's
              // payout, not the customer's charge). See the client-authenticated
              // twin route for the full reasoning.
              ...(prepared.stripe.applicationFeeCents > 0
                ? { application_fee_amount: prepared.stripe.applicationFeeCents }
                : {}),
              transfer_data: {
                destination: prepared.stripe.connectedAccountId,
              },
              metadata: {
                bookingId: prepared.booking.id,
                clientId,
                professionalId: prepared.booking.professionalId,
                kind: DISCOVERY_DEPOSIT_CHECKOUT_KIND,
                depositCents: String(prepared.stripe.depositCents),
                feeCents: String(prepared.stripe.feeCents),
                proFeeCents: String(prepared.stripe.proFeeCents),
              },
            },
          },
          {
            idempotencyKey: buildStripeApiIdempotencyKey({
              bookingId,
              idempotencyKey: idem.idempotencyKey,
            }),
          },
        )

        await recordDepositCheckoutAttached({
          bookingId: prepared.booking.id,
          clientId,
          stripePaymentIntentId: stripeExpandedId(session.payment_intent),
        })

        // Usage telemetry only (the token is not single-use); recorded after
        // the session is attached so a refused prepare never counts as a use.
        await markDepositPaymentTokenUsed({ tokenId: resolved.token.id })

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
      return bookingErrorJsonFail(error)
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
