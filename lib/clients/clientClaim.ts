import { ClientClaimStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import {
  getClientClaimLinkByToken,
  markClientClaimLinkAcceptedAudit,
} from './clientClaimLinks'

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
  | { kind: 'conflict' }
  | { kind: 'ok'; bookingId: string }

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

export async function acceptClientClaimFromLink(
  args: AcceptClientClaimFromLinkArgs,
): Promise<AcceptClientClaimFromLinkResult> {
  const token = normalizeRequiredString(args.token, 'token')
  const actingUserId = normalizeRequiredString(args.actingUserId, 'actingUserId')
  const actingClientId = normalizeRequiredString(
    args.actingClientId,
    'actingClientId',
  )

  const now = new Date()

  return prisma.$transaction<AcceptClientClaimFromLinkResult>(async (tx) => {
    const invite = await getClientClaimLinkByToken({
      token,
      tx,
    })

    if (!invite || !invite.client) {
      return { kind: 'not_found' }
    }

    if (
      invite.status === 'REVOKED' ||
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

    if (invite.client.id !== actingClient.id) {
      if (isClientAlreadyClaimed(invite.client)) {
        return { kind: 'already_claimed' }
      }

      return { kind: 'client_mismatch' }
    }

    if (invite.client.userId != null && invite.client.userId !== actingUserId) {
      return { kind: 'already_claimed' }
    }

    if (invite.client.claimStatus === ClientClaimStatus.CLAIMED) {
      return { kind: 'already_claimed' }
    }

    const claimUpdate = await tx.clientProfile.updateMany({
      where: {
        id: actingClient.id,
        claimStatus: ClientClaimStatus.UNCLAIMED,
      },
      data: {
        claimStatus: ClientClaimStatus.CLAIMED,
        claimedAt: now,
        ...(shouldSetPreferredContactMethod({
          actingClient,
          invitePreferredContactMethod: invite.preferredContactMethod,
        })
          ? { preferredContactMethod: invite.preferredContactMethod }
          : {}),
      },
    })

    if (claimUpdate.count !== 1) {
      const currentClient = await tx.clientProfile.findUnique({
        where: { id: actingClient.id },
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

    if (auditResult === 'revoked') {
      return { kind: 'revoked' }
    }

    if (auditResult === 'not_found') {
      return { kind: 'not_found' }
    }

    return { kind: 'conflict' }
  })
}