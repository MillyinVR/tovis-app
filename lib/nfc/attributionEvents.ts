// lib/nfc/attributionEvents.ts
//
// Single source of truth for the NFC AttributionEvent `eventType` values and a
// helper to record a raw tap. Centralizing the strings keeps the writer
// (lib/tapIntentConsume.ts, the tap route) and the readers (analytics) in sync.

import { Prisma } from '@prisma/client'

export const NFC_ATTRIBUTION_EVENT = {
  /** A real human tapped a card / entered a short code (funnel top). */
  CARD_TAPPED: 'NFC_CARD_TAPPED',
  /** An unclaimed card was claimed during signup/tap (a new account/owner). */
  CARD_CLAIMED: 'NFC_CARD_CLAIMED',
  /** A tap landed on an already-claimed card. */
  TAP_EXISTING_CARD: 'NFC_TAP_EXISTING_CARD',
  /** Lost the claim race to another tapper. */
  CLAIM_RACE_LOST: 'NFC_CLAIM_RACE_LOST',
  /** A white-label card was tapped by a user from a different home tenant. */
  CLAIM_TENANT_MISMATCH: 'NFC_CLAIM_TENANT_MISMATCH',
} as const

export type NfcAttributionEventType =
  (typeof NFC_ATTRIBUTION_EVENT)[keyof typeof NFC_ATTRIBUTION_EVENT]

type AttributionEventDb = Pick<Prisma.TransactionClient, 'attributionEvent'>

/**
 * Record a raw card tap (funnel top). Best-effort: callers should not let a
 * failed analytics write break the redirect, so this swallows errors.
 */
export async function recordNfcCardTappedEvent(args: {
  db: AttributionEventDb
  cardId: string
  actorUserId: string | null
  meta: Prisma.InputJsonObject
}): Promise<void> {
  try {
    await args.db.attributionEvent.create({
      data: {
        eventType: NFC_ATTRIBUTION_EVENT.CARD_TAPPED,
        cardId: args.cardId,
        actorUserId: args.actorUserId,
        metaJson: args.meta,
      },
    })
  } catch {
    // Analytics is not worth failing a tap over.
  }
}
