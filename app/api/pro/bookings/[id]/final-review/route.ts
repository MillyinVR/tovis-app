// app/api/pro/bookings/[id]/final-review/route.ts
import {
  jsonFail,
  jsonOk,
  pickString,
  requirePro,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { confirmBookingFinalReview } from '@/lib/booking/writeBoundary'
import {
  AftercareRebookMode,
  BookingServiceItemType,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = {
  params: { id: string } | Promise<{ id: string }>
}

type FinalReviewLineItemInput = {
  bookingServiceItemId?: unknown
  serviceId?: unknown
  offeringId?: unknown
  itemType?: unknown
  price?: unknown
  durationMinutes?: unknown
  notes?: unknown
  sortOrder?: unknown
}

type FinalReviewRecommendedProductInput = {
  name?: unknown
  url?: unknown
  note?: unknown
}

type FinalReviewRequestBody = {
  finalLineItems?: unknown
  expectedSubtotal?: unknown
  recommendedProducts?: unknown
  rebookMode?: unknown
  rebookedFor?: unknown
  rebookWindowStart?: unknown
  rebookWindowEnd?: unknown
}

type NormalizedFinalLineItem = {
  bookingServiceItemId?: string | null
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  price: string | number
  durationMinutes: number
  notes?: string | null
  sortOrder: number
}

type NormalizedRecommendedProduct = {
  productId: null
  externalName: string
  externalUrl: string
  note: string | null
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

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNullableTrimmedString(value: unknown): string | null {
  const trimmed = asTrimmedString(value)
  return trimmed.length > 0 ? trimmed : null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function asNullableDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseItemType(value: unknown): BookingServiceItemType | null {
  const raw = asTrimmedString(value).toUpperCase()

  if (raw === BookingServiceItemType.BASE) {
    return BookingServiceItemType.BASE
  }

  if (raw === BookingServiceItemType.ADD_ON) {
    return BookingServiceItemType.ADD_ON
  }

  return null
}

function parsePriceInput(value: unknown): string | number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? trimmed : null
  }

  return null
}

function parseRebookMode(value: unknown): AftercareRebookMode | null {
  const raw = asTrimmedString(value).toUpperCase()
  if (!raw) return null

  if (raw === AftercareRebookMode.NONE) {
    return AftercareRebookMode.NONE
  }

  if (raw === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
    return AftercareRebookMode.BOOKED_NEXT_APPOINTMENT
  }

  if (raw === AftercareRebookMode.RECOMMENDED_WINDOW) {
    return AftercareRebookMode.RECOMMENDED_WINDOW
  }

  return null
}

function normalizeFinalLineItems(value: unknown): NormalizedFinalLineItem[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  const normalized: NormalizedFinalLineItem[] = []

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    if (!isRecord(raw)) return null

    const row = raw as FinalReviewLineItemInput

    const serviceId = asTrimmedString(row.serviceId)
    if (!serviceId) return null

    const itemType = parseItemType(row.itemType)
    if (!itemType) return null

    const price = parsePriceInput(row.price)
    if (price == null) return null

    const durationMinutes = asFiniteNumber(row.durationMinutes)
    if (durationMinutes == null) return null

    const sortOrderRaw = asFiniteNumber(row.sortOrder)
    const sortOrder =
      sortOrderRaw == null ? index : Math.max(0, Math.trunc(sortOrderRaw))

    normalized.push({
      bookingServiceItemId: asNullableTrimmedString(row.bookingServiceItemId),
      serviceId,
      offeringId: asNullableTrimmedString(row.offeringId),
      itemType,
      price,
      durationMinutes: Math.trunc(durationMinutes),
      notes: asNullableTrimmedString(row.notes),
      sortOrder,
    })
  }

  return normalized
}

function normalizeRecommendedProducts(
  value: unknown,
): NormalizedRecommendedProduct[] {
  if (!Array.isArray(value)) return []

  const normalized: NormalizedRecommendedProduct[] = []

  for (const raw of value) {
    if (!isRecord(raw)) continue

    const row = raw as FinalReviewRecommendedProductInput
    const externalName = asTrimmedString(row.name)
    const externalUrl = asTrimmedString(row.url)
    const note = asNullableTrimmedString(row.note)

    if (!externalName || !externalUrl) continue

    normalized.push({
      productId: null,
      externalName,
      externalUrl,
      note,
    })
  }

  return normalized
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => null)
    if (!isRecord(rawBody)) {
      return jsonFail(400, 'Invalid request body.')
    }

    const body = rawBody as FinalReviewRequestBody

    const finalLineItems = normalizeFinalLineItems(body.finalLineItems)
    if (!finalLineItems) {
      return jsonFail(
        400,
        'Invalid finalLineItems. Each item needs serviceId, itemType, price, and durationMinutes.',
      )
    }

    const expectedSubtotal =
      typeof body.expectedSubtotal === 'string' ||
      typeof body.expectedSubtotal === 'number' ||
      body.expectedSubtotal == null
        ? body.expectedSubtotal
        : null

    const recommendedProducts = normalizeRecommendedProducts(
      body.recommendedProducts,
    )

    const rebookMode = parseRebookMode(body.rebookMode)
    if (body.rebookMode != null && rebookMode == null) {
      return jsonFail(400, 'Invalid rebookMode.')
    }

    const rebookedFor = asNullableDate(body.rebookedFor)
    if (body.rebookedFor != null && body.rebookedFor !== '' && !rebookedFor) {
      return jsonFail(400, 'Invalid rebookedFor date.')
    }

    const rebookWindowStart = asNullableDate(body.rebookWindowStart)
    if (
      body.rebookWindowStart != null &&
      body.rebookWindowStart !== '' &&
      !rebookWindowStart
    ) {
      return jsonFail(400, 'Invalid rebookWindowStart date.')
    }

    const rebookWindowEnd = asNullableDate(body.rebookWindowEnd)
    if (
      body.rebookWindowEnd != null &&
      body.rebookWindowEnd !== '' &&
      !rebookWindowEnd
    ) {
      return jsonFail(400, 'Invalid rebookWindowEnd date.')
    }

    const result = await confirmBookingFinalReview({
      bookingId,
      professionalId,
      finalLineItems,
      expectedSubtotal,
      recommendedProducts,
      rebookMode,
      rebookedFor,
      rebookWindowStart,
      rebookWindowEnd,
    })

    return jsonOk(
      {
        booking: {
          id: result.booking.id,
          status: result.booking.status,
          sessionStep: result.booking.sessionStep,
          serviceId: result.booking.serviceId,
          offeringId: result.booking.offeringId,
          subtotalSnapshot:
            result.booking.subtotalSnapshot == null
              ? null
              : String(result.booking.subtotalSnapshot),
          totalDurationMinutes: result.booking.totalDurationMinutes,
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

    console.error('POST /api/pro/bookings/[id]/final-review error', error)
    return jsonFail(500, 'Internal server error')
  }
}