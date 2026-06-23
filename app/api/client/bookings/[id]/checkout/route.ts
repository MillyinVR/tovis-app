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
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { updateClientBookingCheckout } from '@/lib/booking/writeBoundary'
import {
  buildAcceptedPaymentMethods,
  normalizePaymentMethodInput,
} from '@/lib/payments/acceptedMethods'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { parseTipAmount } from '@/lib/money'

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
      tipAmount: parsedTip.tipAmount,
      selectedPaymentMethod,
      confirmPayment: parseBoolean(body.confirmPayment),
    },
  }
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

export async function POST(req: NextRequest, props: RouteContext) {
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

    const { id } = await resolveRouteParams(props)
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

    // Checkout committed (e.g. payment confirmed) — deliver any receipt /
    // completion notification immediately.
    kickNotificationDrain()

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