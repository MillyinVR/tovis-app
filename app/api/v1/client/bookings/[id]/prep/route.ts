// app/api/v1/client/bookings/[id]/prep/route.ts
//
// The client ticking (and unticking) a row of their pro's "Before you go"
// checklist.
//
// 🔴 This is the FIRST client-written row on a booking. Everything else hanging
// off Booking is pro-written or system-written, so none of the existing write
// paths apply and the checks are spelled out here:
//
//   1. The caller is a client (requireClient).
//   2. They own THIS booking (requireClientBookingOwnership — a foreign booking
//      404s exactly like a missing one, no leak).
//   3. The row they are ticking actually belongs to this booking's pro AND
//      resolves for this booking's offering — otherwise a client could tick a
//      row from another pro's list, or from a sibling service's list, simply by
//      knowing its id.
//   4. The booking is still in a state that accepts ticks, RE-CHECKED INSIDE
//      the transaction. The screen was rendered when the appointment was
//      upcoming; by the time the tap lands the pro may have cancelled it.
//      See lib/booking/prep.ts#isPrepWritableStatus.
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { requireClientBookingOwnership } from '@/app/api/_utils/auth/requireClientBookingOwnership'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isPrepWritableStatus, selectPrepItemsForOffering } from '@/lib/booking/prep'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Body = { prepItemId?: unknown; checked?: unknown }

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
    const prepItemId = pickString(body?.prepItemId)
    if (!prepItemId) return jsonFail(400, 'Missing prepItemId.')
    if (typeof body?.checked !== 'boolean') {
      return jsonFail(400, 'checked must be true or false.')
    }
    const checked = body.checked

    const result = await prisma.$transaction(async (tx) => {
      // Re-read INSIDE the transaction. The ownership gate above proved the
      // booking was the client's a moment ago; this proves it is still tickable
      // now, and does so under the same lock as the write.
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          status: true,
          professionalId: true,
          offeringId: true,
        },
      })
      if (!booking) return { kind: 'GONE' as const }
      if (!isPrepWritableStatus(booking.status)) {
        return { kind: 'NOT_WRITABLE' as const, status: booking.status }
      }

      // The row must be one this booking would actually render. Checking the
      // pro alone is not enough: a pro's OTHER service's list belongs to the
      // same professional and must still be refused here.
      const rows = await tx.proPrepItem.findMany({
        where: {
          professionalId: booking.professionalId,
          isActive: true,
          OR: [
            { offeringId: null },
            ...(booking.offeringId ? [{ offeringId: booking.offeringId }] : []),
          ],
        },
        select: { id: true, text: true, sortOrder: true, offeringId: true },
      })
      const { items } = selectPrepItemsForOffering(rows, booking.offeringId)
      if (!items.some((item) => item.id === prepItemId)) {
        return { kind: 'UNKNOWN_ITEM' as const }
      }

      if (checked) {
        // Existence IS the tick, so a repeated tap is a no-op rather than a
        // duplicate row or an error.
        await tx.bookingPrepCheck.upsert({
          where: { bookingId_prepItemId: { bookingId, prepItemId } },
          create: { bookingId, prepItemId },
          update: {},
        })
      } else {
        await tx.bookingPrepCheck.deleteMany({
          where: { bookingId, prepItemId },
        })
      }

      const checkedIds = await tx.bookingPrepCheck.findMany({
        where: { bookingId },
        select: { prepItemId: true },
      })

      return {
        kind: 'OK' as const,
        total: items.length,
        checkedItemIds: checkedIds.map((row) => row.prepItemId),
      }
    })

    if (result.kind === 'GONE') return jsonFail(404, 'Booking not found.')
    if (result.kind === 'UNKNOWN_ITEM') {
      return jsonFail(404, 'That checklist item is not on this appointment.')
    }
    if (result.kind === 'NOT_WRITABLE') {
      return jsonFail(
        409,
        'This appointment is no longer being prepared for.',
        { code: 'PREP_NOT_WRITABLE', status: result.status },
      )
    }

    return jsonOk({
      ok: true,
      checkedItemIds: result.checkedItemIds,
      doneCount: result.checkedItemIds.length,
      totalCount: result.total,
    })
  } catch (err) {
    console.error('[client prep tick]', safeError(err))
    return jsonFail(500, 'Could not update your checklist.')
  }
}
