// app/api/client/bookings/[id]/checkout/route.ts

import type { NextRequest } from 'next/server'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  Prisma,
  Role,
} from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { updateClientBookingCheckout } from '@/lib/booking/writeBoundary'
import { prisma } from '@/lib/prisma'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'

type ParsedBodyResult =
  | {
      ok: true
      tipAmount?: string | null
      selectedPaymentMethod?: PaymentMethod
      confirmPayment: boolean
    }
  | {
      ok: false
      error: string
    }

type RequestMeta = {
  idempotencyKey: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  return false
}

function normalizePaymentMethodInput(value: unknown): PaymentMethod | undefined {
  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (!normalized) return undefined

  switch (normalized) {
    case PaymentMethod.CASH:
      return PaymentMethod.CASH
    case PaymentMethod.CARD_ON_FILE:
      return PaymentMethod.CARD_ON_FILE
    case PaymentMethod.TAP_TO_PAY:
      return PaymentMethod.TAP_TO_PAY
    case PaymentMethod.VENMO:
      return PaymentMethod.VENMO
    case PaymentMethod.ZELLE:
      return PaymentMethod.ZELLE
    case PaymentMethod.APPLE_CASH:
      return PaymentMethod.APPLE_CASH
    case PaymentMethod.STRIPE_CARD:
      return PaymentMethod.STRIPE_CARD
    default:
      return undefined
  }
}

function parseTipAmount(value: unknown):
  | { ok: true; value?: string | null }
  | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: undefined }
  }

  if (value === null) {
    return { ok: true, value: null }
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: 'tipAmount must be a non-negative number.' }
    }

    return { ok: true, value: value.toFixed(2) }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed) {
      return { ok: true, value: null }
    }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: 'tipAmount must be a non-negative amount.' }
    }

    return { ok: true, value: parsed.toFixed(2) }
  }

  return { ok: false, error: 'tipAmount must be a number, string, or null.' }
}

function parseBody(body: Record<string, unknown>): ParsedBodyResult {
  const parsedTip = parseTipAmount(body.tipAmount)
  if (!parsedTip.ok) return parsedTip

  let selectedPaymentMethod: PaymentMethod | undefined = undefined
  if (body.selectedPaymentMethod !== undefined) {
    selectedPaymentMethod = normalizePaymentMethodInput(
      body.selectedPaymentMethod,
    )

    if (!selectedPaymentMethod) {
      return {
        ok: false,
        error:
          'selectedPaymentMethod must be one of: cash, card on file, tap to pay, Venmo, Zelle, Apple Cash, Stripe card.',
      }
    }
  }

  return {
    ok: true,
    tipAmount: parsedTip.value,
    selectedPaymentMethod,
    confirmPayment: parseBoolean(body.confirmPayment),
  }
}

function buildAcceptedPaymentMethods(
  settings:
        | {
            acceptCash: boolean
            acceptCardOnFile: boolean
            acceptTapToPay: boolean
            acceptVenmo: boolean
            acceptZelle: boolean
            acceptAppleCash: boolean
            acceptStripeCard: boolean
          }
    | null,
): Set<PaymentMethod> {
  const out = new Set<PaymentMethod>()

  if (!settings) return out

  if (settings.acceptCash) out.add(PaymentMethod.CASH)
  if (settings.acceptCardOnFile) out.add(PaymentMethod.CARD_ON_FILE)
  if (settings.acceptTapToPay) out.add(PaymentMethod.TAP_TO_PAY)
  if (settings.acceptVenmo) out.add(PaymentMethod.VENMO)
  if (settings.acceptZelle) out.add(PaymentMethod.ZELLE)
  if (settings.acceptAppleCash) out.add(PaymentMethod.APPLE_CASH)
  if (settings.acceptStripeCard) out.add(PaymentMethod.STRIPE_CARD)
  return out
}

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
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
    'A matching checkout request is already in progress.',
    {
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    },
  )
}

function idempotencyConflictFail(): Response {
  return jsonFail(
    409,
    'This idempotency key was already used with a different request body.',
    {
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    },
  )
}

function readRequestMeta(req: NextRequest): RequestMeta {
  const idempotencyKey =
    trimmedString(req.headers.get('idempotency-key')) ??
    trimmedString(req.headers.get('x-idempotency-key')) ??
    null

  return { idempotencyKey }
}

