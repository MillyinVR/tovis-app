// app/api/v1/client/bookings/[id]/board/route.ts
//
// The client handing one of their inspiration boards to the pro for this
// booking — "Send my board to Noor" — and taking it back.
//
// 🔴 A DISCLOSURE, so it is gated on BOTH sides of the relationship:
//
//   · the caller owns the BOOKING (a foreign booking 404s like a missing one),
//   · and the caller owns the BOARD (otherwise a client could disclose someone
//     else's private board to their own pro by knowing its id).
//
// `Board.visibility` is deliberately NOT written. A private board stays private
// to everyone except the pro on this booking, and DELETE revokes that again.
// Sharing is not a one-way door.
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { requireClientBookingOwnership } from '@/app/api/_utils/auth/requireClientBookingOwnership'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isPrepWritableStatus } from '@/lib/booking/prep'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Body = { boardId?: unknown; shared?: unknown }

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const own = await requireClientBookingOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const body = (await req.json().catch(() => ({}))) as Body
    const boardId = pickString(body?.boardId)
    if (!boardId) return jsonFail(400, 'Missing boardId.')
    if (typeof body?.shared !== 'boolean') {
      return jsonFail(400, 'shared must be true or false.')
    }
    const shared = body.shared

    const result = await prisma.$transaction(async (tx) => {
      // Re-read under the transaction: the screen was rendered while the
      // appointment was upcoming, and the pro may have cancelled it since.
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, status: true },
      })
      if (!booking) return { kind: 'GONE' as const }

      // Revoking is always allowed — a client must be able to withdraw a
      // disclosure whatever state the booking has reached. Only GRANTING is
      // gated on the appointment still being ahead of them.
      if (shared && !isPrepWritableStatus(booking.status)) {
        return { kind: 'NOT_WRITABLE' as const, status: booking.status }
      }

      // Own the board, or this is someone else's board being disclosed.
      const board = await tx.board.findUnique({
        where: { id: boardId },
        select: { id: true, clientId: true, name: true },
      })
      if (!board || board.clientId !== clientId) {
        return { kind: 'NO_BOARD' as const }
      }

      if (shared) {
        await tx.bookingBoardShare.upsert({
          where: { bookingId_boardId: { bookingId, boardId } },
          create: { bookingId, boardId },
          update: {},
        })
      } else {
        await tx.bookingBoardShare.deleteMany({ where: { bookingId, boardId } })
      }

      const remaining = await tx.bookingBoardShare.findMany({
        where: { bookingId },
        select: { boardId: true },
      })

      return {
        kind: 'OK' as const,
        boardName: board.name,
        sharedBoardIds: remaining.map((row) => row.boardId),
      }
    })

    if (result.kind === 'GONE') return jsonFail(404, 'Booking not found.')
    if (result.kind === 'NO_BOARD') return jsonFail(404, 'Board not found.')
    if (result.kind === 'NOT_WRITABLE') {
      return jsonFail(
        409,
        'This appointment is no longer being prepared for.',
        { code: 'PREP_NOT_WRITABLE', status: result.status },
      )
    }

    return jsonOk({
      ok: true,
      shared,
      boardName: result.boardName,
      sharedBoardIds: result.sharedBoardIds,
    })
  } catch (err) {
    console.error('[client booking board share]', safeError(err))
    return jsonFail(500, 'Could not update your board.')
  }
}
