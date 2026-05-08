import type { NextRequest } from 'next/server'
import {
  PaymentMethod,
  PaymentProvider,
  Prisma,
  Role,
} from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import {
  prepareClientStripeCheckoutSession,
  recordStripeCheckoutSessionAttached,
} from '@/lib/booking/writeBoundary'
import { getStripe } from '@/lib/stripe/server'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

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

type ParsedBody =
  | { ok: true; tipAmount: string | null | undefined }
  | { ok: false; error: string }

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

  return normalizeBaseUrl(
    appUrl.startsWith('http') ? appUrl : `https://${appUrl}`,
  )
}

function buildAftercareCheckoutReturnUrl(
  bookingId: string,
  status: 'success' | 'cancelled',
): string {
  const url = new URL(
    `/client/bookings/${encodeURIComponent(bookingId)}`,
    getAppUrl(),
  )

  url.searchParams.set('step', 'aftercare')
  url.searchParams.set('checkout', status)

  return url.toString()
}

function parseTipAmount(value: unknown): ParsedBody {
  if (value === undefined) return { ok: true, tipAmount: undefined }
  if (value === null) return { ok: true, tipAmount: null }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: 'tipAmount must be a non-negative number.' }
    }
    return { ok: true, tipAmount: value.toFixed(2) }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return { ok: true, tipAmount: null }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: 'tipAmount must be a non-negative amount.' }
    }
    return { ok: true, tipAmount: parsed.toFixed(2) }
  }

  return { ok: false, error: 'tipAmount must be a number, string, or null.' }
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

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: { message?: string; userMessage?: string },
): Response {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(
    409,
    'A matching Stripe checkout request is already in progress.',
    { code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS' },
  )
}

function idempotencyConflictFail(): Response {
  return jsonFail(
    409,
    'This idempotency key was already used with a different request body.',
    { code: 'IDEMPOTENCY_KEY_CONFLICT' },
  )
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
  paymentIntent: string | { id?: string } | null | undefined,
): string | null {
  if (!paymentIntent) return null
  if (typeof paymentIntent === 'string') return paymentIntent
  return typeof paymentIntent.id === 'string' ? paymentIntent.id : null
}

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
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: Record<string, unknown> = isObject(rawBody) ? rawBody : {}
    const parsedTip = parseTipAmount(body.tipAmount)
    if (!parsedTip.ok) {
      return jsonFail(400, parsedTip.error)
    }

    const idempotencyKey = readIdempotencyKey(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_CHECKOUT_STRIPE_SESSION,
      key: idempotencyKey,
      requestBody: buildIdempotencyRequestBody({
        bookingId,
        clientId: auth.clientId,
        actorUserId,
        tipAmount: parsedTip.tipAmount,
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

    const prepared = await prepareClientStripeCheckoutSession({
      bookingId,
      clientId: auth.clientId,
      tipAmount: parsedTip.tipAmount,
      requestId: null,
      idempotencyKey,
    })

    const stripe = getStripe()

    // Stripe-side idempotency key — defense-in-depth in case our ledger is
    // bypassed for any reason. Same client key + same booking always maps to
    // the same Stripe session.
    const stripeApiIdempotencyKey =
      idempotencyKey != null
        ? buildStripeApiIdempotencyKey({ bookingId, idempotencyKey })
        : undefined

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        client_reference_id: prepared.booking.id,
        success_url: buildAftercareCheckoutReturnUrl(
          prepared.booking.id,
          'success',
        ),
        cancel_url: buildAftercareCheckoutReturnUrl(
          prepared.booking.id,
          'cancelled',
        ),
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
      stripeApiIdempotencyKey
        ? { idempotencyKey: stripeApiIdempotencyKey }
        : undefined,
    )

    const stripePaymentIntentId = getSessionPaymentIntentId(
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
      idempotencyKey,
    })

    const responseBody: JsonObjectPayload = {
      booking: {
        id: attached.booking.id,
        checkoutStatus: attached.booking.checkoutStatus,
        selectedPaymentMethod: attached.booking.selectedPaymentMethod,
        paymentProvider: attached.booking.paymentProvider,
        stripeCheckoutSessionId: attached.booking.stripeCheckoutSessionId,
        stripePaymentIntentId: attached.booking.stripePaymentIntentId,
        stripeCheckoutSessionStatus: attached.booking.stripeCheckoutSessionStatus,
        stripePaymentStatus: attached.booking.stripePaymentStatus,
        stripeAmountTotal: attached.booking.stripeAmountTotal,
        stripeCurrency: attached.booking.stripeCurrency,
        tipAmount: prepared.booking.tipAmount?.toString() ?? null,
        totalAmount: prepared.booking.totalAmount?.toString() ?? null,
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

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
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

    console.error(
      'POST /api/client/bookings/[id]/checkout/stripe-session error',
      error,
    )

    captureBookingException({
      error,
      route: 'POST /api/client/bookings/[id]/checkout/stripe-session',
    })

    return jsonFail(500, 'Failed to create Stripe checkout session.', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
