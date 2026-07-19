import { ClientClaimStatus, Prisma, ProClientInviteStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { claimMergeDisabled } from './claimMergeFlag'
import {
  getClientClaimLinkByToken,
  markClientClaimLinkAcceptedAudit,
} from './clientClaimLinks'
import {
  mergeUnclaimedClientProfile,
  type MergeUnclaimedRefusalReason,
} from './mergeUnclaimedClientProfile'
import { normalizeProClientInviteToken } from './proClientInviteTokens'

export type AcceptClientClaimFromLinkArgs = {
  token: string
  actingUserId: string
  actingClientId: string
}

export type AcceptClientClaimFromLinkResult =
  | { kind: 'not_found' }
  | { kind: 'revoked' }
  | { kind: 'already_claimed' }
  | { kind: 'client_not_found' }
  | { kind: 'client_mismatch' }
  /** The shell could not be absorbed safely; nothing was written. Needs a human. */
  | { kind: 'merge_refused'; reason: MergeUnclaimedRefusalReason }
  /**
   * An operator has the merge kill switch pulled, so the claim did not run.
   * Nothing was written and the viewer did nothing wrong — it is temporary and
   * retryable, which is why it is NOT `client_mismatch` (see the kill-switch
   * branch below for the full reasoning).
   */
  | { kind: 'merge_paused' }
  | { kind: 'conflict' }
  | { kind: 'ok'; bookingId: string | null }

/**
 * Unwinds the transaction after a merge has already moved rows.
 *
 * Prisma commits when the callback RESOLVES and rolls back only on a rejection,
 * so once the merge has run, a *returned* failure would commit the absorption it
 * is reporting as failed. Same invariant `mergeUnclaimedClientProfile` keeps with
 * its sweep canary, one level up: past the merge, a failure must throw.
 */
class ClaimRollbackSignal extends Error {
  constructor(readonly result: AcceptClientClaimFromLinkResult) {
    super('clientClaim: rolled back after the merge had already moved rows.')
    this.name = 'ClaimRollbackSignal'
  }
}

const actingClientSelect = Prisma.validator<Prisma.ClientProfileSelect>()({
  id: true,
  userId: true,
  claimStatus: true,
  claimedAt: true,
  preferredContactMethod: true,
} satisfies Prisma.ClientProfileSelect)

type ActingClientRow = Prisma.ClientProfileGetPayload<{
  select: typeof actingClientSelect
}>

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new Error(`clientClaim: ${fieldName} is required.`)
  }

  return normalized
}

function normalizeRequiredToken(value: string): string {
  const token = normalizeProClientInviteToken(value)

  if (!token) {
    throw new Error('clientClaim: token is required.')
  }

  return token
}

function isClientAlreadyClaimed(client: {
  userId: string | null
  claimStatus: ClientClaimStatus
}): boolean {
  return client.claimStatus === ClientClaimStatus.CLAIMED || client.userId != null
}

function shouldSetPreferredContactMethod(args: {
  actingClient: ActingClientRow
  invitePreferredContactMethod: ActingClientRow['preferredContactMethod']
}): boolean {
  return (
    args.invitePreferredContactMethod != null &&
    args.actingClient.preferredContactMethod == null
  )
}

/**
 * Translate a merge refusal into the accept contract.
 *
 * Two buckets. Most refusals mean the world CHANGED under us between the public
 * read and this transaction, and the honest answer is the kind that describes the
 * new world — a viewer whose link just got claimed elsewhere wants
 * "already claimed", not a merge error they can do nothing with. Only the
 * refusals that mean "our model of this data is wrong, so a person must decide"
 * surface as `merge_refused`.
 *
 * Exhaustive on purpose: a new refusal reason should fail typecheck here rather
 * than fall into a default that guesses.
 */
