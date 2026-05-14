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
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { updateClientBookingCheckout } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION = 'POST /api/client/bookings/[id]/checkout'

type ParsedCheckoutBody = {
  tipAmount?: string | null
  selectedPaymentMethod?: PaymentMethod
  confirmPayment: boolean
}

type ParsedBodyResult =
  | {
      ok: true
      value: ParsedCheckoutBody
    }
  | {
      ok: false
      error: string
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

function parseTipAmount(
  value: unknown,
): { ok: true; value?: string | null } | { ok: false; error: string } {
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

  let selectedPaymentMethod: PaymentMethod | undefined

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
    value: {
      tipAmount: parsedTip.value,
      selectedPaymentMethod,
      confirmPayment: parseBoolean(body.confirmPayment),
    },
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
): Response {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
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

  if (isObject(value)) {
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeNestedJsonValue(value[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (!isObject(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const out: JsonObjectPayload = {}

  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeNestedJsonValue(value[key])
  }

  return out
}

function buildIdempotencyRequestBody(args: {
  bookingId: string
  clientId: string
  actorUserId: string
  parsed: ParsedCheckoutBody
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
      paymentCollectedAt:
        booking.paymentCollectedAt?.toISOString() ?? null,
    },
    meta: args.result.meta,
  })
}

async function failCheckoutIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  await failStartedRouteIdempotency({
    idempotencyRecordId,
    operation: ROUTE_OPERATION,
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
    const body = isObject(rawBody) ? rawBody : {}

    const parsed = parseBody(body)
    if (!parsed.ok) {
      return jsonFail(400, parsed.error)
    }

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_CHECKOUT_CONFIRM,
      requestLabel: 'client checkout',
      requestBody: buildIdempotencyRequestBody({
        bookingId,
        clientId: auth.clientId,
        actorUserId,
        parsed: parsed.value,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching checkout request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
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
      await failCheckoutIdempotency(idempotencyRecordId)
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
      parsed.value.selectedPaymentMethod &&
      !acceptedMethods.has(parsed.value.selectedPaymentMethod)
    ) {
      await failCheckoutIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(
        400,
        'That payment method is not enabled by this provider.',
      )
    }

    const effectivePaymentMethod =
      parsed.value.selectedPaymentMethod ?? booking.selectedPaymentMethod ?? null

    if (parsed.value.confirmPayment) {
      if (!effectivePaymentMethod) {
        await failCheckoutIdempotency(idempotencyRecordId)
        idempotencyRecordId = null

        return jsonFail(
          400,
          'Choose a payment method before confirming payment.',
        )
      }

      if (effectivePaymentMethod === PaymentMethod.STRIPE_CARD) {
        await failCheckoutIdempotency(idempotencyRecordId)
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
        await failCheckoutIdempotency(idempotencyRecordId)
        idempotencyRecordId = null

        return jsonFail(
          400,
          'That payment method is not enabled by this provider.',
        )
      }
    }

    if (
      paymentSettings?.tipsEnabled === false &&
      parsed.value.tipAmount !== undefined &&
      parsed.value.tipAmount !== null &&
      Number(parsed.value.tipAmount) > 0
    ) {
      await failCheckoutIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(400, 'Tips are not enabled for this provider.')
    }

    const result = await updateClientBookingCheckout({
      bookingId,
      clientId: auth.clientId,
      tipAmount: parsed.value.tipAmount,
      selectedPaymentMethod: parsed.value.selectedPaymentMethod,
      checkoutStatus: parsed.value.confirmPayment
        ? BookingCheckoutStatus.PAID
        : undefined,
      markPaymentAuthorized: parsed.value.confirmPayment,
      markPaymentCollected: parsed.value.confirmPayment,
    })

    const responseBody = buildCheckoutResponseBody({ result })

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failCheckoutIdempotency(idempotencyRecordId)

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error(`${ROUTE_OPERATION} error`, error)
    captureBookingException({
      error,
      route: ROUTE_OPERATION,
    })

    return jsonFail(500, 'Internal server error.')
  }
}