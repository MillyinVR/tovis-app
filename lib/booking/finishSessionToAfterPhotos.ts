// lib/booking/finishSessionToAfterPhotos.ts
import 'server-only'

import { BookingServiceItemType, SessionStep } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  confirmBookingFinalReview,
  finishBookingSession,
} from '@/lib/booking/writeBoundary'

export type FinishSessionToAfterPhotosArgs = {
  bookingId: string
  professionalId: string
  requestId?: string | null
  idempotencyKey?: string | null
}

export type FinishSessionToAfterPhotosResult = {
  sessionStep: SessionStep
}

/**
 * "Finish service" choke point.
 *
 * The state machine still routes SERVICE_IN_PROGRESS → FINISH_REVIEW →
 * AFTER_PHOTOS, and FINISH_REVIEW is where line items get finalized. We no
 * longer surface the intermediate "Ready for wrap-up" screen, so this helper
 * runs both transitions back-to-back: finish the in-progress service and then
 * finalize the current menu, landing the booking in AFTER_PHOTOS so the pro
 * goes straight to after photos. It does NOT send aftercare to the client —
 * that stays an explicit step on the wrap-up page.
 *
 * Idempotent: it inspects the current step first, so a replay (already in
 * FINISH_REVIEW / AFTER_PHOTOS / DONE) only runs the remaining transitions.
 */
export async function finishSessionToAfterPhotos(
  args: FinishSessionToAfterPhotosArgs,
): Promise<FinishSessionToAfterPhotosResult> {
  const current = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: { sessionStep: true },
  })

  let step = current?.sessionStep ?? SessionStep.NONE

  if (step === SessionStep.SERVICE_IN_PROGRESS) {
    const finished = await finishBookingSession({
      bookingId: args.bookingId,
      professionalId: args.professionalId,
      requestId: args.requestId ?? null,
      idempotencyKey: args.idempotencyKey ?? null,
    })

    step = finished.booking.sessionStep ?? SessionStep.NONE
  }

  if (step === SessionStep.FINISH_REVIEW) {
    const booking = await prisma.booking.findUnique({
      where: { id: args.bookingId },
      select: {
        subtotalSnapshot: true,
        serviceItems: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            serviceId: true,
            offeringId: true,
            itemType: true,
            priceSnapshot: true,
            durationMinutesSnapshot: true,
            notes: true,
            sortOrder: true,
          },
        },
      },
    })

    if (booking && booking.serviceItems.length > 0) {
      const result = await confirmBookingFinalReview({
        bookingId: args.bookingId,
        professionalId: args.professionalId,
        finalLineItems: booking.serviceItems.map((item, index) => ({
          bookingServiceItemId: item.id,
          serviceId: item.serviceId,
          offeringId: item.offeringId,
          itemType:
            item.itemType ??
            (index === 0
              ? BookingServiceItemType.BASE
              : BookingServiceItemType.ADD_ON),
          price: item.priceSnapshot,
          durationMinutes: item.durationMinutesSnapshot,
          notes: item.notes,
          sortOrder: item.sortOrder,
        })),
        expectedSubtotal: booking.subtotalSnapshot,
        recommendedProducts: [],
      })

      step = result.booking.sessionStep ?? SessionStep.NONE
    }
  }

  return { sessionStep: step }
}
