// app/api/holds/[id]/route.ts
// app/api/holds/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

type HoldRouteRecord = {
  id: string
  clientId: string | null
  professionalId: string
  offeringId: string
  scheduledFor: Date
  expiresAt: Date
  locationType: string
  locationId: string | null
  locationTimeZone: string | null
  locationAddressSnapshot: unknown
  locationLatSnapshot: unknown
  locationLngSnapshot: unknown
}

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
      return jsonFail(400, 'Missing hold id.')
    }

    const hold = await prisma.bookingHold.findUnique({
      where: { id: holdId },
      select: {
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
      },
    })

    if (!hold) {
      return jsonFail(404, 'Hold not found.')
    }

    if (hold.clientId !== clientId) {
      return jsonFail(403, 'Forbidden.')
    }

    return jsonOk(
      {
        hold: toHoldDto(hold),
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/holds/[id] error', error)
    return jsonFail(500, 'Failed to load hold.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId
    const holdId = await getHoldId(ctx)

    if (!holdId) {
      return jsonFail(400, 'Missing hold id.')
    }

    const result = await prisma.bookingHold.deleteMany({
      where: {
        id: holdId,
        clientId,
      },
    })

    return jsonOk(
      {
        deleted: result.count > 0,
      },
      200,
    )
  } catch (error) {
    console.error('DELETE /api/holds/[id] error', error)
    return jsonFail(500, 'Failed to release hold.')
  }
}