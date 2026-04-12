import { Prisma, ProClientInviteStatus } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

const publicProClientInviteSelect = {
  id: true,
  professionalId: true,
  bookingId: true,
  invitedName: true,
  invitedEmail: true,
  invitedPhone: true,
  preferredContactMethod: true,
  status: true,
  acceptedAt: true,
  revokedAt: true,
} satisfies Prisma.ProClientInviteSelect

type PublicProClientInvite = Prisma.ProClientInviteGetPayload<{
  select: typeof publicProClientInviteSelect
}>

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isInviteAccepted(
  invite: Pick<PublicProClientInvite, 'status' | 'acceptedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.ACCEPTED ||
    invite.acceptedAt != null
  )
}

function isInviteRevoked(
  invite: Pick<PublicProClientInvite, 'status' | 'revokedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED ||
    invite.revokedAt != null
  )
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

    if (!invite) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    if (isInviteAccepted(invite)) {
      return jsonFail(409, 'Invite already accepted.', {
        code: 'ALREADY_ACCEPTED',
      })
    }

    if (isInviteRevoked(invite)) {
      return jsonFail(410, 'Invite is no longer available.', {
        code: 'REVOKED',
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