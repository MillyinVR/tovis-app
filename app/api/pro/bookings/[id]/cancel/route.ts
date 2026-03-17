// app/api/pro/bookings/[id]/cancel/route.ts
import { prisma } from '@/lib/prisma'
import { getProOwnedBooking, ensureNotTerminal, upper } from '@/lib/booking/guards'
import { requirePro, jsonFail, jsonOk } from '@/app/api/_utils'
import { BookingStatus, ClientNotificationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function asTrimmedString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(params.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id')

    const body: unknown = await req.json().catch(() => ({}))
    const reason =
      isRecord(body) ? (asTrimmedString(body.reason) ?? 'Cancelled by professional') : 'Cancelled by professional'

    const found = await getProOwnedBooking({
      bookingId,
      proId,
      select: {
        id: true,
        professionalId: true,
        status: true,
        finishedAt: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
        clientId: true,
      },
    })

    if (!found.ok) return jsonFail(found.status, found.error)
    const booking = found.booking

    const nt = ensureNotTerminal(booking)
    if (!nt.ok) return jsonFail(409, nt.error)

    const status = upper(booking.status)
    if (status !== BookingStatus.PENDING && status !== BookingStatus.ACCEPTED) {
      return jsonFail(409, 'Only pending or accepted bookings can be cancelled.')
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.CANCELLED },
        select: {
          id: true,
          status: true,
        },
      })

      try {
        await tx.clientNotification.create({
          data: {
            clientId: booking.clientId,
            type: ClientNotificationType.BOOKING_CANCELLED,
            title: 'Appointment cancelled',
            body: `Your appointment was cancelled by the professional.${reason ? ` Reason: ${reason}` : ''}`.trim(),
            bookingId: booking.id,
            dedupeKey: `BOOKING_CANCELLED:${booking.id}`,
          },
        })
      } catch (e) {
        console.error('Client notification failed (cancel):', e)
      }

      return { updated }
    })

    return jsonOk({ booking: result.updated }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/bookings/[id]/cancel error', e)
    return jsonFail(500, 'Internal server error')
  }
}