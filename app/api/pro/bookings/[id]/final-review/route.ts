// app/api/pro/bookings/[id]/final-review/route.ts
import { NextRequest, NextResponse } from 'next/server'
import {
  AftercareRebookMode,
  BookingServiceItemType,
} from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import { confirmBookingFinalReview } from '@/lib/booking/writeBoundary'
import { bookingError } from '@/lib/booking/errors'

type RouteContext = {
  params: Promise<{ id: string }>
}

type FinalReviewLineItemInput = {
  bookingServiceItemId?: string | null
  serviceId?: string
  offeringId?: string | null
  itemType?: BookingServiceItemType | string
  price?: string | number
  durationMinutes?: number | string
  notes?: string | null
  sortOrder?: number | string
}

type FinalReviewRequestBody = {
  finalLineItems?: FinalReviewLineItemInput[]
  expectedSubtotal?: string | number | null
  recommendedProducts?: {
    name?: string
    url?: string
    note?: string | null
  }[]
  rebookMode?: AftercareRebookMode | string | null
  rebookedFor?: string | null
  rebookWindowStart?: string | null
  rebookWindowEnd?: string | null
}

function jsonOk(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

function jsonFail(error: string, status = 400) {
  return NextResponse.json(
    {
      ok: false,
      error,
    },
    { status },
  )
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNullableTrimmedString(value: unknown): string | null {
  const v = asTrimmedString(value)
  return v ? v : null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
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

function parseItemType(value: unknown): BookingServiceItemType {
  const raw = asTrimmedString(value).toUpperCase()

  if (raw === BookingServiceItemType.ADD_ON) {
    return BookingServiceItemType.ADD_ON
  }

  return BookingServiceItemType.BASE
}

function normalizeFinalLineItems(
  value: unknown,
): {
  bookingServiceItemId?: string | null
  serviceId: string
  offeringId: string | null
  itemType: BookingServiceItemType
  price: string | number
  durationMinutes: number
  notes?: string | null
  sortOrder: number
}[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw bookingError('INVALID_SERVICE_ITEMS', {
      message: 'finalLineItems is required.',
      userMessage: 'Add at least one final service item.',
    })
  }

  return value.map((raw, index) => {
    const row = (raw ?? {}) as FinalReviewLineItemInput

    const serviceId = asTrimmedString(row.serviceId)
    if (!serviceId) {
      throw bookingError('INVALID_SERVICE_ITEMS', {
        message: `finalLineItems[${index}].serviceId is required.`,
        userMessage: 'Each final service item must include a service.',
      })
    }

    const priceRaw =
      typeof row.price === 'string' || typeof row.price === 'number'
        ? row.price
        : ''

    const durationMinutes = asFiniteNumber(row.durationMinutes)
    if (durationMinutes == null) {
      throw bookingError('INVALID_SERVICE_ITEMS', {
        message: `finalLineItems[${index}].durationMinutes is invalid.`,
        userMessage: 'Each final service item must include a valid duration.',
      })
    }

    const sortOrder = asFiniteNumber(row.sortOrder)

    return {
      bookingServiceItemId: asNullableTrimmedString(row.bookingServiceItemId),
      serviceId,
      offeringId: asNullableTrimmedString(row.offeringId),
      itemType: parseItemType(row.itemType),
      price: priceRaw,
      durationMinutes,
      notes: asNullableTrimmedString(row.notes),
      sortOrder: sortOrder == null ? index : Math.trunc(sortOrder),
    }
  })
}

function normalizeRecommendedProducts(
  value: unknown,
): {
  name: string
  url: string
  note: string | null
}[] {
  if (!Array.isArray(value)) return []

  return value
    .map((raw) => {
      const row = (raw ?? {}) as {
        name?: unknown
        url?: unknown
        note?: unknown
      }

      const name = asTrimmedString(row.name)
      const url = asTrimmedString(row.url)
      const note = asNullableTrimmedString(row.note)

      if (!name || !url) return null

      return { name, url, note }
    })
    .filter(
      (row): row is { name: string; url: string; note: string | null } =>
        Boolean(row),
    )
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

  throw bookingError('FORBIDDEN', {
    message: `Invalid rebookMode: ${raw}`,
    userMessage: 'Rebook choice is invalid.',
  })
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const bookingId = String(id ?? '').trim()

    if (!bookingId) {
      return jsonFail('BOOKING_ID_REQUIRED', 400)
    }

    const user = await getCurrentUser().catch(() => null)
    const professionalId =
      user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null

    if (!professionalId) {
      return jsonFail('UNAUTHORIZED', 401)
    }

    const body = (await req.json().catch(() => null)) as FinalReviewRequestBody | null
    if (!body) {
      return jsonFail('INVALID_BODY', 400)
    }

    const finalLineItems = normalizeFinalLineItems(body.finalLineItems)
    const expectedSubtotal =
      body.expectedSubtotal == null ? null : body.expectedSubtotal

    const recommendedProducts = normalizeRecommendedProducts(
      body.recommendedProducts,
    )

    const rebookMode = parseRebookMode(body.rebookMode)
    const rebookedFor = asNullableDate(body.rebookedFor)
    const rebookWindowStart = asNullableDate(body.rebookWindowStart)
    const rebookWindowEnd = asNullableDate(body.rebookWindowEnd)

 const result = await confirmBookingFinalReview({
    bookingId,
    professionalId,
    finalLineItems,
    expectedSubtotal,
    })

    return jsonOk({
      ok: true,
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
    })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Request failed.'

    return jsonFail(message, 400)
  }
}