// app/api/holds/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

function isExpired(expiresAt: Date) {
  return expiresAt.getTime() <= Date.now()
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const params = await Promise.resolve(ctx.params)
    const id = pickString(params?.id)
    if (!id) return jsonFail(400, 'Missing hold id.')

    const hold = await prisma.bookingHold.findUnique({
      where: { id },
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

    if (!hold) return jsonFail(404, 'Hold not found.')
    if (hold.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    return jsonOk({
      hold: {
        id: hold.id,
        scheduledFor: hold.scheduledFor.toISOString(),
        expiresAt: hold.expiresAt.toISOString(),
        expired: isExpired(hold.expiresAt),

        professionalId: hold.professionalId,
        offeringId: hold.offeringId,

        locationType: hold.locationType,
        locationId: hold.locationId,
        locationTimeZone: hold.locationTimeZone ?? null,
        locationAddressSnapshot: hold.locationAddressSnapshot ?? null,
        locationLatSnapshot: hold.locationLatSnapshot ?? null,
        locationLngSnapshot: hold.locationLngSnapshot ?? null,
      },
    })
  } catch (e) {
    console.error('GET /api/holds/[id] error', e)
    return jsonFail(500, 'Failed to load hold.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const params = await Promise.resolve(ctx.params)
    const id = pickString(params?.id)
    if (!id) return jsonFail(400, 'Missing hold id.')

    // Idempotent delete: do not leak existence
    const result = await prisma.bookingHold.deleteMany({
      where: { id, clientId },
    })

    return jsonOk({ deleted: result.count > 0 }, 200)
  } catch (e) {
    console.error('DELETE /api/holds/[id] error', e)
    return jsonFail(500, 'Failed to release hold.')
  }
}