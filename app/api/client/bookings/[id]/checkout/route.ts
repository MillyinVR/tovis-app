// app/api/client/bookings/[id]/checkout/route.ts 

import type { NextRequest } from 'next/server'
import {
  BookingCheckoutStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { updateClientBookingCheckout } from '@/lib/booking/writeBoundary'
import { prisma } from '@/lib/prisma'

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
          'selectedPaymentMethod must be one of: cash, card on file, tap to pay, Venmo, Zelle, Apple Cash.',
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

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: Record<string, unknown> = isObject(rawBody) ? rawBody : {}

    const parsed = parseBody(body)
    if (!parsed.ok) {
      return jsonFail(400, parsed.error)
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        selectedPaymentMethod: true,
      } satisfies Prisma.BookingSelect,
    })

    if (!booking) {
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
        tipsEnabled: true,
      } satisfies Prisma.ProfessionalPaymentSettingsSelect,
    })

    const acceptedMethods = buildAcceptedPaymentMethods(paymentSettings)

    if (
      parsed.selectedPaymentMethod &&
      !acceptedMethods.has(parsed.selectedPaymentMethod)
    ) {
      return jsonFail(
        400,
        'That payment method is not enabled by this provider.',
      )
    }

    const effectivePaymentMethod =
      parsed.selectedPaymentMethod ?? booking.selectedPaymentMethod ?? null

    if (parsed.confirmPayment) {
      if (!effectivePaymentMethod) {
        return jsonFail(
          400,
          'Choose a payment method before confirming payment.',
        )
      }

      if (!acceptedMethods.has(effectivePaymentMethod)) {
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

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          checkoutStatus: result.booking.checkoutStatus,
          selectedPaymentMethod: result.booking.selectedPaymentMethod,
          serviceSubtotalSnapshot:
            result.booking.serviceSubtotalSnapshot?.toString() ?? null,
          productSubtotalSnapshot:
            result.booking.productSubtotalSnapshot?.toString() ?? null,
          subtotalSnapshot: result.booking.subtotalSnapshot?.toString() ?? null,
          tipAmount: result.booking.tipAmount?.toString() ?? null,
          taxAmount: result.booking.taxAmount?.toString() ?? null,
          discountAmount: result.booking.discountAmount?.toString() ?? null,
          totalAmount: result.booking.totalAmount?.toString() ?? null,
          paymentAuthorizedAt:
            result.booking.paymentAuthorizedAt?.toISOString() ?? null,
          paymentCollectedAt:
            result.booking.paymentCollectedAt?.toISOString() ?? null,
        },
        meta: result.meta,
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/client/bookings/[id]/checkout error', error)
    return jsonFail(500, 'Internal server error.')
  }
}