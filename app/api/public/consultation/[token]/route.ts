import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'
import { ClientActionTokenKind, ConsultationApprovalStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = {
  params: { token: string } | Promise<{ token: string }>
}

function asIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isPendingAndActionable(args: {
  approvalStatus: ConsultationApprovalStatus
  hasProof: boolean
  revokedAt: Date | null
  expiresAt: Date
  singleUse: boolean
  firstUsedAt: Date | null
  now: Date
}): boolean {
  if (args.approvalStatus !== ConsultationApprovalStatus.PENDING) return false
  if (args.hasProof) return false
  if (args.revokedAt) return false
  if (args.expiresAt.getTime() <= args.now.getTime()) return false
  if (args.singleUse && args.firstUsedAt) return false
  return true
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const params = await Promise.resolve(ctx.params)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return jsonFail(404, 'Consultation link not found.', {
        code: 'NOT_FOUND',
      })
    }

    const tokenHash = hashClientActionToken(rawToken)

    const token = await prisma.clientActionToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        kind: true,
        singleUse: true,
        bookingId: true,
        consultationApprovalId: true,
        clientId: true,
        professionalId: true,
        deliveryMethod: true,
        recipientEmailSnapshot: true,
        recipientPhoneSnapshot: true,
        expiresAt: true,
        firstUsedAt: true,
        lastUsedAt: true,
        useCount: true,
        revokedAt: true,
        revokeReason: true,
        booking: {
          select: {
            id: true,
            status: true,
            sessionStep: true,
            scheduledFor: true,
            startedAt: true,
            finishedAt: true,
            locationType: true,
            service: {
              select: {
                id: true,
                name: true,
              },
            },
            client: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                claimStatus: true,
              },
            },
            professional: {
              select: {
                id: true,
                businessName: true,
                timeZone: true,
              },
            },
          },
        },
        consultationApproval: {
          select: {
            id: true,
            status: true,
            proposedServicesJson: true,
            proposedTotal: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
            approvedAt: true,
            rejectedAt: true,
            clientId: true,
            proId: true,
            proof: {
              select: {
                id: true,
                decision: true,
                method: true,
                actedAt: true,
                recordedByUserId: true,
                clientActionTokenId: true,
                contactMethod: true,
                destinationSnapshot: true,
                ipAddress: true,
                userAgent: true,
              },
            },
          },
        },
      },
    })

    if (!token || token.kind !== ClientActionTokenKind.CONSULTATION_ACTION) {
      return jsonFail(404, 'Consultation link not found.', {
        code: 'NOT_FOUND',
      })
    }

    if (!token.consultationApprovalId || !token.consultationApproval) {
      return jsonFail(404, 'Consultation proposal not found.', {
        code: 'NOT_FOUND',
      })
    }

    const approval = token.consultationApproval
    const now = new Date()

    const destinationSnapshot =
      token.deliveryMethod === 'EMAIL'
        ? token.recipientEmailSnapshot
        : token.deliveryMethod === 'SMS'
          ? token.recipientPhoneSnapshot
          : token.recipientEmailSnapshot ?? token.recipientPhoneSnapshot ?? null

    const canApproveOrReject = isPendingAndActionable({
      approvalStatus: approval.status,
      hasProof: Boolean(approval.proof?.id),
      revokedAt: token.revokedAt,
      expiresAt: token.expiresAt,
      singleUse: token.singleUse,
      firstUsedAt: token.firstUsedAt,
      now,
    })

    return jsonOk(
      {
        booking: {
          id: token.booking.id,
          status: token.booking.status,
          sessionStep: token.booking.sessionStep,
          scheduledFor: asIso(token.booking.scheduledFor),
          startedAt: asIso(token.booking.startedAt),
          finishedAt: asIso(token.booking.finishedAt),
          locationType: token.booking.locationType,
          service: token.booking.service
            ? {
                id: token.booking.service.id,
                name: token.booking.service.name,
              }
            : null,
          client: {
            id: token.booking.client.id,
            firstName: token.booking.client.firstName,
            lastName: token.booking.client.lastName,
            claimStatus: token.booking.client.claimStatus,
          },
          professional: {
            id: token.booking.professional.id,
            businessName: token.booking.professional.businessName,
            timeZone: token.booking.professional.timeZone,
          },
        },
        approval: {
          id: approval.id,
          status: approval.status,
          proposedServicesJson: approval.proposedServicesJson,
          proposedTotal: approval.proposedTotal,
          notes: approval.notes,
          createdAt: asIso(approval.createdAt),
          updatedAt: asIso(approval.updatedAt),
          approvedAt: asIso(approval.approvedAt),
          rejectedAt: asIso(approval.rejectedAt),
          clientId: approval.clientId,
          proId: approval.proId,
          proof: approval.proof
            ? {
                id: approval.proof.id,
                decision: approval.proof.decision,
                method: approval.proof.method,
                actedAt: asIso(approval.proof.actedAt),
                recordedByUserId: approval.proof.recordedByUserId,
                clientActionTokenId: approval.proof.clientActionTokenId,
                contactMethod: approval.proof.contactMethod,
                destinationSnapshot: approval.proof.destinationSnapshot,
                ipAddress: approval.proof.ipAddress,
                userAgent: approval.proof.userAgent,
              }
            : null,
        },
        token: {
          id: token.id,
          deliveryMethod: token.deliveryMethod,
          destinationSnapshot,
          expiresAt: asIso(token.expiresAt),
          firstUsedAt: asIso(token.firstUsedAt),
          lastUsedAt: asIso(token.lastUsedAt),
          useCount: token.useCount,
          singleUse: token.singleUse,
          revokedAt: asIso(token.revokedAt),
          revokeReason: token.revokeReason,
        },
        actionState: {
          canApproveOrReject,
          isExpired: token.expiresAt.getTime() <= now.getTime(),
          isRevoked: Boolean(token.revokedAt),
          isUsed: Boolean(token.firstUsedAt),
          hasProof: Boolean(approval.proof?.id),
          isPending: approval.status === ConsultationApprovalStatus.PENDING,
        },
      },
      200,
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Internal server error'
    console.error('GET /api/public/consultation/[token] error', error)

    if (asTrimmedString(message)?.includes('invalid or expired')) {
      return jsonFail(404, 'Consultation link not found.', {
        code: 'NOT_FOUND',
      })
    }

    return jsonFail(500, 'Internal server error')
  }
}