// app/api/client/bookings/[id]/checkout/products/route.ts
import type { NextRequest } from 'next/server'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { upsertClientBookingCheckoutProducts } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type SelectedCheckoutProductInput = {
  recommendationId: string
  productId: string
  quantity: number
}

type ParsedItemsResult =
  | { ok: true; value: SelectedCheckoutProductInput[] }
  | { ok: false; error: string }

const MAX_ITEMS = 25
const MAX_ID_LENGTH = 191
const MAX_QUANTITY = 99

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN

  if (!Number.isFinite(parsed)) return null

  const whole = Math.trunc(parsed)
  if (whole <= 0 || whole > MAX_QUANTITY) return null

  return whole
}

function parseItems(input: unknown): ParsedItemsResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'items must be an array.' }
  }

  if (input.length > MAX_ITEMS) {
    return { ok: false, error: `items max is ${MAX_ITEMS}.` }
  }

  const out: SelectedCheckoutProductInput[] = []
  const seenRecommendationIds = new Set<string>()

  for (const row of input) {
    if (!isObject(row)) {
      return {
        ok: false,
        error: 'Each selected product must be an object.',
      }
    }

    const recommendationId =
      typeof row.recommendationId === 'string'
        ? row.recommendationId.trim().slice(0, MAX_ID_LENGTH)
        : ''

    const productId =
      typeof row.productId === 'string'
        ? row.productId.trim().slice(0, MAX_ID_LENGTH)
        : ''

    const quantity = normalizePositiveInt(row.quantity)

    if (!recommendationId) {
      return {
        ok: false,
        error: 'Each selected product needs a recommendationId.',
      }
    }

    if (!productId) {
      return {
        ok: false,
        error: 'Each selected product needs a productId.',
      }
    }

    if (quantity == null) {
      return {
        ok: false,
        error: `Each selected product needs a quantity between 1 and ${MAX_QUANTITY}.`,
      }
    }

    if (seenRecommendationIds.has(recommendationId)) {
      return {
        ok: false,
        error: 'Duplicate recommendationId values are not allowed.',
      }
    }

    seenRecommendationIds.add(recommendationId)
    out.push({
      recommendationId,
      productId,
      quantity,
    })
  }

  return { ok: true, value: out }
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

    const parsedItems = parseItems(body.items)
    if (!parsedItems.ok) {
      return jsonFail(400, parsedItems.error)
    }

    const result = await upsertClientBookingCheckoutProducts({
      bookingId,
      clientId: auth.clientId,
      items: parsedItems.value,
    })

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          checkoutStatus: result.booking.checkoutStatus,
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
        selectedProducts: result.selectedProducts.map((item) => ({
          recommendationId: item.recommendationId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          lineTotal: item.lineTotal.toString(),
        })),
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

    console.error(
      'POST /api/client/bookings/[id]/checkout/products error',
      error,
    )
    return jsonFail(500, 'Internal server error.')
  }
}