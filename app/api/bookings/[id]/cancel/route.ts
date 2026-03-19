// app/api/bookings/[id]/cancel/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { pickString } from '@/app/api/_utils/pick'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { cancelBooking } from '@/lib/booking/writeBoundary'
import { getBookingFailPayload, isBookingError } from '@/lib/booking/errors'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function isAdminRole(role: Role): boolean {
  return role === Role.ADMIN
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({
      roles: [Role.CLIENT, Role.PRO, Role.ADMIN],
    })
    if (!auth.ok) return auth.res

    const user = auth.user
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)

    if (!bookingId) {
      const fail = getBookingFailPayload('BOOKING_ID_REQUIRED')
      return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
    }

    const clientId = user.clientProfile?.id ?? null
    const professionalId = user.professionalProfile?.id ?? null

    const result = await cancelBooking({
      bookingId,
      actor: isAdminRole(user.role)
        ? {
            kind: 'admin',
            professionalId,
          }
        : clientId
          ? {
              kind: 'client',
              clientId,
            }
          : professionalId
            ? {
                kind: 'pro',
                professionalId,
              }
            : {
                kind: 'admin',
                professionalId: null,
              },
    })

    return jsonOk(
      {
        id: result.booking.id,
        status: result.booking.status,
        sessionStep: result.booking.sessionStep,
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

    console.error('POST /api/bookings/[id]/cancel error', error)
    return jsonFail(500, 'Failed to cancel booking.')
  }
}