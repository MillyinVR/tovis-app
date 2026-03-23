// app/api/pro/bookings/[id]/aftercare/route.ts
import type { NextRequest } from 'next/server'
import { AftercareRebookMode } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { upsertBookingAftercare } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type NormalizedRecommendedProduct =
  | {
      productId: string
      externalName: null
      externalUrl: null
      note: string | null
    }
  | {
      productId: null
      externalName: string
      externalUrl: string
      note: string | null
    }

type ProductsParse =
  | { ok: true; value: NormalizedRecommendedProduct[] }
  | { ok: false; error: string }

const AFTERCARE_REBOOK_MODE = {
  NONE: 'NONE',
  BOOKED_NEXT_APPOINTMENT: 'BOOKED_NEXT_APPOINTMENT',
  RECOMMENDED_WINDOW: 'RECOMMENDED_WINDOW',
} as const satisfies Record<string, AftercareRebookMode>

type NormalizedRebook =
  | {
      mode: typeof AFTERCARE_REBOOK_MODE.NONE
      rebookedFor: null
      rebookWindowStart: null
      rebookWindowEnd: null
    }
  | {
      mode: typeof AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT
      rebookedFor: Date
      rebookWindowStart: null
      rebookWindowEnd: null
    }
  | {
      mode: typeof AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW
      rebookedFor: null
      rebookWindowStart: Date
      rebookWindowEnd: Date
    }

const NOTES_MAX = 4000
const MAX_PRODUCTS = 10
const PRODUCT_ID_MAX = 191
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const PRODUCT_URL_MAX = 2048

