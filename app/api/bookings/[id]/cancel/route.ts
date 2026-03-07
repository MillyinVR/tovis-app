// app/api/bookings/[id]/cancel/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { pickString } from '@/app/api/_utils/pick'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { BookingStatus, Role, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function isAdminRole(role: Role) {
  return role === Role.ADMIN
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.CLIENT, Role.PRO, Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.')
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        professionalId: true,
        startedAt: true,
        finishedAt: true,
        sessionStep: true,
      },
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.')
    }

    const clientId = user.clientProfile?.id ?? null
    const proId = user.professionalProfile?.id ?? null

    const isOwnerClient = clientId === booking.clientId
    const isOwnerPro = proId === booking.professionalId
    const isAdmin = isAdminRole(user.role)

    if (!isAdmin && !isOwnerClient && !isOwnerPro) {
      return jsonFail(403, 'Forbidden.')
    }

    if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
      return jsonFail(409, 'Completed bookings cannot be cancelled.')
    }

    if (booking.status === BookingStatus.CANCELLED) {
      return jsonOk(
        {
          id: booking.id,
          status: booking.status,
          sessionStep: booking.sessionStep ?? SessionStep.NONE,
        },
        200,
      )
    }

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        sessionStep: SessionStep.NONE,
        startedAt: null,
        finishedAt: null,
      },
      select: {
        id: true,
        status: true,
        sessionStep: true,
      },
    })

    return jsonOk(
      {
        id: updated.id,
        status: updated.status,
        sessionStep: updated.sessionStep,
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/bookings/[id]/cancel error', e)
    return jsonFail(500, 'Failed to cancel booking.')
  }
}