import { ProClientInviteStatus } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

type InviteAcceptanceResult =
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'already_accepted' }
  | { kind: 'client_not_found' }
  | { kind: 'conflict' }
  | { kind: 'ok'; bookingId: string }

const ACCEPT_INVITE_SELECT = {
  id: true,
  bookingId: true,
  status: true,
  acceptedAt: true,
  expiresAt: true,
  preferredContactMethod: true,
} as const

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isInviteExpired(args: {
  status: ProClientInviteStatus
  expiresAt: Date
  now: Date
}): boolean {
  return (
    args.status === ProClientInviteStatus.EXPIRED ||
    args.expiresAt.getTime() <= args.now.getTime()
  )
}

function isInviteAccepted(args: {
  status: ProClientInviteStatus
  acceptedAt: Date | null
}): boolean {
  return (
    args.status === ProClientInviteStatus.ACCEPTED || args.acceptedAt != null
  )
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

    const result = await prisma.$transaction<InviteAcceptanceResult>(
      async (tx) => {
        const invite = await tx.proClientInvite.findUnique({
          where: { token },
          select: ACCEPT_INVITE_SELECT,
        })

        if (!invite) {
          return { kind: 'not_found' }
        }

        if (
          isInviteAccepted({
            status: invite.status,
            acceptedAt: invite.acceptedAt,
          })
        ) {
          return { kind: 'already_accepted' }
        }

        if (
          isInviteExpired({
            status: invite.status,
            expiresAt: invite.expiresAt,
            now,
          })
        ) {
          return { kind: 'expired' }
        }

        const clientProfile = await tx.clientProfile.findUnique({
          where: { id: auth.clientId },
          select: {
            id: true,
            preferredContactMethod: true,
          },
        })

        if (!clientProfile) {
          return { kind: 'client_not_found' }
        }

        const claimed = await tx.proClientInvite.updateMany({
          where: {
            id: invite.id,
            status: ProClientInviteStatus.PENDING,
            acceptedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            status: ProClientInviteStatus.ACCEPTED,
            acceptedAt: now,
            acceptedByUserId: auth.user.id,
          },
        })

        if (claimed.count !== 1) {
          const current = await tx.proClientInvite.findUnique({
            where: { id: invite.id },
            select: {
              status: true,
              acceptedAt: true,
              expiresAt: true,
              bookingId: true,
            },
          })

          if (!current) {
            return { kind: 'not_found' }
          }

          if (
            isInviteAccepted({
              status: current.status,
              acceptedAt: current.acceptedAt,
            })
          ) {
            return { kind: 'already_accepted' }
          }

          if (
            isInviteExpired({
              status: current.status,
              expiresAt: current.expiresAt,
              now,
            })
          ) {
            return { kind: 'expired' }
          }

          return { kind: 'conflict' }
        }

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
          kind: 'ok',
          bookingId: invite.bookingId,
        }
      },
    )

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

    if (result.kind === 'client_not_found') {
      return jsonFail(404, 'Client profile not found.', {
        code: 'CLIENT_NOT_FOUND',
      })
    }

    if (result.kind === 'conflict') {
      return jsonFail(409, 'Invite could not be accepted.', {
        code: 'CONFLICT',
      })
    }

    return jsonOk({ bookingId: result.bookingId }, 200)
  } catch (error) {
    console.error('POST /api/pro/invites/[token]/accept error', error)
    return jsonFail(500, 'Internal server error')
  }
}