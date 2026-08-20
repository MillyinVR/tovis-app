import type { Prisma, PrismaClient } from '@prisma/client'

import { isUserPairBlocked } from '@/lib/blocks/userBlocks'
import { prisma } from '@/lib/prisma'

/**
 * The block guard for person-to-person social notifications.
 *
 * WHY THIS RUNS AT CREATION AND NOT AT READ
 * -----------------------------------------
 * A read-time filter would hide the inbox row while the PUSH had already gone
 * out — the half that actually matters, since the push is what makes a blocked
 * person's phone buzz on yours. Creation-time also works for BOTH recipient
 * models, which a read filter does not: `Notification` (pro) has an
 * `actorUserId` COLUMN, but `ClientNotification` has NO actor column at all —
 * its actor lives inside the `data` Json blob. So the two are asymmetric at
 * read time and identical at write time.
 *
 * ⚠️ It follows that this guard only governs notifications created AFTER the
 * block. Rows that already existed when the block was made are untouched.
 *
 * WHY A PARTY IS NOT JUST A USER ID
 * ---------------------------------
 * A block is keyed on `User`, but the social producers route to an INBOX, and
 * an inbox is named by a profile id — `professionalId` or `clientId`, never a
 * User id (`professionalId !== userId`). Each party is therefore named the way
 * its producer already names it and resolved here, in one place, so no producer
 * has to learn the User-id mapping.
 */

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Either end of a notification, named however its producer already names it.
 *
 * `pro` / `client` are structurally the same union as `LookNotificationRecipient`
 * in `../lookParty`, so a recipient from there is passed straight through.
 */
export type NotificationPartyRef =
  | { kind: 'user'; userId: string }
  | { kind: 'pro'; professionalId: string }
  | { kind: 'client'; clientId: string }

/**
 * The `User` behind a party, or `null` when there is nobody to block.
 *
 * `null` is a real answer, not a failure: `ClientProfile.userId` is NULLABLE, so
 * a client record no person has ever signed into HAS no user — it can neither
 * block nor be blocked. Same treatment as `buildLookPostBlockFilter`, which
 * deliberately keeps such rows in the feed rather than dropping them.
 * `ProfessionalProfile.userId` is non-nullable, so a pro resolves to `null` only
 * when the profile id names no row at all.
 */
async function resolvePartyUserId(
  db: Db,
  party: NotificationPartyRef,
): Promise<string | null> {
  if (party.kind === 'user') return party.userId.trim() || null

  if (party.kind === 'pro') {
    const id = party.professionalId.trim()
    if (!id) return null
    const pro = await db.professionalProfile.findUnique({
      where: { id },
      select: { userId: true },
    })
    return pro?.userId ?? null
  }

  const id = party.clientId.trim()
  if (!id) return null
  const client = await db.clientProfile.findUnique({
    where: { id },
    select: { userId: true },
  })
  return client?.userId ?? null
}

/**
 * Must this notification be suppressed because one party has blocked the other?
 *
 * 🔴 DOES NOT SWALLOW ERRORS, and that is the deliberate choice. Every caller
 * invokes its producer post-commit behind a `.catch`, so a read failure here
 * costs one notification and never the request — whereas a `try { } catch {
 * return false }` would turn any database blip into "deliver it anyway", which
 * is the exact outcome the block exists to prevent. Fail closed, not open.
 */
export async function isBlockedNotificationParty(args: {
  actor: NotificationPartyRef
  recipient: NotificationPartyRef
  db?: Db
}): Promise<boolean> {
  const db = args.db ?? prisma

  const actorUserId = await resolvePartyUserId(db, args.actor)
  if (!actorUserId) return false

  const recipientUserId = await resolvePartyUserId(db, args.recipient)
  if (!recipientUserId) return false

  return isUserPairBlocked(db, {
    userIdA: actorUserId,
    userIdB: recipientUserId,
  })
}
