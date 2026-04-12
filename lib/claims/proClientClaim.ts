import {
  ClientClaimStatus,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type AcceptProClientClaimLinkArgs = {
  token: string
  actingUserId: string
  actingClientId: string
}

export type AcceptProClientClaimLinkResult =
  | { kind: 'not_found' }
  | { kind: 'revoked' }
  | { kind: 'already_claimed' }
  | { kind: 'client_not_found' }
  | { kind: 'client_mismatch' }
  | { kind: 'conflict' }
  | { kind: 'ok'; bookingId: string }

const inviteClaimSelect = {
  id: true,
  bookingId: true,
  clientId: true,
  status: true,
  acceptedAt: true,
  revokedAt: true,
  preferredContactMethod: true,
  client: {
    select: {
      id: true,
      userId: true,
      claimStatus: true,
      preferredContactMethod: true,
    },
  },
} satisfies Prisma.ProClientInviteSelect

type InviteClaimRow = Prisma.ProClientInviteGetPayload<{
  select: typeof inviteClaimSelect
}>

const actingClientSelect = {
  id: true,
  userId: true,
  claimStatus: true,
  preferredContactMethod: true,
} satisfies Prisma.ClientProfileSelect

type ActingClientRow = Prisma.ClientProfileGetPayload<{
  select: typeof actingClientSelect
}>

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`acceptProClientClaimLink: ${fieldName} is required.`)
  }
  return normalized
}

function isInviteRevoked(
  invite: Pick<InviteClaimRow, 'status' | 'revokedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED ||
    invite.revokedAt != null
  )
}

function isClientAlreadyClaimed(
  client: NonNullable<InviteClaimRow['client']>,
): boolean {
  return (
    client.claimStatus === ClientClaimStatus.CLAIMED || client.userId != null
  )
}

function shouldSetPreferredContactMethod(args: {
  invite: InviteClaimRow
  actingClient: ActingClientRow
}): boolean {
  return (
    args.invite.preferredContactMethod != null &&
    args.actingClient.preferredContactMethod == null
  )
}

export async function acceptProClientClaimLink(
  args: AcceptProClientClaimLinkArgs,
): Promise<AcceptProClientClaimLinkResult> {
  const token = normalizeRequiredString(args.token, 'token')
  const actingUserId = normalizeRequiredString(args.actingUserId, 'actingUserId')
  const actingClientId = normalizeRequiredString(
    args.actingClientId,
    'actingClientId',
  )

  const now = new Date()

  return prisma.$transaction<AcceptProClientClaimLinkResult>(async (tx) => {
    const invite = await tx.proClientInvite.findUnique({
      where: { token },
      select: inviteClaimSelect,
    })

    if (!invite || !invite.client) {
      return { kind: 'not_found' }
    }

    if (isInviteRevoked(invite)) {
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

    if (
      invite.client.userId != null &&
      invite.client.userId !== actingUserId
    ) {
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
        ...(shouldSetPreferredContactMethod({ invite, actingClient })
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

      if (
        currentClient.claimStatus === ClientClaimStatus.CLAIMED ||
        currentClient.userId != null
      ) {
        return { kind: 'already_claimed' }
      }

      return { kind: 'conflict' }
    }

    const inviteAuditUpdate = await tx.proClientInvite.updateMany({
      where: {
        id: invite.id,
        revokedAt: null,
      },
      data: {
        status: ProClientInviteStatus.ACCEPTED,
        acceptedAt: invite.acceptedAt ?? now,
        acceptedByUserId: actingUserId,
      },
    })

    if (inviteAuditUpdate.count !== 1) {
      const currentInvite = await tx.proClientInvite.findUnique({
        where: { id: invite.id },
        select: {
          id: true,
          status: true,
          revokedAt: true,
        },
      })

      if (!currentInvite) {
        return { kind: 'not_found' }
      }

      if (
        currentInvite.status === ProClientInviteStatus.REVOKED ||
        currentInvite.revokedAt != null
      ) {
        return { kind: 'revoked' }
      }

      return { kind: 'conflict' }
    }

    return {
      kind: 'ok',
      bookingId: invite.bookingId,
    }
  })
}