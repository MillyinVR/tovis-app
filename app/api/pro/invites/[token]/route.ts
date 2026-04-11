import { jsonFail, jsonOk } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
      select: {
        id: true,
        professionalId: true,
        bookingId: true,
        invitedName: true,
        invitedEmail: true,
        invitedPhone: true,
        preferredContactMethod: true,
        expiresAt: true,
        status: true,
      },
    })

    if (!invite) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    const now = new Date()

    if (invite.status === 'EXPIRED' || invite.expiresAt.getTime() < now.getTime()) {
      return jsonFail(410, 'Invite has expired.', { code: 'EXPIRED' })
    }

    if (invite.status === 'ACCEPTED') {
      return jsonFail(409, 'Invite already accepted.', {
        code: 'ALREADY_ACCEPTED',
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
        expiresAt: invite.expiresAt,
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/invites/[token] error', error)
    return jsonFail(500, 'Internal server error')
  }
}