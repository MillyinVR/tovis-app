import {
  ClientClaimStatus,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

const publicProClientInviteSelect = {
  id: true,
  professionalId: true,
  clientId: true,
  bookingId: true,
  invitedName: true,
  invitedEmail: true,
  invitedPhone: true,
  preferredContactMethod: true,
  status: true,
  revokedAt: true,
  client: {
    select: {
      id: true,
      claimStatus: true,
    },
  },
} satisfies Prisma.ProClientInviteSelect

type PublicProClientInvite = Prisma.ProClientInviteGetPayload<{
  select: typeof publicProClientInviteSelect
}>

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isInviteRevoked(
  invite: Pick<PublicProClientInvite, 'status' | 'revokedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED ||
    invite.revokedAt != null
  )
}

function isClientClaimed(
  invite: Pick<PublicProClientInvite, 'client'>,
): boolean {
  return invite.client?.claimStatus === ClientClaimStatus.CLAIMED
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const params = await Promise.resolve(ctx.params)
    const token = asTrimmedString(params?.token)

    if (!token) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    const invite = await prisma.proClientInvite.findUnique({
      where: { token },
      select: publicProClientInviteSelect,
    })

    if (!invite || !invite.client) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    if (isInviteRevoked(invite)) {
      return jsonFail(410, 'Invite is no longer available.', {
        code: 'REVOKED',
      })
    }

    if (isClientClaimed(invite)) {
      return jsonFail(409, 'Invite already claimed.', {
        code: 'ALREADY_CLAIMED',
      })
    }

    return jsonOk(
      {
        inviteId: invite.id,
        professionalId: invite.professionalId,
        bookingId: invite.bookingId,
        invitedName: invite.invitedName,
        invitedEmail: invite.invitedEmail,
        invitedPhone: invite.invitedPhone,
        preferredContactMethod: invite.preferredContactMethod,
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/invites/[token] error', error)
    return jsonFail(500, 'Internal server error')
  }
}