function resultForMergeRefusal(
  reason: MergeUnclaimedRefusalReason,
): AcceptClientClaimFromLinkResult {
  switch (reason) {
    // The shell grew a user after we read the invite — which is precisely what
    // this result kind already means.
    case 'source_not_unclaimed':
      return { kind: 'already_claimed' }

    // A racing merge absorbed and destroyed the shell first.
    case 'source_not_found':
      return { kind: 'not_found' }

    case 'target_not_found':
      return { kind: 'client_not_found' }

    // The caller passed a client the acting user does not own. Both call sites
    // pass the session's own clientProfile.id, so this is unreachable today —
    // but the merge is irreversible and shared, and this guard is a reason it is
    // safe to call. `client_mismatch` is literally what it means.
    case 'target_not_owned':
      return { kind: 'client_mismatch' }

    // Guarded above: we only merge when the ids differ.
    case 'same_profile':
      return { kind: 'conflict' }

    // The merge declined to guess. Nothing was written.
    case 'cross_tenant':
    case 'source_not_shell':
    case 'thread_collision':
      return { kind: 'merge_refused', reason }
  }
}

export async function acceptClientClaimFromLink(
  args: AcceptClientClaimFromLinkArgs,
): Promise<AcceptClientClaimFromLinkResult> {
  const token = normalizeRequiredToken(args.token)
  const actingUserId = normalizeRequiredString(args.actingUserId, 'actingUserId')
  const actingClientId = normalizeRequiredString(
    args.actingClientId,
    'actingClientId',
  )

  const now = new Date()

  try {
    return await runAcceptClientClaim({ token, actingUserId, actingClientId, now })
  } catch (error) {
    if (error instanceof ClaimRollbackSignal) {
      return error.result
    }

    throw error
  }
}

