// app/api/v1/client/bookings/[id]/aftercare/route.ts
//
// GET the client's read of their own aftercare for one booking: care notes
// (only once the pro SENT the summary) + the primary featured before/after
// pair. Powers the native client aftercare render; the web booking-detail page
// renders the same data server-side. Read-only, CLIENT-only, ownership-gated.

import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { requireClientBookingOwnership } from '@/app/api/_utils/auth/requireClientBookingOwnership'
import { prisma } from '@/lib/prisma'
import { loadBookingBeforeAfterThumbsFor } from '@/lib/media/bookingBeforeAfter'
import {
  buildClientAftercareDetailDTO,
  type ClientAftercareDetailDTO,
} from '@/lib/dto/clientAftercare'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { clientId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const own = await requireClientBookingOwnership(bookingId, clientId)
    if (!own.ok) return own.res

    const [booking, aftercare, beforeAfter, rebookedNextBooking] = await Promise.all([
      // Lifecycle status drives the aftercare-visibility gate (COMPLETED shows
      // the surface even before a summary is sent); the remaining fields +
      // current checkout selection drive the `checkoutProductsEditable` gate and
      // the client's product-checkout picker (parity with the web detail loader).
      prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          status: true,
          finishedAt: true,
          checkoutStatus: true,
          paymentAuthorizedAt: true,
          paymentCollectedAt: true,
          checkoutProductItems: {
            orderBy: [{ createdAt: 'asc' }],
            select: {
              recommendationId: true,
              productId: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      }),
      // Only a SENT summary is client-visible — an in-progress draft stays
      // private to the pro (parity with the web detail loader's filter). The
      // recommendedProducts select mirrors the web `aftercareSummarySelect`.
      prisma.aftercareSummary.findFirst({
        where: { bookingId, sentToClientAt: { not: null } },
        select: {
          id: true,
          notes: true,
          sentToClientAt: true,
          // Rebook recommendation (§5 A3-rebook) — mirrors the web detail loader's
          // `aftercareSummarySelect`; drives the native rebook-window card.
          rebookMode: true,
          rebookedFor: true,
          rebookWindowStart: true,
          rebookWindowEnd: true,
          rebookDeclinedAt: true,
          recommendedProducts: {
            take: 50,
            orderBy: { id: 'asc' },
            select: {
              id: true,
              productId: true,
              note: true,
              externalName: true,
              externalUrl: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  brand: true,
                  retailPrice: true,
                },
              },
            },
          },
        },
      }),
      // Featured (else earliest-per-phase) before/after pair, already resolved
      // to render URLs — the shared SSOT the web + client home reuse.
      loadBookingBeforeAfterThumbsFor(bookingId),
      // The AFTERCARE-sourced next booking coupled to this one (its
      // rebookOfBookingId points back here) — lets the rebook card show a
      // confirmed/pending state instead of re-offering Confirm. Mirrors the web
      // detail loader's `rebookedNextBooking` load. Scoped to the authed client.
      prisma.booking.findFirst({
        where: { rebookOfBookingId: bookingId, clientId },
        orderBy: { scheduledFor: 'desc' },
        select: { id: true, status: true, scheduledFor: true },
      }),
    ])

    const dto: ClientAftercareDetailDTO = buildClientAftercareDetailDTO({
      status: booking?.status ?? null,
      finishedAt: booking?.finishedAt ?? null,
      checkoutStatus: booking?.checkoutStatus ?? null,
      paymentAuthorizedAt: booking?.paymentAuthorizedAt ?? null,
      paymentCollectedAt: booking?.paymentCollectedAt ?? null,
      aftercare,
      beforeAfter,
      checkoutProductItems: booking?.checkoutProductItems ?? [],
      rebookedNextBooking,
    })

    return jsonOk(dto)
  } catch (error: unknown) {
    console.error('GET /api/v1/client/bookings/[id]/aftercare error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
