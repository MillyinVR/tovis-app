// lib/clients/mergeUnclaimedClientProfile.ts
//
// Absorb a pro-created UNCLAIMED ClientProfile into the signed-in client's own
// identity, so a person who already has an account can finally take the history
// their pro built for them.
//
// ## Why this exists
// A claim link only reads `ready` while its client has `userId == null`
// (`isClientAlreadyClaimed`, clientClaimLinks.ts), and a signed-in client's own
// profile ALWAYS has `userId != null` (`ClientProfile.userId` is `@unique` and
// `User.clientProfile` is its back-relation). So on a ready link the invite's
// client can never BE the acting client, and `acceptClientClaimFromLink` always
// falls to `client_mismatch`. Signup adoption (`claimAdoption.ts`) is the only
// claim path that has ever worked — it re-points a *fresh* user at the profile,
// which sidesteps the two-profile problem entirely. It cannot help someone who
// already signed up. Closing that hole needs an actual merge, which is this.
//
// ## Why it refuses instead of trying harder
// The source is always a pro-created shell, and a shell cannot own the
// account-gated data that makes a general client merge dangerous — reviews,
// cards on file, boards, follows, taste vectors, referrals and a handle all
// require a signed-in user to create. That is what keeps this bounded. But
// "provably impossible" read off call sites is exactly the kind of confident
// negative that should not be trusted with irreversible writes, so every one of
// those is ASSERTED at runtime and refused rather than assumed away. A refusal is
// rare, loud and safe; silent corruption is none of those.
//
// Only ever merges INTO the acting user's own profile, and only ever absorbs a
// profile with no user behind it — so this can never consume a real identity.

import { ClientClaimStatus, Prisma } from '@prisma/client'

import { reassignClientBookings } from '@/lib/booking/writeBoundary'

/**
 * The post-move sweep found rows still hanging off the source.
 *
 * Thrown, never returned, so the caller's transaction ROLLS BACK — Prisma commits
 * whenever the callback resolves, so a returned refusal here would commit exactly
 * the half-merged state this check exists to prevent.
 *
 * Unreachable by construction today: every relation this counts is either
 * account-gated (refused before any write) or moved. It fires when someone adds a
 * client-owned table to `ClientHoldingCounts` without teaching the merge to move
 * it — which is a bug, and should be loud.
 */
export class MergeClientProfileIncompleteError extends Error {
  constructor(
    readonly sourceClientId: string,
    readonly leftovers: string[],
  ) {
    super(
      `mergeUnclaimedClientProfile: source ${sourceClientId} still holds rows after the move ` +
        `(${leftovers.join(', ')}). Rolled back rather than cascade-deleting them.`,
    )
    this.name = 'MergeClientProfileIncompleteError'
  }
}

export type MergeUnclaimedClientProfileArgs = {
  tx: Prisma.TransactionClient
  /** The pro-created unclaimed profile being absorbed. Destroyed on success. */
  sourceClientId: string
  /** The acting user's own client identity. Survives and keeps its own scalars. */
  targetClientId: string
  /** Must own `targetClientId`; recorded on the invite's acceptance audit. */
  actingUserId: string
  now: Date
}

export type MergeUnclaimedRefusalReason =
  /** No such source profile (or it was already absorbed by a racing merge). */
  | 'source_not_found'
  | 'target_not_found'
  /** The link already points at the acting client — the caller wants accept, not merge. */
  | 'same_profile'
  /** The source has a user behind it. NEVER absorb a real identity. */
  | 'source_not_unclaimed'
  /** The target isn't the acting user's own profile. */
  | 'target_not_owned'
  /** Merging across tenants would silently rewrite the client's discovery scope. */
  | 'cross_tenant'
  /** The source holds account-gated data a shell cannot have — needs a human. */
  | 'source_not_shell'
  /** Both profiles hold a thread with the same pro on the same context; dropping
   *  either would destroy messages, so a human decides. */
  | 'thread_collision'

