// app/api/bookings/[id]/aftercare/route.ts
import { prisma } from '@/lib/prisma'
import { jsonOk, jsonFail } from '@/app/api/_utils/responses'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import { rateLimitRedis } from '@/lib/rateLimitRedis'
import { getAftercareSummary, enqueueAftercareSend } from '@/lib/aftercare/aftercareSummary'
import { recordStatusTransition } from '@/lib/booking/lifecycleContract'
import { Role, BookingStatus, SessionStep } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.PRO, Role.ADMIN] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    const user = auth.user
    const professionalId = user.professionalProfile?.id ?? null
    const isAdmin = user.role === Role.ADMIN

    // Verify the pro is on this booking (unless admin)
    if (!isAdmin) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { professionalId: true },
      })
      if (!booking) return jsonFail(404, 'Booking not found.')
      if (booking.professionalId !== professionalId) return jsonFail(403, 'Forbidden.')
    }

    const summary = await getAftercareSummary(bookingId)

    return jsonOk({ aftercare: summary })
  } catch (err) {
    console.error('GET /api/bookings/[id]/aftercare error', err)
    return jsonFail(500, 'Failed to fetch aftercare summary.')
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.PRO, Role.ADMIN] })
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params?.id)
    if (!bookingId) return jsonFail(400, 'Booking ID is required.')

    // Rate limit: 5 requests per 60 seconds per booking
    const rl = await rateLimitRedis({
      key: `aftercare-finalize:${bookingId}`,
      limit: 5,
      windowSeconds: 60,
    })
    if (!rl.success) return jsonFail(429, 'Too many requests.')

    const user = auth.user
    const professionalId = user.professionalProfile?.id ?? null
    const isAdmin = user.role === Role.ADMIN

    // Fetch booking to verify access and get current state
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        sessionStep: true,
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')

    if (!isAdmin && booking.professionalId !== professionalId) {
      return jsonFail(403, 'Forbidden.')
    }

    const summary = await getAftercareSummary(bookingId)
    if (!summary) return jsonFail(409, 'Aftercare summary not found.')
    if (summary.sentToClientAt) return jsonFail(409, 'Aftercare already sent.')

    const proId = isAdmin ? booking.professionalId : professionalId!

    // Enqueue the aftercare send (idempotent — sets sentToClientAt)
    await enqueueAftercareSend({
      aftercareSummaryId: summary.id,
      bookingId,
      clientId: booking.clientId,
      professionalId: proId,
    })

    // Record the status transition for observability
    recordStatusTransition({
      from: booking.status,
      to: BookingStatus.COMPLETED,
      actor: isAdmin ? 'ADMIN' : 'PRO',
      route: 'app/api/bookings/[id]/aftercare/route.ts',
      bookingId,
      professionalId: proId,
    })

    // Transition booking to COMPLETED
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.COMPLETED,
        sessionStep: SessionStep.DONE,
        finishedAt: new Date(),
      },
    })

    return jsonOk({ sent: true, bookingId })
  } catch (err) {
    console.error('POST /api/bookings/[id]/aftercare error', err)
    return jsonFail(500, 'Failed to finalize aftercare.')
  }
}
