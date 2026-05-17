// lib/booking/aftercarePreselectedSlot.ts

import {
  AftercareRebookMode,
  ClientActionTokenKind,
} from '@prisma/client'

import type { ProPreselectedAftercareSlot } from './overlapPolicy'

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
    rebookMode: AftercareRebookMode
    rebookedFor: Date | null
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
            rebookMode: true
            rebookedFor: true
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
          rebookMode: true,
          rebookedFor: true,
        },
      },
    },
  })

  if (!token) {
    return null
  }

  if (token.kind !== ClientActionTokenKind.AFTERCARE_ACCESS) {
    return null
  }

  if (token.clientId !== clientId) {
    return null
  }

  if (token.professionalId !== professionalId) {
    return null
  }

  if (token.bookingId !== bookingId) {
    return null
  }

  if (!token.aftercareSummaryId) {
    return null
  }

  if (token.revokedAt) {
    return null
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    return null
  }

  const aftercareSummary = token.aftercareSummary

  if (!aftercareSummary) {
    return null
  }

  if (aftercareSummary.id !== token.aftercareSummaryId) {
    return null
  }

  if (aftercareSummary.bookingId !== bookingId) {
    return null
  }

  if (aftercareSummary.rebookMode !== AftercareRebookMode.BOOKED_NEXT_APPOINTMENT) {
    return null
  }

  if (!aftercareSummary.rebookedFor) {
    return null
  }

  return {
    aftercareSummaryId: aftercareSummary.id,
    clientActionTokenId: token.id,
    professionalId: token.professionalId,
    startsAt: aftercareSummary.rebookedFor,
  }
}