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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

/** Duration truth: canonical totalDurationMinutes, fallback 60 */
function durationOrDefault(totalDurationMinutes: unknown) {
  const n = Number(totalDurationMinutes ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 60
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(params?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id')

    const body = (await req.json().catch(() => ({}))) as {
      reason?: unknown
      promoteWaitlist?: unknown
    }

    const reason = asTrimmedString(body?.reason) ?? 'Cancelled by professional'
    const promoteWaitlist = body?.promoteWaitlist === false ? false : true

    // Confirm ownership + state
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
      // Cancel booking
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.CANCELLED },
        select: { id: true, status: true },
      })

      // Notify cancelled client
      try {
        await tx.clientNotification.create({
          data: {
            clientId: booking.clientId,
            type: ClientNotificationType.BOOKING_CANCELLED, // ✅ correct enum for this table
            title: 'Appointment cancelled',
            body: `Your appointment was cancelled by the professional.${reason ? ` Reason: ${reason}` : ''}`.trim(),
            bookingId: booking.id,
            dedupeKey: `BOOKING_CANCELLED:${booking.id}`,
          },
        })
      } catch (e) {
        console.error('Client notification failed (cancel):', e)
      }

      let promoted: { id: string; status: BookingStatus } | null = null

      if (promoteWaitlist) {
        const start = new Date(booking.scheduledFor)
        const dur = durationOrDefault(booking.totalDurationMinutes)
        const buffer = Math.max(0, Number(booking.bufferMinutes ?? 0))
        const end = addMinutes(start, dur + buffer)

        const pro = await tx.professionalProfile.findUnique({
          where: { id: proId },
          select: { autoAcceptBookings: true },
        })

        const candidates = await tx.booking.findMany({
          where: {
            professionalId: proId,
            status: BookingStatus.WAITLIST,
            scheduledFor: {
              gte: addMinutes(start, -(dur + buffer) * 2),
              lte: addMinutes(start, (dur + buffer) * 2),
            },
          },
          select: {
            id: true,
            clientId: true,
            scheduledFor: true,
            totalDurationMinutes: true,
            bufferMinutes: true,
          },
          orderBy: { scheduledFor: 'asc' },
          take: 50,
        })

        const match = candidates.find((w) => {
          const wStart = new Date(w.scheduledFor)
          const wDur = durationOrDefault(w.totalDurationMinutes)
          const wBuf = Math.max(0, Number(w.bufferMinutes ?? 0))
          const wEnd = addMinutes(wStart, wDur + wBuf)
          return overlaps(wStart, wEnd, start, end)
        })

        if (match) {
          const nextStatus = pro?.autoAcceptBookings ? BookingStatus.ACCEPTED : BookingStatus.PENDING

          const promotedBooking = await tx.booking.update({
            where: { id: match.id },
            data: { status: nextStatus },
            select: { id: true, status: true },
          })

          promoted = promotedBooking

          try {
            await tx.clientNotification.create({
              data: {
                clientId: match.clientId,
                type: ClientNotificationType.BOOKING_CANCELLED, // ✅ correct enum
                title: nextStatus === BookingStatus.ACCEPTED ? 'You’re in!' : 'Slot opened up',
                body:
                  nextStatus === BookingStatus.ACCEPTED
                    ? 'A spot opened up and your appointment was accepted.'
                    : 'A spot opened up. Your request is now pending professional approval.',
                bookingId: match.id,
                dedupeKey: `WAITLIST_PROMOTED:${match.id}:${nextStatus}`,
              },
            })
          } catch (e) {
            console.error('Client notification failed (waitlist promote):', e)
          }
        }
      }

      return { updated, promoted }
    })

    return jsonOk({ booking: result.updated, promotedWaitlist: result.promoted }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/bookings/[id]/cancel error', e)
    return jsonFail(500, 'Internal server error')
  }
}