function normalizeNestedJsonValue(value: unknown): NestedInputJsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJsonValue(item))
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(input).sort()) {
      out[key] = normalizeNestedJsonValue(input[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const input = value as Record<string, unknown>
  const out: JsonObjectPayload = {}

  for (const key of Object.keys(input).sort()) {
    out[key] = normalizeNestedJsonValue(input[key])
  }

  return out
}

function buildIdempotencyRequestBody(args: {
  bookingId: string
  clientId: string
  actorUserId: string
  parsed: Extract<ParsedBodyResult, { ok: true }>
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    bookingId: args.bookingId,
    clientId: args.clientId,
    actorUserId: args.actorUserId,
    tipAmountProvided: args.parsed.tipAmount !== undefined,
    tipAmount: args.parsed.tipAmount ?? null,
    selectedPaymentMethodProvided:
      args.parsed.selectedPaymentMethod !== undefined,
    selectedPaymentMethod: args.parsed.selectedPaymentMethod ?? null,
    confirmPayment: args.parsed.confirmPayment,
  })
}

function buildCheckoutResponseBody(args: {
  result: Awaited<ReturnType<typeof updateClientBookingCheckout>>
}): JsonObjectPayload {
  const booking = args.result.booking

  return normalizeJsonObjectPayload({
    booking: {
      id: booking.id,
      checkoutStatus: booking.checkoutStatus,
      selectedPaymentMethod: booking.selectedPaymentMethod,
      serviceSubtotalSnapshot:
        booking.serviceSubtotalSnapshot?.toString() ?? null,
      productSubtotalSnapshot:
        booking.productSubtotalSnapshot?.toString() ?? null,
      subtotalSnapshot: booking.subtotalSnapshot?.toString() ?? null,
      tipAmount: booking.tipAmount?.toString() ?? null,
      taxAmount: booking.taxAmount?.toString() ?? null,
      discountAmount: booking.discountAmount?.toString() ?? null,
      totalAmount: booking.totalAmount?.toString() ?? null,
      paymentAuthorizedAt:
        booking.paymentAuthorizedAt?.toISOString() ?? null,
      paymentCollectedAt: booking.paymentCollectedAt?.toISOString() ?? null,
    },
    meta: args.result.meta,
  })
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((failError) => {
    console.error(
      'POST /api/client/bookings/[id]/checkout idempotency failure update error:',
      failError,
    )
  })
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

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to update this checkout.',
      })
    }

    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: Record<string, unknown> = isObject(rawBody) ? rawBody : {}

    const parsed = parseBody(body)
    if (!parsed.ok) {
      return jsonFail(400, parsed.error)
    }

    const requestMeta = readRequestMeta(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_CHECKOUT_CONFIRM,
      key: requestMeta.idempotencyKey,
      requestBody: buildIdempotencyRequestBody({
        bookingId,
        clientId: auth.clientId,
        actorUserId,
        parsed,
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
      select: {
        id: true,
        professionalId: true,
        selectedPaymentMethod: true,
      } satisfies Prisma.BookingSelect,
    })

    if (!booking) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null
      return bookingJsonFail('BOOKING_NOT_FOUND')
    }

    const paymentSettings = await prisma.professionalPaymentSettings.findUnique({
      where: { professionalId: booking.professionalId },
      select: {
        acceptCash: true,
        acceptCardOnFile: true,
        acceptTapToPay: true,
        acceptVenmo: true,
        acceptZelle: true,
        acceptAppleCash: true,
        acceptStripeCard: true,
        tipsEnabled: true,
      } satisfies Prisma.ProfessionalPaymentSettingsSelect,
    })

    const acceptedMethods = buildAcceptedPaymentMethods(paymentSettings)

    if (
      parsed.selectedPaymentMethod &&
      !acceptedMethods.has(parsed.selectedPaymentMethod)
    ) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(
        400,
        'That payment method is not enabled by this provider.',
      )
    }

    const effectivePaymentMethod =
      parsed.selectedPaymentMethod ?? booking.selectedPaymentMethod ?? null

    if (parsed.confirmPayment) {
      if (!effectivePaymentMethod) {
        await failStartedIdempotency(idempotencyRecordId)
        idempotencyRecordId = null

        return jsonFail(
          400,
          'Choose a payment method before confirming payment.',
        )
      }

      if (effectivePaymentMethod === PaymentMethod.STRIPE_CARD) {
        await failStartedIdempotency(idempotencyRecordId)
        idempotencyRecordId = null

        return jsonFail(
          400,
          'Card payments must be confirmed through Stripe checkout.',
          {
            code: 'STRIPE_CHECKOUT_REQUIRED',
          },
        )
      }
      if (!acceptedMethods.has(effectivePaymentMethod)) {
        await failStartedIdempotency(idempotencyRecordId)
        idempotencyRecordId = null

        return jsonFail(
          400,
          'That payment method is not enabled by this provider.',
        )
      }
    }

    if (
      paymentSettings?.tipsEnabled === false &&
      parsed.tipAmount !== undefined &&
      parsed.tipAmount !== null &&
      Number(parsed.tipAmount) > 0
    ) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(400, 'Tips are not enabled for this provider.')
    }

    const result = await updateClientBookingCheckout({
      bookingId,
      clientId: auth.clientId,
      tipAmount: parsed.tipAmount,
      selectedPaymentMethod: parsed.selectedPaymentMethod,
      checkoutStatus: parsed.confirmPayment
        ? BookingCheckoutStatus.PAID
        : undefined,
      markPaymentAuthorized: parsed.confirmPayment,
      markPaymentCollected: parsed.confirmPayment,
    })

    const responseBody = buildCheckoutResponseBody({ result })

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

    console.error('POST /api/client/bookings/[id]/checkout error', error)
    captureBookingException({
      error,
      route: 'POST /api/client/bookings/[id]/checkout',
    })

    return jsonFail(500, 'Internal server error.')
  }
}