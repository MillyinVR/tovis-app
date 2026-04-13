import { AftercareRebookMode, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isRecord } from '@/lib/guards'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { upsertBookingAftercare } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = {
  params: { id: string } | Promise<{ id: string }>
}

type PublicAccess =
  | {
      accessMode: 'SECURE_LINK'
      hasPublicAccess: true
      clientAftercareHref: string
    }
  | {
      accessMode: 'NONE'
      hasPublicAccess: false
      clientAftercareHref: null
    }

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

type NormalizedRebook =
  | {
      mode: 'NONE'
      rebookMode: AftercareRebookMode
      rebookedFor: null
      rebookWindowStart: null
      rebookWindowEnd: null
    }
  | {
      mode: 'BOOKED_NEXT_APPOINTMENT'
      rebookMode: AftercareRebookMode
      rebookedFor: Date
      rebookWindowStart: null
      rebookWindowEnd: null
    }
  | {
      mode: 'RECOMMENDED_WINDOW'
      rebookMode: AftercareRebookMode
      rebookedFor: null
      rebookWindowStart: Date
      rebookWindowEnd: Date
    }

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
}

const NOTES_MAX = 4000
const MAX_PRODUCTS = 10
const PRODUCT_ID_MAX = 191
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const PRODUCT_URL_MAX = 2048

const GET_BOOKING_SELECT = {
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
} satisfies Prisma.BookingSelect

type GetBookingRecord = Prisma.BookingGetPayload<{
  select: typeof GET_BOOKING_SELECT
}>

type GetRecommendedProductRecord = NonNullable<
  GetBookingRecord['aftercareSummary']
>['recommendedProducts'][number]

type ParsedPostBody = {
  notes: string | null
  sendToClient: boolean
  recommendedProducts: NormalizedRecommendedProduct[]
  normalizedRebook: NormalizedRebook
  createRebookReminder: boolean
  rebookReminderDaysBefore: number
  createProductReminder: boolean
  productReminderDaysAfter: number
  clientTimeZoneReceived: string | null
  version: number | null
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function toInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN

  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function parseOptionalISODate(value: unknown): Date | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return 'invalid'

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed
}

