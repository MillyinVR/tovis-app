// app/api/v1/bookings/[id]/no-show-fee/waive/route.ts
//
// Waive (forgive) a no-show / late-cancel fee that was assessed but never
// successfully collected. The money mechanics + state rules live in the write
// boundary (waiveNoShowFee): only a FAILED fee is waivable, WAIVED is a no-op,
// and a CHARGED fee must be refunded instead. This route is auth + ownership +
// idempotency + result mapping.
//
//   - PRO   may waive on their OWN bookings.
//   - ADMIN may waive on any booking (acts on the booking's professional).
// No money moves — this only records the forgiveness so the fee stops reading
// as outstanding in the money-trail inspector.

import { Role, type Prisma } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import { pickString } from '@/app/api/_utils/pick'
import { jsonFail } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'
import { waiveNoShowFee } from '@/lib/booking/writeBoundary'
import { getBookingFailPayload, isBookingError } from '@/lib/booking/errors'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROUTE_OPERATION = 'POST /api/v1/bookings/[id]/no-show-fee/waive'

type WaiveSuccessBody = {
  ok: true
  noShowFee: { status: string; waived: boolean }
}

type WaiveErrorBody = {
  ok: false
  error: string
  code: string
}

type WaiveRouteBody = WaiveSuccessBody | WaiveErrorBody

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireUser({ roles: [Role.PRO, Role.ADMIN] })
    if (!auth.ok) {
      return auth.res
    }

    const user = auth.user
    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Booking id is required.', {
        code: 'BOOKING_ID_REQUIRED',
      })
    }

    // Resolve the professional this waive acts on. Pro acts on themselves;
    // admin acts on the booking's professional. Missing / foreign-to-this-pro
    // bookings collapse to a uniform 404.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
    }

    const proProfileId = user.professionalProfile?.id ?? null

    if (user.role === Role.PRO) {
      if (!proProfileId || booking.professionalId !== proProfileId) {
        return jsonFail(404, 'Booking not found.', {
          code: 'BOOKING_NOT_FOUND',
        })
      }
    }

    const professionalId =
      user.role === Role.ADMIN ? booking.professionalId : proProfileId

    if (!professionalId) {
      return jsonFail(404, 'Booking not found.', { code: 'BOOKING_NOT_FOUND' })
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'pro:bookings:write',
      key: proRateLimitKey({
        professionalId,
        userId: user.id,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const response = await withRouteIdempotency<WaiveRouteBody>(
      {
        request: req,
        actor: {
          actorUserId: user.id,
          actorRole: user.role,
        },
        route: IDEMPOTENCY_ROUTES.BOOKING_NO_SHOW_FEE_WAIVE,
        requestLabel: 'no-show fee waive',
        requestBody: {
          bookingId,
          professionalId,
          actorUserId: user.id,
          actorRole: user.role,
        } satisfies Prisma.InputJsonObject,
        messages: {
          missingKey: 'Missing idempotency key for no-show fee waive.',
          inProgress: 'A matching waive request is already in progress.',
          conflict:
            'This idempotency key was already used with different waive details.',
        },
        operation: ROUTE_OPERATION,
      },
      async () => {
        try {
          const result = await waiveNoShowFee({ bookingId, professionalId })
          const body: WaiveSuccessBody = {
            ok: true,
            noShowFee: { status: result.status, waived: result.meta.mutated },
          }
          return { status: 200, body }
        } catch (error: unknown) {
          if (isBookingError(error)) {
            const fail = getBookingFailPayload(error.code)
            return {
              status: fail.httpStatus,
              body: {
                ok: false,
                error: fail.userMessage,
                code: error.code,
              },
            }
          }
          throw error
        }
      },
    )

    return response
  } catch (error: unknown) {
    console.error(`${ROUTE_OPERATION} error`, safeError(error))
    return jsonFail(500, 'Failed to waive the no-show fee.')
  }
}
