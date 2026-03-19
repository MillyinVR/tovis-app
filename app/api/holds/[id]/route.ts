// app/api/holds/[id]/route.ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { getBookingFailPayload, isBookingError } from '@/lib/booking/errors'
import { releaseHold } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

const HOLD_ROUTE_SELECT = {
  id: true,
  clientId: true,
  professionalId: true,
  offeringId: true,
  scheduledFor: true,
  expiresAt: true,
  locationType: true,
  locationId: true,
  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
} satisfies Prisma.BookingHoldSelect

type HoldRouteRecord = Prisma.BookingHoldGetPayload<{
  select: typeof HOLD_ROUTE_SELECT
}>

function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now()
}

async function getHoldId(ctx: Ctx): Promise<string | null> {
  const params = await Promise.resolve(ctx.params)
  return pickString(params?.id)
}

function toHoldDto(hold: HoldRouteRecord) {
  return {
    id: hold.id,
    scheduledFor: hold.scheduledFor.toISOString(),
    expiresAt: hold.expiresAt.toISOString(),
    expired: isExpired(hold.expiresAt),

    professionalId: hold.professionalId,
    offeringId: hold.offeringId,

    locationType: hold.locationType,
    locationId: hold.locationId ?? null,
    locationTimeZone: hold.locationTimeZone ?? null,
    locationAddressSnapshot: hold.locationAddressSnapshot ?? null,
    locationLatSnapshot: hold.locationLatSnapshot ?? null,
    locationLngSnapshot: hold.locationLngSnapshot ?? null,
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId
    const holdId = await getHoldId(ctx)

    if (!holdId) {
      const fail = getBookingFailPayload('HOLD_ID_REQUIRED')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const hold = await prisma.bookingHold.findUnique({
      where: { id: holdId },
      select: HOLD_ROUTE_SELECT,
    })

    if (!hold) {
      const fail = getBookingFailPayload('HOLD_NOT_FOUND')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    if (hold.clientId !== clientId) {
      const fail = getBookingFailPayload('HOLD_FORBIDDEN')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    return jsonOk(
      {
        hold: toHoldDto(hold),
      },
      200,
    )
  } catch (error: unknown) {
    console.error('GET /api/holds/[id] error', error)
    return jsonFail(500, 'Failed to load hold.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const holdId = await getHoldId(ctx)

    if (!holdId) {
      const fail = getBookingFailPayload('HOLD_ID_REQUIRED')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const result = await releaseHold({
      holdId,
      clientId: auth.clientId,
    })

    return jsonOk(
      {
        deleted: result.meta.mutated,
        holdId: result.holdId,
        meta: result.meta,
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      const fail = getBookingFailPayload(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    console.error('DELETE /api/holds/[id] error', error)
    return jsonFail(500, 'Failed to release hold.')
  }
}