async function runAcceptClientClaim(args: {
  token: string
  actingUserId: string
  actingClientId: string
  now: Date
}): Promise<AcceptClientClaimFromLinkResult> {
  const { token, actingUserId, actingClientId, now } = args

  return prisma.$transaction<AcceptClientClaimFromLinkResult>(async (tx) => {
    const invite = await getClientClaimLinkByToken({
      token,
      tx,
    })

    if (!invite || !invite.client) {
      return { kind: 'not_found' }
    }

    if (
      invite.status === ProClientInviteStatus.REVOKED ||
      invite.revokedAt != null
    ) {
      return { kind: 'revoked' }
    }

    const actingClient = await tx.clientProfile.findUnique({
      where: { id: actingClientId },
      select: actingClientSelect,
    })

    if (!actingClient) {
      return { kind: 'client_not_found' }
    }

    let claimingClient = actingClient
    let merged = false

    if (invite.client.id !== actingClient.id) {
      if (isClientAlreadyClaimed(invite.client)) {
        return { kind: 'already_claimed' }
      }

      // The kill switch. The merge is irreversible and any client holding a link
      // can trigger it, so it stays stoppable without a revert + redeploy. Off by
      // default; `DISABLE_CLAIM_MERGE=1` skips the merge entirely, writing
      // nothing. Checked BEFORE the merge so disabling is always a clean no-op,
      // never a half-finished absorption.
      //
      // ⚠️ This used to return `client_mismatch` — the literal pre-#652 refusal —
      // and that was wrong on the wire, not just in the copy. Because EVERY
      // signed-in claim reaches this branch while the switch is pulled (the ids
      // never match; see the comment below), every one of them was told it was
      // signed into the wrong client account and sent to go find the right one.
      // No such account exists: the link's client is a pro-made shell with no
      // user behind it, so the "correct account" the card names is unreachable by
      // construction and the only thing following that advice can produce is a
      // second, emptier account. The two situations are opposites — one is the
      // viewer's mistake and permanent, the other is ours and temporary — so they
      // get separate kinds, and the surfaces branch on server-supplied evidence
      // rather than guessing which 409 they are holding.
      if (claimMergeDisabled()) {
        return { kind: 'merge_paused' }
      }

      // A signed-in client lands here EVERY time on a `ready` link: the link only
      // reads `ready` while its client has `userId == null`, and the acting
      // client's own profile always has `userId != null`, so the two ids can
      // never match (see mergeUnclaimedClientProfile's header). Refusing was not
      // a safety check — it was the bug. It made the claim unreachable for
      // anyone who already had an account, leaving signup adoption as the only
      // path that ever worked. Absorb the pro's shell into the acting identity
      // instead, and let the claim below commit against a link that now really
      // does point at us.
      const merge = await mergeUnclaimedClientProfile({
        tx,
        sourceClientId: invite.client.id,
        targetClientId: actingClient.id,
        actingUserId,
        now,
      })

      if (merge.kind === 'refused') {
        return resultForMergeRefusal(merge.reason)
      }

      merged = true

      // The merge moved the invite onto the acting client, destroyed the shell,
      // and may have carried the shell's contact preference over — so the row we
      // read before it ran no longer describes this profile.
      const mergedClient = await tx.clientProfile.findUnique({
        where: { id: actingClient.id },
        select: actingClientSelect,
      })

      if (!mergedClient) {
        throw new ClaimRollbackSignal({ kind: 'client_not_found' })
      }

      claimingClient = mergedClient
    } else {
      if (invite.client.userId != null && invite.client.userId !== actingUserId) {
        return { kind: 'already_claimed' }
      }

      if (invite.client.claimStatus === ClientClaimStatus.CLAIMED) {
        return { kind: 'already_claimed' }
      }
    }

    const claimData = {
      claimStatus: ClientClaimStatus.CLAIMED,
      ...(shouldSetPreferredContactMethod({
        actingClient: claimingClient,
        invitePreferredContactMethod: invite.preferredContactMethod,
      })
        ? { preferredContactMethod: invite.preferredContactMethod }
        : {}),
    }

    if (merged) {
      // No optimistic guard needed here: the merge is the serialization point.
      // It deleted the shell inside this transaction, so a concurrent accept of
      // the same link cannot also be standing here. CLAIMED may ALREADY be set
      // (this identity absorbed another pro's shell on an earlier link) — that
      // is success, not a conflict, so keep the original claimedAt rather than
      // restamping a claim that already happened.
      await tx.clientProfile.update({
        where: { id: claimingClient.id },
        data: {
          ...claimData,
          claimedAt: claimingClient.claimedAt ?? now,
        },
      })
    } else {
      const claimUpdate = await tx.clientProfile.updateMany({
        where: {
          id: claimingClient.id,
          claimStatus: ClientClaimStatus.UNCLAIMED,
        },
        data: {
          ...claimData,
          claimedAt: now,
        },
      })

      if (claimUpdate.count !== 1) {
        const currentClient = await tx.clientProfile.findUnique({
          where: { id: claimingClient.id },
          select: {
            id: true,
            userId: true,
            claimStatus: true,
          },
        })

        if (!currentClient) {
          return { kind: 'client_not_found' }
        }

        if (isClientAlreadyClaimed(currentClient)) {
          return { kind: 'already_claimed' }
        }

        return { kind: 'conflict' }
      }
    }

    const acceptedAt = invite.acceptedAt ?? now

    const auditResult = await markClientClaimLinkAcceptedAudit({
      inviteId: invite.id,
      actingUserId,
      acceptedAt,
      tx,
    })

    if (auditResult === 'ok') {
      return {
        kind: 'ok',
        bookingId: invite.bookingId,
      }
    }

    const auditFailure: AcceptClientClaimFromLinkResult =
      auditResult === 'revoked'
        ? { kind: 'revoked' }
        : auditResult === 'not_found'
          ? { kind: 'not_found' }
          : { kind: 'conflict' }

    // The link was revoked (or vanished) between our read and the audit write.
    // Without a merge that is a clean no-op — but a merge has already absorbed
    // the shell, and returning here would COMMIT it while telling the viewer the
    // link was revoked. The pro pulled consent; unwind rather than keep the
    // history we took under a link that is no longer valid.
    if (merged) {
      throw new ClaimRollbackSignal(auditFailure)
    }

    return auditFailure
  })
}