export type MergeUnclaimedClientProfileResult =
  | { kind: 'ok'; moved: ClientHoldingCounts }
  | {
      kind: 'refused'
      reason: MergeUnclaimedRefusalReason
      /** Human-readable specifics for the support queue. Never contains PII. */
      details: string[]
    }

/**
 * Every table that hangs off a ClientProfile, counted for one profile.
 *
 * This is the merge's authoritative inventory and is deliberately exhaustive:
 * `lib/privacy/deleteUserData.ts` walks only 4 of these and says so itself, so it
 * is NOT reusable here. If a migration adds a client-owned table and misses this
 * map, the post-move sweep fails the merge rather than letting a Cascade quietly
 * eat the rows.
 */
export type ClientHoldingCounts = {
  // --- Account-gated: a userId==null shell must have NONE of these.
  reviews: number
  paymentMethods: number
  boards: number
  proFollows: number
  clientFollowsAsFollower: number
  clientFollowsAsFollowed: number
  tasteVectors: number
  lookPosts: number
  referralsAsReferrer: number
  referralsAsReferred: number
  // --- Pro-authored / operational: the surface this merge moves.
  bookings: number
  bookingHolds: number
  messageThreads: number
  addresses: number
  allergies: number
  consentRecords: number
  formulaEntries: number
  professionalNotes: number
  invites: number
  reminders: number
  waitlistEntries: number
  waitlistOffers: number
  lastMinuteRecipients: number
  notificationDispatches: number
  clientNotifications: number
  scheduledNotifications: number
  notificationPreferences: number
  notificationSettings: number
  actionTokens: number
  consultationApprovalProofs: number
  intentEvents: number
  viralServiceRequests: number
}

/** The subset a shell provably cannot hold — each one requires a signed-in user. */
const ACCOUNT_GATED_HOLDINGS: readonly (keyof ClientHoldingCounts)[] = [
  'reviews',
  'paymentMethods',
  'boards',
  'proFollows',
  'clientFollowsAsFollower',
  'clientFollowsAsFollowed',
  'tasteVectors',
  'lookPosts',
  'referralsAsReferrer',
  'referralsAsReferred',
]

/** Count every client-owned row for one profile. */
async function countClientHoldings(
  tx: Prisma.TransactionClient,
  clientId: string,
): Promise<ClientHoldingCounts> {
  const where = { clientId }

  return {
    reviews: await tx.review.count({ where }),
    paymentMethods: await tx.clientPaymentMethod.count({ where }),
    boards: await tx.board.count({ where }),
    proFollows: await tx.proFollow.count({ where }),
    clientFollowsAsFollower: await tx.clientFollow.count({
      where: { followerClientId: clientId },
    }),
    clientFollowsAsFollowed: await tx.clientFollow.count({
      where: { followedClientId: clientId },
    }),
    tasteVectors: await tx.clientTasteVector.count({
      where: { clientProfileId: clientId },
    }),
    lookPosts: await tx.lookPost.count({ where: { clientAuthorId: clientId } }),
    referralsAsReferrer: await tx.referral.count({
      where: { referrerClientId: clientId },
    }),
    referralsAsReferred: await tx.referral.count({
      where: { referredClientId: clientId },
    }),
    bookings: await tx.booking.count({ where }),
    bookingHolds: await tx.bookingHold.count({ where }),
    messageThreads: await tx.messageThread.count({ where }),
    addresses: await tx.clientAddress.count({ where }),
    allergies: await tx.clientAllergy.count({ where }),
    consentRecords: await tx.clientConsentRecord.count({ where }),
    formulaEntries: await tx.clientFormulaEntry.count({ where }),
    professionalNotes: await tx.clientProfessionalNote.count({ where }),
    invites: await tx.proClientInvite.count({ where }),
    reminders: await tx.reminder.count({ where }),
    waitlistEntries: await tx.waitlistEntry.count({ where }),
    waitlistOffers: await tx.waitlistOffer.count({ where }),
    lastMinuteRecipients: await tx.lastMinuteRecipient.count({ where }),
    notificationDispatches: await tx.notificationDispatch.count({ where }),
    clientNotifications: await tx.clientNotification.count({ where }),
    scheduledNotifications: await tx.scheduledClientNotification.count({ where }),
    notificationPreferences: await tx.clientNotificationPreference.count({ where }),
    notificationSettings: await tx.clientNotificationSettings.count({ where }),
    actionTokens: await tx.clientActionToken.count({ where }),
    consultationApprovalProofs: await tx.consultationApprovalProof.count({ where }),
    intentEvents: await tx.clientIntentEvent.count({ where }),
    viralServiceRequests: await tx.viralServiceRequest.count({ where }),
  }
}

