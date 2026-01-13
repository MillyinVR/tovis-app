// app/api/pro/bookings/[id]/cancel/route.ts

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getProOwnedBooking, ensureNotTerminal, upper } from '@/lib/booking/guards'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function asTrimmedString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000)
}

/** existingStart < requestedEnd AND existingEnd > requestedStart */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
    if (!proId) return jsonError('Not authorized', 401)

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(id)
    if (!bookingId) return jsonError('Missing booking id', 400)

    const body = (await req.json().catch(() => ({}))) as { reason?: unknown; promoteWaitlist?: unknown }
    const reason = asTrimmedString(body?.reason) ?? 'Cancelled by professional'
    const promoteWaitlist = body?.promoteWaitlist === false ? false : true

    // Confirm ownership + basic state
    const found = await getProOwnedBooking({
      bookingId,
      proId,
      select: {
        id: true,
        professionalId: true,
        status: true,
        finishedAt: true,

        // for slot math + notifications
        scheduledFor: true,
        totalDurationMinutes: true,
        durationMinutesSnapshot: true, // legacy fallback
        bufferMinutes: true,
        clientId: true,
      },
    } as any)
    if (!found.ok) return jsonError(found.error, found.status)

    const booking = found.booking as any

    const nt = ensureNotTerminal(booking)
    if (!nt.ok) return jsonError(nt.error, 409)

    const status = upper(booking.status)

    // Allow cancelling PENDING or ACCEPTED. (Terminal states blocked by ensureNotTerminal.)
    if (status !== 'PENDING' && status !== 'ACCEPTED') {
      return jsonError('Only pending or accepted bookings can be cancelled.', 409)
    }

    const result = await prisma.$transaction(async (tx) => {
      // Cancel the booking
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          // cancelledAt: new Date(),
          // cancellationReason: reason,
        } as any,
        select: { id: true, status: true },
      })

      // Notify the cancelled client
      try {
        await tx.clientNotification.create({
          data: {
            clientId: booking.clientId,
            type: 'BOOKING' as any, // keep flexible; your schema may use an enum
            title: 'Appointment cancelled',
            body: `Your appointment was cancelled by the professional. ${reason ? `Reason: ${reason}` : ''}`.trim(),
            bookingId: booking.id,
            dedupeKey: `BOOKING_CANCELLED:${booking.id}`,
          } as any,
        })
      } catch (e) {
        console.error('Client notification failed (cancel):', e)
      }

      // If it was ACCEPTED, optionally free the slot for waitlist
      let promoted: { id: string; status: string } | null = null

      if (promoteWaitlist && (status === 'ACCEPTED' || status === 'PENDING')) {
        const start = new Date(booking.scheduledFor)

        const dur =
          Number(booking.totalDurationMinutes ?? 0) > 0
            ? Number(booking.totalDurationMinutes)
            : Number(booking.durationMinutesSnapshot ?? 0)

        const buffer = Number(booking.bufferMinutes ?? 0)
        const end = addMinutes(start, dur + buffer)

        // auto-accept setting (if you want it to jump straight to ACCEPTED)
        const pro = await tx.professionalProfile.findUnique({
          where: { id: proId },
          select: { autoAcceptBookings: true },
        })

        // Candidate waitlist bookings around that window
        // We keep the query broad-ish and filter overlaps in JS to avoid schema surprises.
        const candidates = await tx.booking.findMany({
          where: {
            professionalId: proId,
            status: 'WAITLIST' as any,
            scheduledFor: {
              gte: addMinutes(start, -(dur + buffer) * 2),
              lte: addMinutes(start, (dur + buffer) * 2),
            },
          },
          select: {
            id: true,
            clientId: true,
            status: true,
            scheduledFor: true,
            totalDurationMinutes: true,
            durationMinutesSnapshot: true,
            bufferMinutes: true,
          },
          orderBy: { scheduledFor: 'asc' },
          take: 50,
        })

        const match = candidates.find((w: any) => {
          const wStart = new Date(w.scheduledFor)
          const wDur =
            Number(w.totalDurationMinutes ?? 0) > 0
              ? Number(w.totalDurationMinutes)
              : Number(w.durationMinutesSnapshot ?? 0)
          const wBuf = Number(w.bufferMinutes ?? 0)
          const wEnd = addMinutes(wStart, wDur + wBuf)
          return overlaps(wStart, wEnd, start, end)
        })

        if (match) {
          const nextStatus = pro?.autoAcceptBookings ? 'ACCEPTED' : 'PENDING'

          const promotedBooking = await tx.booking.update({
            where: { id: match.id },
            data: { status: nextStatus } as any,
            select: { id: true, status: true },
          })

          promoted = promotedBooking

          // Notify the waitlisted client
          try {
            await tx.clientNotification.create({
              data: {
                clientId: match.clientId,
                type: 'BOOKING' as any,
                title: nextStatus === 'ACCEPTED' ? 'You’re in!' : 'Slot opened up',
                body:
                  nextStatus === 'ACCEPTED'
                    ? 'A spot opened up and your appointment was accepted.'
                    : 'A spot opened up. Your request is now pending professional approval.',
                bookingId: match.id,
                dedupeKey: `WAITLIST_PROMOTED:${match.id}:${nextStatus}`,
              } as any,
            })
          } catch (e) {
            console.error('Client notification failed (waitlist promote):', e)
          }
        }
      }

      return { updated, promoted }
    })

    return NextResponse.json(
      {
        ok: true,
        booking: result.updated,
        promotedWaitlist: result.promoted, // null if none matched
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('PATCH /api/pro/bookings/[id]/cancel error', e)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
