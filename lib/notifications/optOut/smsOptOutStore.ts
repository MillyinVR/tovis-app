// lib/notifications/optOut/smsOptOutStore.ts
//
// SMS opt-out state: the single read/write surface for both recording an
// inbound STOP/START event (app/api/webhooks/twilio/route.ts) and checking it
// at send time (lib/notifications/delivery/claimDeliveries.ts). Keyed by the
// same HMAC phone lookup hash as User.phoneHashV2 / ClientProfile.phoneHashV2
// (lib/security/crypto/hashLookup) so it works for ANY destination phone,
// including pro-entered clients who have no User row and therefore no
// transactionalSmsConsentAt to revoke.

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/security/contactNormalization'
import { phoneLookupHashV2 } from '@/lib/security/crypto/hashLookup'

export type RecordSmsOptEventArgs = {
  phone: string
  kind: 'STOP' | 'START'
  keyword: string
  occurredAt: Date
  tx?: Prisma.TransactionClient
}

export type RecordSmsOptEventResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_PHONE' }

/**
 * Upsert the current opt-out state for a phone. `optedOutAt` is set on STOP,
 * cleared (not deleted) on START — the row survives a START so lastKeyword /
 * lastEventAt keep recording the most recent event either way.
 */
export async function recordSmsOptEvent(
  args: RecordSmsOptEventArgs,
): Promise<RecordSmsOptEventResult> {
  const normalizedPhone = normalizePhone(args.phone) // pii-plaintext-read-ok: function argument, not a decrypted DB read — immediately passed through the canonical lib/security normalizer, never stored/displayed raw.
  const lookup = normalizedPhone ? phoneLookupHashV2(normalizedPhone) : null

  if (!normalizedPhone || !lookup) {
    return { ok: false, code: 'INVALID_PHONE' }
  }

  const db = args.tx ?? prisma
  const optedOutAt = args.kind === 'STOP' ? args.occurredAt : null

  await db.smsOptOut.upsert({
    where: { phoneHashV2: lookup.hash },
    create: {
      phoneHashV2: lookup.hash,
      phone: normalizedPhone,
      optedOutAt,
      lastKeyword: args.keyword,
      lastEventAt: args.occurredAt,
    },
    update: {
      phone: normalizedPhone,
      optedOutAt,
      lastKeyword: args.keyword,
      lastEventAt: args.occurredAt,
    },
  })

  return { ok: true }
}

/**
 * The send-time gate. Returns false (not opted out) for an unparseable phone
 * rather than throwing — an invalid destination is a delivery-capability
 * problem the existing channel-policy checks already own, not an opt-out one.
 */
export async function isPhoneOptedOutOfSms(args: {
  phone: string | null | undefined
  tx?: Prisma.TransactionClient
}): Promise<boolean> {
  const normalizedPhone = normalizePhone(args.phone) // pii-plaintext-read-ok: function argument, not a decrypted DB read — immediately passed through the canonical lib/security normalizer, never stored/displayed raw.
  const lookup = normalizedPhone ? phoneLookupHashV2(normalizedPhone) : null

  if (!normalizedPhone || !lookup) return false

  const db = args.tx ?? prisma

  const row = await db.smsOptOut.findUnique({
    where: { phoneHashV2: lookup.hash },
    select: { optedOutAt: true },
  })

  return row?.optedOutAt != null
}