function nonZeroHoldings(
  counts: ClientHoldingCounts,
  keys: readonly (keyof ClientHoldingCounts)[],
): string[] {
  return keys
    .filter((key) => counts[key] > 0)
    .map((key) => `${key}=${counts[key]}`)
}

function allHoldingKeys(counts: ClientHoldingCounts): (keyof ClientHoldingCounts)[] {
  return Object.keys(counts) as (keyof ClientHoldingCounts)[]
}

function refuse(
  reason: MergeUnclaimedRefusalReason,
  details: string[] = [],
): MergeUnclaimedClientProfileResult {
  return { kind: 'refused', reason, details }
}

const mergeProfileSelect = Prisma.validator<Prisma.ClientProfileSelect>()({
  id: true,
  userId: true,
  claimStatus: true,
  homeTenantId: true,
  preferredContactMethod: true,
} satisfies Prisma.ClientProfileSelect)

/**
 * Move the source's message threads, refusing rather than destroying messages
 * when both profiles already hold a thread with the same pro on the same context
 * (`@@unique([clientId, professionalId, contextType, contextId])`).
 */
async function moveMessageThreads(
  tx: Prisma.TransactionClient,
  sourceClientId: string,
  targetClientId: string,
): Promise<MergeUnclaimedRefusalReason | null> {
  const threadKey = (thread: {
    professionalId: string
    contextType: string
    contextId: string
  }) => `${thread.professionalId}|${thread.contextType}|${thread.contextId}`

  const [sourceThreads, targetThreads] = [
    await tx.messageThread.findMany({
      where: { clientId: sourceClientId },
      select: { id: true, professionalId: true, contextType: true, contextId: true },
    }),
    await tx.messageThread.findMany({
      where: { clientId: targetClientId },
      select: { professionalId: true, contextType: true, contextId: true },
    }),
  ]

  const targetKeys = new Set(targetThreads.map(threadKey))
  const colliding = sourceThreads.filter((thread) => targetKeys.has(threadKey(thread)))

  if (colliding.length > 0) {
    return 'thread_collision'
  }

  await tx.messageThread.updateMany({
    where: { clientId: sourceClientId },
    data: { clientId: targetClientId },
  })

  return null
}

/**
 * Move rows whose unique key includes the client, dropping the source's copy when
 * the target already holds the same key. Every table handled here is regenerable
 * config or delivery bookkeeping — nothing a person would notice losing — which is
 * why dropping is correct rather than refusing.
 */
