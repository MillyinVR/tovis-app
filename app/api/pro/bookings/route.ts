// app/api/pro/bookings/route.ts
import {
  Prisma,
  Role,
  type BookingStatus,
  type ClientClaimStatus,
  type ServiceLocationType,
} from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { createProBookingWithClient } from '@/lib/booking/createProBookingWithClient'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import { computeRequestedEndUtc } from '@/lib/booking/slotReadiness'
import { isRecord } from '@/lib/guards'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { moneyToString } from '@/lib/money'
import { pickBool, pickInt } from '@/lib/pick'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ProBookingSuccessBody = {
  booking: {
    id: string
    clientId: string
    scheduledFor: string
    endsAt: string
    totalDurationMinutes: number
    bufferMinutes: number
    status: BookingStatus
    serviceName: string
    subtotalSnapshot: string
    subtotalCents: number
    locationId: string
    locationType: ServiceLocationType
    clientAddressId: string | null
    stepMinutes: number
    timeZone: string
  }
  client: {
    id: string
    userId: string | null
    email: string | null
    claimStatus: ClientClaimStatus
  }
  invite?: Prisma.InputJsonValue
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
  return jsonFail(409, 'A matching pro booking request is already in progress.', {
    code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  })
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

function toDateOrNull(value: unknown): Date | null {
  const raw = pickString(value)
  if (!raw) return null

  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function decimalToCents(value: Prisma.Decimal): number {
  const asMoneyString = value.toString()
  const cleaned = asMoneyString.replace(/\$/g, '').replace(/,/g, '').trim()
  const match = /^(\d+)(?:\.(\d{0,}))?$/.exec(cleaned)
  if (!match) return 0

  const whole = match[1] || '0'
  let frac = (match[2] || '').slice(0, 2)
  while (frac.length < 2) frac += '0'

  return Math.max(0, Number(whole) * 100 + Number(frac || '0'))
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

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
    const out: Record<string, NestedInputJsonValue> = {}

    for (const key of Object.keys(input).sort()) {
      out[key] = normalizeNestedJsonValue(input[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  const normalized = normalizeNestedJsonValue(value)

  if (normalized === null) {
    return undefined
  }

  return normalized
}

function pickClientPayload(body: Record<string, unknown>) {
  if (isRecord(body.client)) {
    return body.client
  }

  return {
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
  }
}

function pickServiceAddressPayload(body: Record<string, unknown>) {
  if (isRecord(body.serviceAddress)) {
    return body.serviceAddress
  }

  return {
    label: body.label,
    formattedAddress: body.formattedAddress,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    postalCode: body.postalCode,
    countryCode: body.countryCode,
    placeId: body.placeId,
    lat: body.lat,
    lng: body.lng,
    isDefault: body.isDefault,
  }
}

function readProBookingMeta(request: Request): {
  requestId: string | null
  idempotencyKey: string | null
} {
  const requestId =
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null

  const idempotencyKey =
    pickString(request.headers.get('idempotency-key')) ??
    pickString(request.headers.get('x-idempotency-key')) ??
    null

  return { requestId, idempotencyKey }
}

function buildProBookingSuccessBody(args: {
  bookingResult: {
    booking: {
      id: string
      scheduledFor: Date | string
      totalDurationMinutes: number
      bufferMinutes: number
      status: BookingStatus
    }
    serviceName: string
    subtotalSnapshot: Prisma.Decimal
    locationId: string
    locationType: ServiceLocationType
    clientAddressId: string | null
    stepMinutes: number
    appointmentTimeZone: string
  }
  client: {
    id: string
    userId: string | null
    email: string | null
    claimStatus: ClientClaimStatus
  }
  invite: unknown
}): ProBookingSuccessBody {
  const scheduledFor = new Date(args.bookingResult.booking.scheduledFor)

  const endsAt = computeRequestedEndUtc({
    startUtc: scheduledFor,
    durationMinutes: Number(args.bookingResult.booking.totalDurationMinutes),
    bufferMinutes: Number(args.bookingResult.booking.bufferMinutes),
  })

  const responseBody: ProBookingSuccessBody = {
    booking: {
      id: args.bookingResult.booking.id,
      clientId: args.client.id,
      scheduledFor: scheduledFor.toISOString(),
      endsAt: endsAt.toISOString(),
      totalDurationMinutes: Number(
        args.bookingResult.booking.totalDurationMinutes,
      ),
      bufferMinutes: Number(args.bookingResult.booking.bufferMinutes),
      status: args.bookingResult.booking.status,
      serviceName: args.bookingResult.serviceName,
      subtotalSnapshot:
        moneyToString(args.bookingResult.subtotalSnapshot) ??
        args.bookingResult.subtotalSnapshot.toString(),
      subtotalCents: decimalToCents(args.bookingResult.subtotalSnapshot),
      locationId: args.bookingResult.locationId,
      locationType: args.bookingResult.locationType,
      clientAddressId: args.bookingResult.clientAddressId,
      stepMinutes: args.bookingResult.stepMinutes,
      timeZone: args.bookingResult.appointmentTimeZone,
    },
    client: {
      id: args.client.id,
      userId: args.client.userId,
      email: args.client.email,
      claimStatus: args.client.claimStatus,
    },
  }

  const normalizedInvite = normalizeJsonValue(args.invite)

  if (normalizedInvite !== undefined) {
    responseBody.invite = normalizedInvite
  }

  return responseBody
}

export async function POST(req: Request) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    const { requestId, idempotencyKey } = readProBookingMeta(req)

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to create this booking.',
      })
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const clientId = pickString(body.clientId)
    const client = pickClientPayload(body)
    const serviceAddress = pickServiceAddressPayload(body)

    const clientAddressId = pickString(body.clientAddressId)
    const scheduledFor = toDateOrNull(body.scheduledFor)
    const internalNotes = pickString(body.internalNotes)
    const overrideReason = pickString(body.overrideReason)

    const locationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const offeringId = pickString(body.offeringId)

    const requestedBufferMinutes = pickInt(body.bufferMinutes)
    const requestedTotalDurationMinutes = pickInt(body.totalDurationMinutes)

    const allowOutsideWorkingHours =
      pickBool(body.allowOutsideWorkingHours) ?? false
    const allowShortNotice = pickBool(body.allowShortNotice) ?? false
    const allowFarFuture = pickBool(body.allowFarFuture) ?? false

    if (!scheduledFor) {
      return bookingJsonFail('INVALID_SCHEDULED_FOR')
    }

    if (!locationId) {
      return bookingJsonFail('LOCATION_ID_REQUIRED')
    }

    if (!locationType) {
      return bookingJsonFail('LOCATION_TYPE_REQUIRED')
    }

    if (!offeringId) {
      return bookingJsonFail('OFFERING_ID_REQUIRED')
    }

    const idempotency = await beginIdempotency<ProBookingSuccessBody>({
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.PRO_BOOKING_CREATE,
      key: idempotencyKey,
      requestBody: {
        professionalId,
        actorUserId,
        clientId,
        client,
        clientAddressId,
        serviceAddress,
        offeringId,
        locationId,
        locationType,
        scheduledFor: scheduledFor.toISOString(),
        internalNotes,
        overrideReason,
        requestedBufferMinutes,
        requestedTotalDurationMinutes,
        allowOutsideWorkingHours,
        allowShortNotice,
        allowFarFuture,
      },
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

    const result = await createProBookingWithClient({
      professionalId,
      actorUserId,
      overrideReason,
      clientId,
      client,
      clientAddressId,
      serviceAddress,
      offeringId,
      locationId,
      locationType,
      scheduledFor,
      internalNotes,
      requestedBufferMinutes,
      requestedTotalDurationMinutes,
      allowOutsideWorkingHours,
      allowShortNotice,
      allowFarFuture,
      requestId,
      idempotencyKey,
    })

    if (!result.ok) {
      await failIdempotency({ idempotencyRecordId })
      idempotencyRecordId = null
      return jsonFail(result.status, result.error, { code: result.code })
    }

    const bookingResult = result.bookingResult

    const responseBody = buildProBookingSuccessBody({
      bookingResult,
      client: {
        id: result.clientId,
        userId: result.clientUserId,
        email: result.clientEmail,
        claimStatus: result.clientClaimStatus,
      },
      invite: result.invite,
    })

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 201,
      responseBody,
    })

    return jsonOk(responseBody, 201)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failIdempotency({ idempotencyRecordId }).catch((failError) => {
        console.error(
          'POST /api/pro/bookings idempotency failure update error',
          failError,
        )
      })
    }

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings error', error)
    captureBookingException({ error, route: 'POST /api/pro/bookings' })
    return bookingJsonFail('INTERNAL_ERROR', {
      message:
        error instanceof Error ? error.message : 'Failed to create booking.',
      userMessage: 'Failed to create booking.',
    })
  }
}