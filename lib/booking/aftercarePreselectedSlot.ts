// lib/booking/aftercarePreselectedSlot.ts

import { ClientActionTokenKind } from '@prisma/client'
import type { ServiceLocationType } from '@prisma/client'

import type { ProPreselectedAftercareSlot } from './overlapPolicy'

export type AftercareRebookSlotRow = {
  id: string
  professionalId: string
  offeringId: string | null
  locationId: string
  locationType: ServiceLocationType
  startsAt: Date
  endsAt: Date
}

export type AftercarePreselectedSlotTokenRow = {
  id: string
  kind: ClientActionTokenKind
  bookingId: string
  aftercareSummaryId: string | null
  clientId: string
  professionalId: string
  expiresAt: Date
  revokedAt: Date | null
  aftercareSummary: {
    id: string
    bookingId: string
    rebookSlot: AftercareRebookSlotRow | null
  } | null
}

export type AftercarePreselectedSlotReader = {
  clientActionToken: {
    findUnique(args: {
      where: {
        id: string
      }
      select: {
        id: true
        kind: true
        bookingId: true
        aftercareSummaryId: true
        clientId: true
        professionalId: true
        expiresAt: true
        revokedAt: true
        aftercareSummary: {
          select: {
            id: true
            bookingId: true
            rebookSlot: {
              select: {
                id: true
                professionalId: true
                offeringId: true
                locationId: true
                locationType: true
                startsAt: true
                endsAt: true
              }
            }
          }
        }
      }
    }): Promise<AftercarePreselectedSlotTokenRow | null>
  }
}

export type ResolveAftercarePreselectedSlotArgs = {
  tx: AftercarePreselectedSlotReader
  clientActionTokenId: string
  clientId: string
  professionalId: string
  bookingId: string
  now?: Date
}

export async function resolveAftercarePreselectedSlot({
  tx,
  clientActionTokenId,
  clientId,
  professionalId,
  bookingId,
  now = new Date(),
}: ResolveAftercarePreselectedSlotArgs): Promise<ProPreselectedAftercareSlot | null> {
  const token = await tx.clientActionToken.findUnique({
    where: {
      id: clientActionTokenId,
    },
    select: {
      id: true,
      kind: true,
      bookingId: true,
      aftercareSummaryId: true,
      clientId: true,
      professionalId: true,
      expiresAt: true,
      revokedAt: true,
      aftercareSummary: {
        select: {
          id: true,
          bookingId: true,
          rebookSlot: {
            select: {
              id: true,
              professionalId: true,
              offeringId: true,
              locationId: true,
              locationType: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
      },
    },
  })

  if (!token) return null
  if (token.kind !== ClientActionTokenKind.AFTERCARE_ACCESS) return null
  if (token.clientId !== clientId) return null
  if (token.professionalId !== professionalId) return null
  if (token.bookingId !== bookingId) return null
  if (!token.aftercareSummaryId) return null
  if (token.revokedAt) return null
  if (token.expiresAt.getTime() <= now.getTime()) return null

  const aftercareSummary = token.aftercareSummary
  if (!aftercareSummary) return null
  if (aftercareSummary.id !== token.aftercareSummaryId) return null
  if (aftercareSummary.bookingId !== bookingId) return null

  const slot = aftercareSummary.rebookSlot
  if (!slot) return null
  if (slot.professionalId !== professionalId) return null

  return {
    aftercareSummaryId: aftercareSummary.id,
    clientActionTokenId: token.id,
    professionalId: slot.professionalId,
    offeringId: slot.offeringId,
    locationId: slot.locationId,
    locationType: slot.locationType,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
  }
}