async function moveConstrainedNotificationRows(
  tx: Prisma.TransactionClient,
  sourceClientId: string,
  targetClientId: string,
): Promise<void> {
  // ClientNotificationSettings: `clientId @unique` (strictly 1:1). The target's
  // own settings win; the source's are dropped.
  const targetSettings = await tx.clientNotificationSettings.count({
    where: { clientId: targetClientId },
  })
  if (targetSettings > 0) {
    await tx.clientNotificationSettings.deleteMany({ where: { clientId: sourceClientId } })
  } else {
    await tx.clientNotificationSettings.updateMany({
      where: { clientId: sourceClientId },
      data: { clientId: targetClientId },
    })
  }

  // ClientNotificationPreference: @@unique([clientId, eventKey]).
  const targetPreferences = await tx.clientNotificationPreference.findMany({
    where: { clientId: targetClientId },
    select: { eventKey: true },
  })
  if (targetPreferences.length > 0) {
    await tx.clientNotificationPreference.deleteMany({
      where: {
        clientId: sourceClientId,
        eventKey: { in: targetPreferences.map((preference) => preference.eventKey) },
      },
    })
  }
  await tx.clientNotificationPreference.updateMany({
    where: { clientId: sourceClientId },
    data: { clientId: targetClientId },
  })

  // LastMinuteRecipient: @@unique([openingId, clientId]) — both profiles targeted
  // by the same opening collapses to one recipient row.
  const targetRecipients = await tx.lastMinuteRecipient.findMany({
    where: { clientId: targetClientId },
    select: { openingId: true },
  })
  if (targetRecipients.length > 0) {
    await tx.lastMinuteRecipient.deleteMany({
      where: {
        clientId: sourceClientId,
        openingId: { in: targetRecipients.map((recipient) => recipient.openingId) },
      },
    })
  }
  await tx.lastMinuteRecipient.updateMany({
    where: { clientId: sourceClientId },
    data: { clientId: targetClientId },
  })

  // ClientNotification / ScheduledClientNotification: @@unique([clientId, dedupeKey]).
  // `dedupeKey` is nullable and Postgres treats NULLs as distinct, so only non-null
  // keys can collide — but they genuinely do, since dedupe keys are built from pro /
  // look / cadence ids two profiles can share.
  const targetDedupeKeys = await tx.clientNotification.findMany({
    where: { clientId: targetClientId, dedupeKey: { not: null } },
    select: { dedupeKey: true },
  })
  const dedupeKeys = targetDedupeKeys
    .map((row) => row.dedupeKey)
    .filter((key): key is string => key != null)
  if (dedupeKeys.length > 0) {
    await tx.clientNotification.deleteMany({
      where: { clientId: sourceClientId, dedupeKey: { in: dedupeKeys } },
    })
  }
  await tx.clientNotification.updateMany({
    where: { clientId: sourceClientId },
    data: { clientId: targetClientId },
  })

  const targetScheduledKeys = await tx.scheduledClientNotification.findMany({
    where: { clientId: targetClientId, dedupeKey: { not: null } },
    select: { dedupeKey: true },
  })
  const scheduledKeys = targetScheduledKeys
    .map((row) => row.dedupeKey)
    .filter((key): key is string => key != null)
  if (scheduledKeys.length > 0) {
    await tx.scheduledClientNotification.deleteMany({
      where: { clientId: sourceClientId, dedupeKey: { in: scheduledKeys } },
    })
  }
  await tx.scheduledClientNotification.updateMany({
    where: { clientId: sourceClientId },
    data: { clientId: targetClientId },
  })
}

/**
 * Move the plainly-transferable rows — nothing here has a unique constraint that
 * includes the client, so a straight rewrite is safe (verified against the schema).
 */
async function moveUnconstrainedRows(
  tx: Prisma.TransactionClient,
  sourceClientId: string,
  targetClientId: string,
): Promise<void> {
  const where = { clientId: sourceClientId }
  const data = { clientId: targetClientId }

  // Bookings + holds move through the booking write boundary — every Booking /
  // BookingHold write in the repo does (`check:booking-boundary`).
  await reassignClientBookings({
    tx,
    fromClientId: sourceClientId,
    toClientId: targetClientId,
  })

  await tx.clientAddress.updateMany({ where, data })
  await tx.clientAllergy.updateMany({ where, data })
  await tx.clientConsentRecord.updateMany({ where, data })
  await tx.clientFormulaEntry.updateMany({ where, data })
  await tx.clientProfessionalNote.updateMany({ where, data })
  await tx.proClientInvite.updateMany({ where, data })
  await tx.reminder.updateMany({ where, data })
  await tx.waitlistEntry.updateMany({ where, data })
  await tx.waitlistOffer.updateMany({ where, data })
  await tx.notificationDispatch.updateMany({ where, data })
  await tx.clientActionToken.updateMany({ where, data })
  await tx.consultationApprovalProof.updateMany({ where, data })
  await tx.clientIntentEvent.updateMany({ where, data })
  await tx.viralServiceRequest.updateMany({ where, data })
}