function trimmedString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function toBool(x: unknown): boolean {
  return x === true || x === 'true' || x === 1 || x === '1'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toInt(x: unknown, fallback: number): number {
  const n =
    typeof x === 'number'
      ? x
      : typeof x === 'string'
        ? Number.parseInt(x.trim(), 10)
        : Number.NaN

  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function parseOptionalISODate(x: unknown): Date | null | 'invalid' {
  if (x === null || x === undefined || x === '') return null
  if (typeof x !== 'string') return 'invalid'

  const d = new Date(x)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d
}

function isAftercareRebookMode(x: unknown): x is AftercareRebookMode {
  return (
    x === AFTERCARE_REBOOK_MODE.NONE ||
    x === AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT ||
    x === AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW
  )
}

function isValidHttpUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s || s.length > PRODUCT_URL_MAX) return false

  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeRecommendedProducts(input: unknown): ProductsParse {
  if (input == null) return { ok: true, value: [] }

  if (!Array.isArray(input)) {
    return { ok: false, error: 'recommendedProducts must be an array.' }
  }

  if (input.length > MAX_PRODUCTS) {
    return { ok: false, error: `recommendedProducts max is ${MAX_PRODUCTS}.` }
  }

  const out: NormalizedRecommendedProduct[] = []

  for (const row of input) {
    if (!isObject(row)) {
      return {
        ok: false,
        error: 'Each recommended product must be an object.',
      }
    }

    const productId =
      typeof row.productId === 'string'
        ? row.productId.trim().slice(0, PRODUCT_ID_MAX)
        : ''

    const externalName =
      typeof row.externalName === 'string'
        ? row.externalName.trim().slice(0, PRODUCT_NAME_MAX)
        : typeof row.name === 'string'
          ? row.name.trim().slice(0, PRODUCT_NAME_MAX)
          : ''

    const externalUrl =
      typeof row.externalUrl === 'string'
        ? row.externalUrl.trim().slice(0, PRODUCT_URL_MAX)
        : typeof row.url === 'string'
          ? row.url.trim().slice(0, PRODUCT_URL_MAX)
          : ''

    const noteRaw = typeof row.note === 'string' ? row.note.trim() : ''
    const note = noteRaw ? noteRaw.slice(0, PRODUCT_NOTE_MAX) : null

    if (!productId && !externalName && !externalUrl && !note) continue

    const hasProductId = productId.length > 0
    const hasExternalName = externalName.length > 0
    const hasExternalUrl = externalUrl.length > 0
    const hasAnyExternalFields = hasExternalName || hasExternalUrl

    if (hasProductId && hasAnyExternalFields) {
      return {
        ok: false,
        error:
          'Each recommended product must be either an internal product or an external link, not both.',
      }
    }

    if (hasProductId) {
      out.push({
        productId,
        externalName: null,
        externalUrl: null,
        note,
      })
      continue
    }

    if (!hasExternalName && !hasExternalUrl && note) {
      return {
        ok: false,
        error:
          'Recommendation note cannot be saved without a product selection or external link.',
      }
    }

    if (!hasExternalName) {
      return {
        ok: false,
        error: 'Each external recommended product needs a name.',
      }
    }

    if (!hasExternalUrl) {
      return {
        ok: false,
        error: 'Each external recommended product needs a link.',
      }
    }

    if (!isValidHttpUrl(externalUrl)) {
      return {
        ok: false,
        error: 'Product link must be a valid http/https URL.',
      }
    }

    out.push({
      productId: null,
      externalName,
      externalUrl,
      note,
    })
  }

  return { ok: true, value: out }
}

function normalizeRebookFields(args: {
  requestedMode: AftercareRebookMode
  rebookedForParsed: Date | null | 'invalid'
  windowStartParsed: Date | null | 'invalid'
  windowEndParsed: Date | null | 'invalid'
}): { ok: true; value: NormalizedRebook } | { ok: false; error: string } {
  const {
    requestedMode,
    rebookedForParsed,
    windowStartParsed,
    windowEndParsed,
  } = args

  if (rebookedForParsed === 'invalid') {
    return { ok: false, error: 'Invalid rebookedFor date.' }
  }

  if (windowStartParsed === 'invalid') {
    return { ok: false, error: 'Invalid rebookWindowStart date.' }
  }

  if (windowEndParsed === 'invalid') {
    return { ok: false, error: 'Invalid rebookWindowEnd date.' }
  }

  if (requestedMode === AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT) {
    if (!rebookedForParsed) {
      return {
        ok: false,
        error: 'BOOKED_NEXT_APPOINTMENT requires rebookedFor.',
      }
    }

    return {
      ok: true,
      value: {
        mode: AFTERCARE_REBOOK_MODE.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: rebookedForParsed,
        rebookWindowStart: null,
        rebookWindowEnd: null,
      },
    }
  }

  if (requestedMode === AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW) {
    if (!windowStartParsed || !windowEndParsed) {
      return {
        ok: false,
        error:
          'RECOMMENDED_WINDOW requires rebookWindowStart and rebookWindowEnd.',
      }
    }

    if (windowEndParsed <= windowStartParsed) {
      return {
        ok: false,
        error: 'rebookWindowEnd must be after rebookWindowStart.',
      }
    }

    return {
      ok: true,
      value: {
        mode: AFTERCARE_REBOOK_MODE.RECOMMENDED_WINDOW,
        rebookedFor: null,
        rebookWindowStart: windowStartParsed,
        rebookWindowEnd: windowEndParsed,
      },
    }
  }

  return {
    ok: true,
    value: {
      mode: AFTERCARE_REBOOK_MODE.NONE,
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
    },
  }
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

function toIsoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        sessionStep: true,
        scheduledFor: true,
        finishedAt: true,
        locationTimeZone: true,
        aftercareSummary: {
          select: {
            id: true,
            notes: true,
            rebookMode: true,
            rebookedFor: true,
            rebookWindowStart: true,
            rebookWindowEnd: true,
            publicToken: true,
            draftSavedAt: true,
            sentToClientAt: true,
            lastEditedAt: true,
            version: true,
            recommendedProducts: {
              select: {
                id: true,
                note: true,
                productId: true,
                externalName: true,
                externalUrl: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    brand: true,
                    retailPrice: true,
                  },
                },
              },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== auth.professionalId) {
      return jsonFail(403, 'Forbidden.')
    }

    return jsonOk(
      {
        booking: {
          id: booking.id,
          status: booking.status,
          sessionStep: booking.sessionStep,
          scheduledFor: booking.scheduledFor.toISOString(),
          finishedAt: toIsoOrNull(booking.finishedAt),
          locationTimeZone: booking.locationTimeZone,
          aftercareSummary: booking.aftercareSummary
            ? {
                id: booking.aftercareSummary.id,
                notes: booking.aftercareSummary.notes,
                rebookMode: booking.aftercareSummary.rebookMode,
                rebookedFor: toIsoOrNull(booking.aftercareSummary.rebookedFor),
                rebookWindowStart: toIsoOrNull(
                  booking.aftercareSummary.rebookWindowStart,
                ),
                rebookWindowEnd: toIsoOrNull(
                  booking.aftercareSummary.rebookWindowEnd,
                ),
                publicToken: booking.aftercareSummary.publicToken,
                draftSavedAt: toIsoOrNull(booking.aftercareSummary.draftSavedAt),
                sentToClientAt: toIsoOrNull(
                  booking.aftercareSummary.sentToClientAt,
                ),
                lastEditedAt: toIsoOrNull(
                  booking.aftercareSummary.lastEditedAt,
                ),
                version: booking.aftercareSummary.version,
                isFinalized: Boolean(booking.aftercareSummary.sentToClientAt),
                recommendedProducts:
                  booking.aftercareSummary.recommendedProducts.map((product) => ({
                    id: product.id,
                    note: product.note,
                    productId: product.productId,
                    externalName: product.externalName,
                    externalUrl: product.externalUrl,
                    product: product.product
                      ? {
                          id: product.product.id,
                          name: product.product.name,
                          brand: product.product.brand,
                          retailPrice:
                            product.product.retailPrice?.toString() ?? null,
                        }
                      : null,
                  })),
              }
            : null,
        },
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/bookings/[id]/aftercare error', error)
    return jsonFail(500, 'Internal server error.')
  }
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id } = await props.params
    const bookingId = trimmedString(id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body: Record<string, unknown> = isObject(rawBody) ? rawBody : {}

    const notes =
      typeof body.notes === 'string'
        ? body.notes.trim().slice(0, NOTES_MAX)
        : ''

    const sendToClient = toBool(body.sendToClient)

    const productsParsed = normalizeRecommendedProducts(body.recommendedProducts)
    if (!productsParsed.ok) {
      return jsonFail(400, productsParsed.error)
    }
    const products = productsParsed.value

    const requestedMode = isAftercareRebookMode(body.rebookMode)
      ? body.rebookMode
      : AFTERCARE_REBOOK_MODE.NONE

    const normalizedRebook = normalizeRebookFields({
      requestedMode,
      rebookedForParsed: parseOptionalISODate(body.rebookedFor),
      windowStartParsed: parseOptionalISODate(body.rebookWindowStart),
      windowEndParsed: parseOptionalISODate(body.rebookWindowEnd),
    })

    if (!normalizedRebook.ok) {
      return jsonFail(400, normalizedRebook.error)
    }

    const {
      mode: normalizedMode,
      rebookedFor,
      rebookWindowStart,
      rebookWindowEnd,
    } = normalizedRebook.value

    const createRebookReminder = toBool(body.createRebookReminder)
    const createProductReminder = toBool(body.createProductReminder)

    const rebookReminderDaysBefore = clamp(
      toInt(body.rebookReminderDaysBefore, 2),
      1,
      30,
    )

    const productReminderDaysAfter = clamp(
      toInt(body.productReminderDaysAfter, 7),
      1,
      180,
    )

    const clientTz =
      typeof body.timeZone === 'string' ? body.timeZone.trim() : ''

    const clientTimeZoneReceived =
      clientTz && isValidIanaTimeZone(clientTz) ? clientTz : null

    const result = await upsertBookingAftercare({
      bookingId,
      professionalId: auth.professionalId,
      notes: notes || null,
      rebookMode: normalizedMode,
      rebookedFor,
      rebookWindowStart,
      rebookWindowEnd,
      createRebookReminder,
      rebookReminderDaysBefore,
      createProductReminder,
      productReminderDaysAfter,
      recommendedProducts: products,
      sendToClient,
    })

    return jsonOk(
      {
        aftercare: {
          id: result.aftercare.id,
          publicToken: result.aftercare.publicToken,
          rebookMode: result.aftercare.rebookMode,
          rebookedFor: toIsoOrNull(result.aftercare.rebookedFor),
          rebookWindowStart: toIsoOrNull(result.aftercare.rebookWindowStart),
          rebookWindowEnd: toIsoOrNull(result.aftercare.rebookWindowEnd),
          draftSavedAt: toIsoOrNull(result.aftercare.draftSavedAt),
          sentToClientAt: toIsoOrNull(result.aftercare.sentToClientAt),
          lastEditedAt: toIsoOrNull(result.aftercare.lastEditedAt),
          version: result.aftercare.version,
          isFinalized: Boolean(result.aftercare.sentToClientAt),
        },
        remindersTouched: result.remindersTouched,
        clientNotified: result.clientNotified,
        timeZoneUsed: result.timeZoneUsed,
        clientTimeZoneReceived,
        bookingFinished: result.bookingFinished,
        booking: result.booking
          ? {
              status: result.booking.status,
              sessionStep: result.booking.sessionStep,
              finishedAt: toIsoOrNull(result.booking.finishedAt),
            }
          : null,
        redirectTo: result.bookingFinished ? '/pro/calendar' : null,
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

    console.error('POST /api/pro/bookings/[id]/aftercare error', error)
    return jsonFail(500, 'Internal server error.')
  }
}