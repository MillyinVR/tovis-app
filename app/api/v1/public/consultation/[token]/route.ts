// app/api/v1/public/consultation/[token]/route.ts 

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import {
  enforceRateLimit,
  rateLimitIdentity,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import { deriveConsultRevisionState } from '@/lib/consult/inChairRevision'
import { asTrimmedString } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import {
  clientActionTokenRateLimitPrefix,
  hashClientActionToken,
} from '@/lib/consultation/clientActionTokens'
import { ClientActionTokenKind, ConsultationApprovalStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function asIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
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

export async function GET(_request: Request, ctx: RouteContext<{ token: string }>) {
  try {
    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return jsonFail(404, 'Consultation link not found.', {
        code: 'NOT_FOUND',
      })
    }

    // Brute-force guard: cap by IP and by token-prefix BEFORE any DB lookup,
    // exactly as the decision route next door does for this same token space.
    // Deliberately SEPARATE buckets from consultation:decision, not shared
    // ones: this GET fires on every page view, and metering it out of the
    // decision budget (8 per 5 min) would let a handful of refreshes lock a
    // client out of actually approving. It still cannot stay unmetered — this
    // is the widest public view of the consultation record (proof rows carry
    // ipAddress, userAgent, and contact snapshots) behind an unauthenticated,
    // DB-hitting read.
    const ipLimited = await enforceRateLimit({
      bucket: 'consultation:read',
      identity: await rateLimitIdentity(),
    })
    if (ipLimited) return ipLimited

    const tokenLimited = await enforceRateLimit({
      bucket: 'consultation:read:token',
      identity: tokenRateLimitIdentity(
        clientActionTokenRateLimitPrefix(rawToken),
      ),
    })
    if (tokenLimited) return tokenLimited

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
            locationTimeZone: true,
            clientTimeZoneAtBooking: true,
            // B6 — the figures the client committed to, so the revision notice
            // can be judged against them on this surface exactly as it is on
            // her signed-in booking page.
            consultBookingProposal: {
              select: { startingAtPrice: true, totalDurationMinutes: true },
            },
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
                firstName: true,
                lastName: true,
                handle: true,
                nameDisplay: true,
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
          // The appointment happens at the service location, so display times
          // in the location's zone (snapshot) — not the pro's profile zone,
          // which can differ (e.g. a CA appointment under a Central-time pro).
          appointmentTimeZone:
            token.booking.locationTimeZone ??
            token.booking.clientTimeZoneAtBooking ??
            token.booking.professional.timeZone ??
            null,
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
            firstName: token.booking.professional.firstName,
            lastName: token.booking.professional.lastName,
            handle: token.booking.professional.handle,
            nameDisplay: token.booking.professional.nameDisplay,
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
          // Return only what the token bearer needs to confirm their own
          // decision. The internal audit fields (recordedByUserId, ipAddress,
          // userAgent, clientActionTokenId) and counterparty contact
          // (contactMethod, destinationSnapshot) are NOT exposed to the bearer.
          proof: approval.proof
            ? {
                id: approval.proof.id,
                decision: approval.proof.decision,
                method: approval.proof.method,
                actedAt: asIso(approval.proof.actedAt),
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
        // Book the Look, B6 — has the pro's number moved past the revision
        // threshold? Derived on the SERVER from the same rows the signed-in
        // page uses, so the emailed link and her booking page cannot describe
        // one change two ways. Null on every ordinary consultation.
        //
        // Neither surface offers a cancel BUTTON — a client cannot cancel a
        // started appointment (IN_PROGRESS → CANCELLED is admin-only under the
        // M8 lifecycle contract), so the notice names the escape that works.
        // See the header of app/client/_components/ConsultRevisionNotice.tsx.
        revision:
          deriveConsultRevisionState({
            id: token.booking.id,
            clientId: token.booking.client.id,
            consultBookingProposal: token.booking.consultBookingProposal,
            consultationApproval: {
              id: approval.id,
              status: approval.status,
              proposedTotal: approval.proposedTotal,
              proposedServicesJson: approval.proposedServicesJson,
            },
          })?.notice ?? null,
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
    console.error('GET /api/v1/public/consultation/[token] error', error)

    if (asTrimmedString(message)?.includes('invalid or expired')) {
      return jsonFail(404, 'Consultation link not found.', {
        code: 'NOT_FOUND',
      })
    }

    return jsonFail(500, 'Internal server error')
  }
}