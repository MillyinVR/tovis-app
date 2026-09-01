// app/api/v1/holds/route.ts

import { NextRequest } from 'next/server'
import { Role, ServiceLocationType } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { hasDuplicateStrings, pickStringArray } from '@/lib/pick'
import { isRecord } from '@/lib/guards'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { clientRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { normalizeToMinute } from '@/lib/booking/conflicts'
import { normalizeLocationType } from '@/lib/booking/locationContext'
import {
  isBookingError,
} from '@/lib/booking/errors'
import {
  bookingErrorJsonFail,
  bookingJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { createHold } from '@/lib/booking/writeBoundary'
import { broadcastChange } from '@/lib/live/broadcastAudience'
import {
  HOLD_CREATE_OFFERING_SELECT,
  toCreateHoldOffering,
} from '@/lib/booking/holdCreateOffering'
import type { BookingHoldCreateResponseDTO } from '@/lib/dto/holds'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import {
  idempotencyConflictFail,
  idempotencyInProgressFail,
} from '@/lib/idempotency/responses'
import {
  bookingEntryPointFromHoldContext,
  parseBookingEntryPointSource,
  type BookingEntryPointSource,
} from '@/lib/pro/readiness/bookingEntryPoint'

export const dynamic = 'force-dynamic'

// Mirrors finalize's cap on the same field: the hold reserves what finalize
// will take, so both ends must accept the same selection size.
const MAX_HOLD_ADD_ON_IDS = 50

type ParsedHoldRequest = {
  offeringId: string
  requestedLocationId: string | null
  clientAddressId: string | null
  locationType: ServiceLocationType
  requestedStart: Date
  entryPointSource: BookingEntryPointSource | null
  addOnIds: string[]
  rescheduleBookingId: string | null
  consultId: string | null
}

type HeaderCarrier = {
  headers?: Headers | null
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function nowMs(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function formatServerTimingMetric(name: string, durationMs: number): string {
  return `${name};dur=${Math.max(0, durationMs).toFixed(1)}`
}

function getMutableHeaders(target: HeaderCarrier): Headers {
  if (target.headers instanceof Headers) {
    return target.headers
  }

  const headers = new Headers()

  Object.defineProperty(target, 'headers', {
    value: headers,
    configurable: true,
    enumerable: true,
    writable: true,
  })

  return headers
}

function withServerTiming<T extends Response | HeaderCarrier>(
  response: T,
  metrics: Array<{ name: string; durationMs: number }>,
): T {
  const headers = getMutableHeaders(response)

  headers.set(
    'Server-Timing',
    metrics
      .map((metric) =>
        formatServerTimingMetric(metric.name, metric.durationMs),
      )
      .join(', '),
  )
  headers.set('Cache-Control', 'no-store')

  return response
}

function pickEntryPointSource(
  rawBody: Record<string, unknown>,
): BookingEntryPointSource | null {
  return (
    parseBookingEntryPointSource(rawBody.entryPoint) ??
    parseBookingEntryPointSource(rawBody.bookingEntryPoint) ??
    parseBookingEntryPointSource(rawBody.source)
  )
}

function parseHoldCreateBody(rawBody: unknown): ParsedHoldRequest | Response {
  if (!isRecord(rawBody)) {
    return jsonFail(400, 'Request body must be a JSON object.')
  }

  const offeringId = pickString(rawBody.offeringId)
  const requestedLocationId = pickString(rawBody.locationId)
  const clientAddressId = pickString(rawBody.clientAddressId)
  const locationType = normalizeLocationType(rawBody.locationType)
  const scheduledForRaw = pickString(rawBody.scheduledFor)
  const entryPointSource = pickEntryPointSource(rawBody)
  const addOnIds = pickStringArray(rawBody.addOnIds, MAX_HOLD_ADD_ON_IDS)
  const rescheduleBookingId = pickString(rawBody.rescheduleBookingId)
  // Book the Look, B4. Optional: an ordinary hold sends none. When present the
  // reservation is sized by that consult's booking proposal instead of by this
  // offering's default — see createHold. The id is only a CLAIM here; the write
  // boundary re-checks ownership, the founder gate and the anchor under the
  // session lock before it sizes anything from it.
  const consultId = pickString(rawBody.consultId)

  if (!offeringId) {
    return bookingJsonFail('OFFERING_ID_REQUIRED')
  }

  if (hasDuplicateStrings(addOnIds)) {
    return bookingJsonFail('ADDONS_INVALID')
  }

  // `OfferingAddOn` add-ons on top of a consult proposal stay refused — B7
  // answered decision 10 with the estimate's own beyond-floor LINES instead,
  // which never travel as `addOnIds` (see the refusal in
  // `performLockedCreateHold`). Refused here as well as at the boundary, for
  // the same reason the reschedule pair below is: the contract should be
  // visible on the wire, not only in the write path.
  if (consultId && addOnIds.length > 0) {
    return bookingJsonFail('ADDONS_INVALID', {
      message: 'Add-ons cannot be combined with a consultation proposal.',
      userMessage:
        'Add-ons can’t be chosen for a consultation booking. Your pro will go through extras with you.',
    })
  }

  // A reschedule reserves the booking's committed width, which already includes
  // its original add-ons (B3). Refused here as well as at the boundary so the
  // contract is visible on the wire, not only in the write path.
  if (rescheduleBookingId && addOnIds.length > 0) {
    return bookingJsonFail('ADDONS_INVALID', {
      message: 'Add-ons cannot be changed while rescheduling a booking.',
      userMessage:
        'Add-ons can’t be changed while moving this appointment. Pick a new time first.',
    })
  }

  if (!scheduledForRaw) {
    return bookingJsonFail('INVALID_SCHEDULED_FOR', {
      message: 'Scheduled time is required.',
      userMessage: 'Missing scheduled time.',
    })
  }

  if (!locationType) {
    return bookingJsonFail('LOCATION_TYPE_REQUIRED')
  }

  if (locationType === ServiceLocationType.MOBILE && !clientAddressId) {
    return bookingJsonFail('CLIENT_SERVICE_ADDRESS_REQUIRED')
  }

  const scheduledForParsed = new Date(scheduledForRaw)
  if (!isValidDate(scheduledForParsed)) {
    return bookingJsonFail('INVALID_SCHEDULED_FOR')
  }

  const requestedStart = normalizeToMinute(scheduledForParsed)

  if (requestedStart.getTime() < Date.now() + 60_000) {
    return bookingJsonFail('TIME_IN_PAST')
  }

  return {
    offeringId,
    requestedLocationId,
    clientAddressId,
    locationType,
    requestedStart,
    entryPointSource,
    addOnIds,
    rescheduleBookingId,
    consultId,
  }
}

export async function POST(req: NextRequest) {
  const startedAtMs = nowMs()

  let afterAuthAndBodyMs = startedAtMs
  let afterOfferingLookupMs = startedAtMs
  let afterCreateHoldMs = startedAtMs
  let idempotencyRecordId: string | null = null

  const buildServerTimingMetrics = () => [
    {
      name: 'hold_total',
      durationMs: nowMs() - startedAtMs,
    },
    {
      name: 'hold_auth_body',
      durationMs: afterAuthAndBodyMs - startedAtMs,
    },
    {
      name: 'hold_offering_lookup',
      durationMs: afterOfferingLookupMs - afterAuthAndBodyMs,
    },
    {
      name: 'hold_create',
      durationMs: afterCreateHoldMs - afterOfferingLookupMs,
    },
  ]

  try {
    const auth = await requireClient()

    if (!auth.ok) {
      afterAuthAndBodyMs = nowMs()
      afterOfferingLookupMs = afterAuthAndBodyMs
      afterCreateHoldMs = afterAuthAndBodyMs

      return withServerTiming(auth.res, buildServerTimingMetrics())
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'holds:create',
      key: clientRateLimitKey({
        clientId: auth.clientId,
        userId: auth.user.id,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      afterAuthAndBodyMs = nowMs()
      afterOfferingLookupMs = afterAuthAndBodyMs
      afterCreateHoldMs = afterAuthAndBodyMs

      return withServerTiming(
        rateLimitExceededResponse(rateLimit),
        buildServerTimingMetrics(),
      )
    }

    let rawBody: unknown

    try {
      rawBody = await req.json()
    } catch {
      afterAuthAndBodyMs = nowMs()
      afterOfferingLookupMs = afterAuthAndBodyMs
      afterCreateHoldMs = afterAuthAndBodyMs

      return withServerTiming(
        jsonFail(400, 'Invalid JSON body.'),
        buildServerTimingMetrics(),
      )
    }

    const parsed = parseHoldCreateBody(rawBody)

    afterAuthAndBodyMs = nowMs()
    afterOfferingLookupMs = afterAuthAndBodyMs
    afterCreateHoldMs = afterAuthAndBodyMs

    if (parsed instanceof Response) {
      return withServerTiming(parsed, buildServerTimingMetrics())
    }

    // Idempotency is OPT-IN on this route, and deliberately so. Every other
    // route in IDEMPOTENCY_ROUTES refuses without a key; this one cannot,
    // because both web callers shipped before the key existed and a client
    // already in someone's browser must keep booking. A caller that sends one
    // gets replay protection; a caller that does not gets exactly the old
    // behaviour, which is what it has today anyway.
    const idempotencyKey = req.headers.get('Idempotency-Key')

    if (idempotencyKey?.trim()) {
      const idempotency = await beginIdempotency<BookingHoldCreateResponseDTO>({
        actor: { actorUserId: auth.user.id, actorRole: Role.CLIENT },
        route: IDEMPOTENCY_ROUTES.HOLD_CREATE,
        key: idempotencyKey,
        requestBody: {
          clientId: auth.clientId,
          offeringId: parsed.offeringId,
          requestedStart: parsed.requestedStart.toISOString(),
          locationType: parsed.locationType,
          requestedLocationId: parsed.requestedLocationId,
          clientAddressId: parsed.clientAddressId,
          addOnIds: parsed.addOnIds,
          rescheduleBookingId: parsed.rescheduleBookingId,
          consultId: parsed.consultId,
        },
      })

      if (idempotency.kind === 'in_progress') {
        return withServerTiming(
          idempotencyInProgressFail('hold'),
          buildServerTimingMetrics(),
        )
      }

      if (idempotency.kind === 'conflict') {
        return withServerTiming(
          idempotencyConflictFail(),
          buildServerTimingMetrics(),
        )
      }

      if (idempotency.kind === 'replay') {
        return withServerTiming(
          jsonOk(idempotency.responseBody, idempotency.responseStatus),
          buildServerTimingMetrics(),
        )
      }

      // 'missing_key' is unreachable inside this branch (the key is non-empty),
      // and is the no-op case anyway.
      if (idempotency.kind === 'started') {
        idempotencyRecordId = idempotency.idempotencyRecordId
      }
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: parsed.offeringId },
      select: HOLD_CREATE_OFFERING_SELECT,
    })

    afterOfferingLookupMs = nowMs()
    afterCreateHoldMs = afterOfferingLookupMs

    if (!offering || !offering.isActive) {
      if (idempotencyRecordId) {
        await failIdempotency({ idempotencyRecordId })
        idempotencyRecordId = null
      }

      return withServerTiming(
        bookingJsonFail('OFFERING_NOT_FOUND'),
        buildServerTimingMetrics(),
      )
    }

    const bookingEntryPoint = bookingEntryPointFromHoldContext({
      requestedEntryPoint: parsed.entryPointSource,

      // Keep privileged sources false until this route validates the matching
      // server-side context. This prevents clients from self-claiming NFC,
      // short-code, QR, aftercare, or Pro-created privileges.
      hasAftercareToken: false,
      hasNfcCard: false,
      hasShortCode: false,
      hasQrCode: false,
      hasDirectProfileContext: parsed.entryPointSource === 'DIRECT_PROFILE',
    })

    const result = await createHold({
      clientId: auth.clientId,
      bookingEntryPoint,
      addOnIds: parsed.addOnIds,
      rescheduleBookingId: parsed.rescheduleBookingId,
      consultId: parsed.consultId,
      offering: toCreateHoldOffering(offering),
      requestedStart: parsed.requestedStart,
      requestedLocationId: parsed.requestedLocationId,
      locationType: parsed.locationType,
      clientAddressId: parsed.clientAddressId,
    })

    afterCreateHoldMs = nowMs()

    const responseBody = {
      hold: {
        id: result.hold.id,
        expiresAt: result.hold.expiresAt.toISOString(),
        scheduledFor: result.hold.scheduledFor.toISOString(),
        locationType: result.hold.locationType,
        locationId: result.hold.locationId,
        locationTimeZone: result.hold.locationTimeZone,
        clientAddressId: result.hold.clientAddressId,
        clientAddressSnapshot: result.hold.clientAddressSnapshot,
        durationMinutes: result.hold.durationMinutes,
      },
      meta: result.meta,
    } satisfies BookingHoldCreateResponseDTO

    if (idempotencyRecordId) {
      await completeIdempotency({
        idempotencyRecordId,
        responseStatus: 201,
        responseBody,
      })
      idempotencyRecordId = null
    }

    // Live-sync: the pro's open calendar shows a client's checkout as an
    // anonymous "Checkout in progress" tile with a countdown, and until this
    // ping existed the tile only turned up whenever the grid happened to refetch
    // next — so a pro could take a walk-in on minutes somebody was already
    // paying for, having never been shown it. Same call finalize makes, so it
    // reaches the web shell (`pro:{id}`) AND the phone (`user:{proUserId}`).
    // Fail-open by construction (broadcastChange never throws): a lost ping
    // costs freshness, never correctness — the hold is already committed and
    // every conflict query reads it regardless.
    //
    // ⚠️ AWAITED, on the response path of every slot tap — one indexed lookup
    // (the pro's userId) plus one Realtime POST. `after()` from next/server is
    // the obvious way to move it off that path, and it was tried: it throws
    // outside a request scope, so every direct caller of this handler — the
    // route's own unit suite included — turns into a 500. Matching finalize's
    // inline await instead. If this shows up in `hold_total`, that is the
    // thread to pull, not a guess to make.
    await broadcastChange({
      topic: 'bookings',
      professionalId: offering.professionalId,
    })

    return withServerTiming(
      jsonOk(responseBody, 201),
      buildServerTimingMetrics(),
    )
  } catch (error: unknown) {
    afterCreateHoldMs = nowMs()

    // Release the lock, or the client's retry of a failed hold is refused as
    // "already in progress" for the whole two-minute lock window.
    if (idempotencyRecordId) {
      await failIdempotency({ idempotencyRecordId })
      idempotencyRecordId = null
    }

    if (isBookingError(error)) {
      return withServerTiming(
        bookingErrorJsonFail(error),
        buildServerTimingMetrics(),
      )
    }

    console.error('POST /api/v1/holds error', error)

    return withServerTiming(
      bookingJsonFail('INTERNAL_ERROR'),
      buildServerTimingMetrics(),
    )
  }
}