function parseOptionalVersion(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function parseRequestedRebookMode(
  value: unknown,
):
  | { ok: true; value: AftercareRebookMode }
  | { ok: false; error: string } {
  const raw = trimmedString(value)?.toUpperCase()
  if (!raw) {
    return { ok: true, value: AftercareRebookMode.NONE }
  }

  if (raw === AftercareRebookMode.NONE) {
    return { ok: true, value: AftercareRebookMode.NONE }
  }

  if (raw === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
    return { ok: true, value: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT }
  }

  if (raw === AftercareRebookMode.RECOMMENDED_WINDOW) {
    return { ok: true, value: AftercareRebookMode.RECOMMENDED_WINDOW }
  }

  return { ok: false, error: 'Invalid rebookMode.' }
}

function isValidHttpUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > PRODUCT_URL_MAX) return false

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
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

  const normalized: NormalizedRecommendedProduct[] = []

  for (const row of input) {
    if (!isRecord(row)) {
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

    if (!productId && !externalName && !externalUrl && !note) {
      continue
    }

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
      normalized.push({
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

    normalized.push({
      productId: null,
      externalName,
      externalUrl,
      note,
    })
  }

  return { ok: true, value: normalized }
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

  if (requestedMode === AftercareRebookMode.NONE) {
    if (rebookedForParsed || windowStartParsed || windowEndParsed) {
      return {
        ok: false,
        error: 'Rebook dates are not allowed when rebookMode is NONE.',
      }
    }

    return {
      ok: true,
      value: {
        mode: 'NONE',
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
        rebookWindowStart: null,
        rebookWindowEnd: null,
      },
    }
  }

  if (requestedMode === AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
    if (!rebookedForParsed) {
      return {
        ok: false,
        error: 'BOOKED_NEXT_APPOINTMENT requires rebookedFor.',
      }
    }

    if (windowStartParsed || windowEndParsed) {
      return {
        ok: false,
        error:
          'BOOKED_NEXT_APPOINTMENT does not allow rebookWindowStart/rebookWindowEnd.',
      }
    }

    return {
      ok: true,
      value: {
        mode: 'BOOKED_NEXT_APPOINTMENT',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: rebookedForParsed,
        rebookWindowStart: null,
        rebookWindowEnd: null,
      },
    }
  }

  if (!windowStartParsed || !windowEndParsed) {
    return {
      ok: false,
      error:
        'RECOMMENDED_WINDOW requires rebookWindowStart and rebookWindowEnd.',
    }
  }

  if (rebookedForParsed) {
    return {
      ok: false,
      error: 'RECOMMENDED_WINDOW does not allow rebookedFor.',
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
      mode: 'RECOMMENDED_WINDOW',
      rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
      rebookedFor: null,
      rebookWindowStart: windowStartParsed,
      rebookWindowEnd: windowEndParsed,
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

function buildClientAftercareHref(
  tokenValue: string | null | undefined,
): string | null {
  const token = trimmedString(tokenValue)
  if (!token) return null
  return `/client/rebook/${encodeURIComponent(token)}`
}

function buildPublicAccess(
  tokenValue: string | null | undefined,
): PublicAccess {
  const clientAftercareHref = buildClientAftercareHref(tokenValue)

  if (!clientAftercareHref) {
    return {
      accessMode: 'NONE',
      hasPublicAccess: false,
      clientAftercareHref: null,
    }
  }

  return {
    accessMode: 'SECURE_LINK',
    hasPublicAccess: true,
    clientAftercareHref,
  }
}

function mapRecommendedProduct(product: GetRecommendedProductRecord) {
  return {
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
          retailPrice: product.product.retailPrice?.toString() ?? null,
        }
      : null,
  }
}

function mapAftercareSummaryForGet(
  aftercare: NonNullable<GetBookingRecord['aftercareSummary']>,
) {
  return {
    id: aftercare.id,
    notes: aftercare.notes,
    rebookMode: aftercare.rebookMode,
    rebookedFor: toIsoOrNull(aftercare.rebookedFor),
    rebookWindowStart: toIsoOrNull(aftercare.rebookWindowStart),
    rebookWindowEnd: toIsoOrNull(aftercare.rebookWindowEnd),
    draftSavedAt: toIsoOrNull(aftercare.draftSavedAt),
    sentToClientAt: toIsoOrNull(aftercare.sentToClientAt),
    lastEditedAt: toIsoOrNull(aftercare.lastEditedAt),
    version: aftercare.version,
    isFinalized: Boolean(aftercare.sentToClientAt),
    publicAccess: buildPublicAccess(aftercare.publicToken),
    recommendedProducts: aftercare.recommendedProducts.map(
      mapRecommendedProduct,
    ),
  }
}

function readHeaderValue(req: Request, name: string): string | null {
  return trimmedString(req.headers.get(name))
}

function readRequestMeta(req: Request): RequestMeta {
  return {
    requestId:
      readHeaderValue(req, 'x-request-id') ??
      readHeaderValue(req, 'request-id') ??
      null,
    idempotencyKey:
      readHeaderValue(req, 'idempotency-key') ??
      readHeaderValue(req, 'x-idempotency-key') ??
      null,
  }
}

async function getBookingIdFromContext(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.id)
}

function parsePostBody(rawBody: unknown): { ok: true; value: ParsedPostBody } | { ok: false; error: string } {
  if (!isRecord(rawBody)) {
    return { ok: false, error: 'Invalid request body.' }
  }

  const notes =
    typeof rawBody.notes === 'string'
      ? rawBody.notes.trim().slice(0, NOTES_MAX) || null
      : null

  const productsParsed = normalizeRecommendedProducts(
    rawBody.recommendedProducts,
  )
  if (!productsParsed.ok) {
    return productsParsed
  }

  const requestedModeResult = parseRequestedRebookMode(rawBody.rebookMode)
  if (!requestedModeResult.ok) {
    return requestedModeResult
  }

  const normalizedRebook = normalizeRebookFields({
    requestedMode: requestedModeResult.value,
    rebookedForParsed: parseOptionalISODate(rawBody.rebookedFor),
    windowStartParsed: parseOptionalISODate(rawBody.rebookWindowStart),
    windowEndParsed: parseOptionalISODate(rawBody.rebookWindowEnd),
  })

  if (!normalizedRebook.ok) {
    return normalizedRebook
  }

  const clientTimeZoneRaw =
    typeof rawBody.timeZone === 'string' ? rawBody.timeZone.trim() : ''

  const clientTimeZoneReceived =
    clientTimeZoneRaw && isValidIanaTimeZone(clientTimeZoneRaw)
      ? clientTimeZoneRaw
      : null

  return {
    ok: true,
    value: {
      notes,
      sendToClient: toBool(rawBody.sendToClient),
      recommendedProducts: productsParsed.value,
      normalizedRebook: normalizedRebook.value,
      createRebookReminder: toBool(rawBody.createRebookReminder),
      rebookReminderDaysBefore: clamp(
        toInt(rawBody.rebookReminderDaysBefore, 2),
        1,
        30,
      ),
      createProductReminder: toBool(rawBody.createProductReminder),
      productReminderDaysAfter: clamp(
        toInt(rawBody.productReminderDaysAfter, 7),
        1,
        180,
      ),
      clientTimeZoneReceived,
      version: parseOptionalVersion(rawBody.version),
    },
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const bookingId = await getBookingIdFromContext(ctx)
    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const booking: GetBookingRecord | null = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: GET_BOOKING_SELECT,
    })

    if (!booking) {
      return bookingJsonFail('BOOKING_NOT_FOUND')
    }

    if (booking.professionalId !== auth.professionalId) {
      return bookingJsonFail('FORBIDDEN')
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
            ? mapAftercareSummaryForGet(booking.aftercareSummary)
            : null,
        },
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

    console.error('GET /api/pro/bookings/[id]/aftercare error', error)
    return jsonFail(500, 'Internal server error.')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const bookingId = await getBookingIdFromContext(ctx)
    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const rawBody: unknown = await req.json().catch(() => null)
    const parsedBody = parsePostBody(rawBody)
    if (!parsedBody.ok) {
      return jsonFail(400, parsedBody.error)
    }

    const requestMeta = readRequestMeta(req)

    const result = await upsertBookingAftercare({
      bookingId,
      professionalId: auth.professionalId,
      notes: parsedBody.value.notes,
      rebookMode: parsedBody.value.normalizedRebook.rebookMode,
      rebookedFor: parsedBody.value.normalizedRebook.rebookedFor,
      rebookWindowStart: parsedBody.value.normalizedRebook.rebookWindowStart,
      rebookWindowEnd: parsedBody.value.normalizedRebook.rebookWindowEnd,
      createRebookReminder: parsedBody.value.createRebookReminder,
      rebookReminderDaysBefore: parsedBody.value.rebookReminderDaysBefore,
      createProductReminder: parsedBody.value.createProductReminder,
      productReminderDaysAfter: parsedBody.value.productReminderDaysAfter,
      recommendedProducts: parsedBody.value.recommendedProducts,
      sendToClient: parsedBody.value.sendToClient,
      version: parsedBody.value.version,
      requestId: requestMeta.requestId,
      idempotencyKey: requestMeta.idempotencyKey,
    })

    return jsonOk(
      {
        aftercare: {
          id: result.aftercare.id,
          rebookMode: result.aftercare.rebookMode,
          rebookedFor: toIsoOrNull(result.aftercare.rebookedFor),
          rebookWindowStart: toIsoOrNull(result.aftercare.rebookWindowStart),
          rebookWindowEnd: toIsoOrNull(result.aftercare.rebookWindowEnd),
          draftSavedAt: toIsoOrNull(result.aftercare.draftSavedAt),
          sentToClientAt: toIsoOrNull(result.aftercare.sentToClientAt),
          lastEditedAt: toIsoOrNull(result.aftercare.lastEditedAt),
          version: result.aftercare.version,
          isFinalized: Boolean(result.aftercare.sentToClientAt),
          publicAccess: result.aftercare.publicAccess,
        },
        remindersTouched: result.remindersTouched,
        clientNotified: result.clientNotified,
        timeZoneUsed: result.timeZoneUsed,
        clientTimeZoneReceived: parsedBody.value.clientTimeZoneReceived,
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