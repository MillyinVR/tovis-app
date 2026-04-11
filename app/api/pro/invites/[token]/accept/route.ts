import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const token = asTrimmedString(params?.token)

    if (!token) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    const now = new Date()

    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.proClientInvite.findUnique({
        where: { token },
        select: {
          id: true,
          bookingId: true,
          status: true,
          expiresAt: true,
          acceptedAt: true,
          acceptedByUserId: true,
          preferredContactMethod: true,
        },
      })

      if (!invite) {
        return {
          kind: 'not_found' as const,
        }
      }

      if (invite.status === 'EXPIRED' || invite.expiresAt.getTime() < now.getTime()) {
        return {
          kind: 'expired' as const,
        }
      }

      if (invite.status === 'ACCEPTED') {
        return {
          kind: 'already_accepted' as const,
        }
      }

      const clientProfile = await tx.clientProfile.findUnique({
        where: { id: auth.clientId },
        select: {
          id: true,
          preferredContactMethod: true,
        },
      })

      if (!clientProfile) {
        return {
          kind: 'not_found' as const,
        }
      }

      await tx.proClientInvite.update({
        where: { id: invite.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: now,
          acceptedByUserId: auth.user.id,
        },
      })

      if (
        invite.preferredContactMethod &&
        clientProfile.preferredContactMethod == null
      ) {
        await tx.clientProfile.update({
          where: { id: clientProfile.id },
          data: {
            preferredContactMethod: invite.preferredContactMethod,
          },
        })
      }

      return {
        kind: 'ok' as const,
        bookingId: invite.bookingId,
      }
    })

    if (result.kind === 'not_found') {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    if (result.kind === 'expired') {
      return jsonFail(410, 'Invite has expired.', { code: 'EXPIRED' })
    }

    if (result.kind === 'already_accepted') {
      return jsonFail(409, 'Invite already accepted.', {
        code: 'ALREADY_ACCEPTED',
      })
    }

    return jsonOk({ bookingId: result.bookingId }, 200)
  } catch (error) {
    console.error('POST /api/pro/invites/[token]/accept error', error)
    return jsonFail(500, 'Internal server error')
  }
}