/**
 * Absorb an unclaimed, pro-created client profile into the acting user's own
 * client identity, then destroy the husk.
 *
 * Runs entirely inside the caller's transaction, and every refusal it RETURNS
 * happens before any write — so a refusal is always a clean no-op the caller can
 * simply act on. The one mid-merge failure (`MergeClientProfileIncompleteError`)
 * throws instead, precisely so the transaction rolls back rather than commits.
 */
export async function mergeUnclaimedClientProfile(
  args: MergeUnclaimedClientProfileArgs,
): Promise<MergeUnclaimedClientProfileResult> {
  const { tx, sourceClientId, targetClientId, actingUserId } = args

  if (sourceClientId === targetClientId) {
    return refuse('same_profile')
  }

  const [source, target] = [
    await tx.clientProfile.findUnique({
      where: { id: sourceClientId },
      select: mergeProfileSelect,
    }),
    await tx.clientProfile.findUnique({
      where: { id: targetClientId },
      select: mergeProfileSelect,
    }),
  ]

  if (!source) return refuse('source_not_found')
  if (!target) return refuse('target_not_found')

  // The load-bearing guard: only ever absorb a profile with nobody behind it.
  if (source.userId != null || source.claimStatus === ClientClaimStatus.CLAIMED) {
    return refuse('source_not_unclaimed')
  }

  // Merge only into the caller's OWN identity — never let one user pull another
  // person's history onto a profile they don't hold.
  if (target.userId !== actingUserId) {
    return refuse('target_not_owned')
  }

  if (source.homeTenantId !== target.homeTenantId) {
    return refuse('cross_tenant')
  }

  const sourceHoldings = await countClientHoldings(tx, sourceClientId)
  const accountGated = nonZeroHoldings(sourceHoldings, ACCOUNT_GATED_HOLDINGS)

  // A shell should hold none of these. If it does, our model of the data is wrong
  // — refuse and let a human look rather than guess at a merge policy.
  if (accountGated.length > 0) {
    return refuse('source_not_shell', accountGated)
  }

  const threadRefusal = await moveMessageThreads(tx, sourceClientId, targetClientId)
  if (threadRefusal) {
    return refuse(threadRefusal, ['messageThreads'])
  }

  await moveConstrainedNotificationRows(tx, sourceClientId, targetClientId)
  await moveUnconstrainedRows(tx, sourceClientId, targetClientId)

  // Carry the pro's contact preference only when the target has no opinion.
  if (source.preferredContactMethod != null && target.preferredContactMethod == null) {
    await tx.clientProfile.update({
      where: { id: targetClientId },
      data: { preferredContactMethod: source.preferredContactMethod },
    })
  }

  // The canary. Most of these relations are `onDelete: Cascade`, so deleting the
  // husk with rows still on it would silently destroy them. Counting first turns
  // that into a loud rollback — including for a client-owned table added after
  // this file was written and never taught to move.
  //
  // This THROWS rather than returning a refusal, and the distinction is the whole
  // point: every other refusal returns before any write, but this one is reached
  // mid-merge — and Prisma commits when the callback RESOLVES, rolling back only
  // on a rejection. Returning here would commit the half-finished merge this check
  // exists to prevent.
  const remaining = await countClientHoldings(tx, sourceClientId)
  const leftovers = nonZeroHoldings(remaining, allHoldingKeys(remaining))

  if (leftovers.length > 0) {
    throw new MergeClientProfileIncompleteError(sourceClientId, leftovers)
  }

  // The husk still holds the unique contact hashes. Leaving it alive would let
  // `upsertProClient` match it again later and re-create the very split this
  // merge just healed, so it goes.
  await tx.clientProfile.delete({ where: { id: sourceClientId } })

  return { kind: 'ok', moved: sourceHoldings }
}
