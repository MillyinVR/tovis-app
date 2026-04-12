import { Prisma, ProClientInviteStatus } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

type InviteAcceptanceResult =
  | { kind: 'not_found' }
  | { kind: 'revoked' }
  | { kind: 'already_accepted' }
  | { kind: 'client_not_found' }
  | { kind: 'conflict' }
  | { kind: 'ok'; bookingId: string }

const acceptInviteSelect = {
  id: true,
  bookingId: true,
  status: true,
  acceptedAt: true,
  revokedAt: true,
  preferredContactMethod: true,
} satisfies Prisma.ProClientInviteSelect

type AcceptInviteRow = Prisma.ProClientInviteGetPayload<{
  select: typeof acceptInviteSelect
}>

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isInviteAccepted(
  invite: Pick<AcceptInviteRow, 'status' | 'acceptedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.ACCEPTED ||
    invite.acceptedAt != null
  )
}

function isInviteRevoked(
  invite: Pick<AcceptInviteRow, 'status' | 'revokedAt'>,
): boolean {
  return (
    invite.status === ProClientInviteStatus.REVOKED ||
    invite.revokedAt != null
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
          select: acceptInviteSelect,
        })

        if (!invite) {
          return { kind: 'not_found' }
        }

        if (isInviteAccepted(invite)) {
          return { kind: 'already_accepted' }
        }

        if (isInviteRevoked(invite)) {
          return { kind: 'revoked' }
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
            revokedAt: null,
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
              revokedAt: true,
              bookingId: true,
            },
          })

          if (!current) {
            return { kind: 'not_found' }
          }

          if (
            current.status === ProClientInviteStatus.ACCEPTED ||
            current.acceptedAt != null
          ) {
            return { kind: 'already_accepted' }
          }

          if (
            current.status === ProClientInviteStatus.REVOKED ||
            current.revokedAt != null
          ) {
            return { kind: 'revoked' }
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

    if (result.kind === 'revoked') {
      return jsonFail(410, 'Invite is no longer available.', {
        code: 'REVOKED',
      })
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