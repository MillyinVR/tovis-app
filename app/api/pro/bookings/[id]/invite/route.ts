// app/api/pro/bookings/[id]/invite/route.ts
import { ContactMethod, ProClientInviteStatus } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { createClientClaimInviteDelivery } from '@/lib/clientActions/createClientClaimInviteDelivery'
import { upsertClientClaimLink } from '@/lib/clients/clientClaimLinks'
import { asTrimmedString, isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { safeError, safeLogMeta } from '@/lib/security/logging'
import type { TenantContext } from '@/lib/tenant/context'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type InviteRequestBody = {
  name?: unknown
  email?: unknown
  phone?: unknown
  preferredContactMethod?: unknown
}

type NormalizedInviteInput = {
  name: string | null
  email: string | null
  phone: string | null
  preferredContactMethod: ContactMethod | null | 'invalid'
}

type InviteDeliverySummary = {
  attempted: boolean
  queued: boolean
  href: string | null
}

type BookingInviteContext = {
  id: string
  clientId: string
  client: {
    userId: string | null
  } | null
}

type ClaimInviteForDelivery = {
  id: string
  rawToken: string | null
  status: ProClientInviteStatus
  acceptedAt: Date | null
  revokedAt: Date | null
  invitedName: string
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null
}

function parsePreferredContactMethod(
  value: unknown,
): ContactMethod | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'invalid'

  const normalized = value.trim().toUpperCase()

  if (normalized === ContactMethod.EMAIL) return ContactMethod.EMAIL
  if (normalized === ContactMethod.SMS) return ContactMethod.SMS

  return 'invalid'
}

function normalizeInviteInput(rawBody: unknown): NormalizedInviteInput {
  const body: InviteRequestBody = isRecord(rawBody) ? rawBody : {}

  return {
    name: asTrimmedString(body.name),
    email: asTrimmedString(body.email),
    phone: asTrimmedString(body.phone),
    preferredContactMethod: parsePreferredContactMethod(
      body.preferredContactMethod,
    ),
  }
}

function validateInviteInput(input: NormalizedInviteInput): Response | null {
  if (!input.name) {
    return jsonFail(400, 'Name is required.', {
      code: 'VALIDATION_ERROR',
    })
  }

  if (!input.email && !input.phone) {
    return jsonFail(400, 'Email or phone is required.', {
      code: 'VALIDATION_ERROR',
    })
  }

  if (input.preferredContactMethod === 'invalid') {
    return jsonFail(400, 'Invalid preferredContactMethod.', {
      code: 'VALIDATION_ERROR',
    })
  }

  if (input.preferredContactMethod === ContactMethod.SMS && !input.phone) {
    return jsonFail(
      400,
      'Phone is required when preferredContactMethod is SMS.',
      { code: 'VALIDATION_ERROR' },
    )
  }

  if (input.preferredContactMethod === ContactMethod.EMAIL && !input.email) {
    return jsonFail(
      400,
      'Email is required when preferredContactMethod is EMAIL.',
      { code: 'VALIDATION_ERROR' },
    )
  }

  return null
}

function shouldAttemptInviteDelivery(invite: {
  status: ProClientInviteStatus
  acceptedAt: Date | null
  revokedAt: Date | null
  rawToken: string | null
}): invite is typeof invite & { rawToken: string } {
  return (
    invite.status === ProClientInviteStatus.PENDING &&
    invite.acceptedAt == null &&
    invite.revokedAt == null &&
    typeof invite.rawToken === 'string' &&
    invite.rawToken.trim().length > 0
  )
}

async function maybeQueueInviteDelivery(args: {
  professionalId: string
  actorUserId: string | null
  tenantContext: TenantContext
  booking: BookingInviteContext
  invite: ClaimInviteForDelivery
}): Promise<InviteDeliverySummary> {
  if (!shouldAttemptInviteDelivery(args.invite)) {
    return {
      attempted: false,
      queued: false,
      href: null,
    }
  }

  const rawToken = args.invite.rawToken

  try {
    const delivery = await createClientClaimInviteDelivery({
      tenantContext: args.tenantContext,
      professionalId: args.professionalId,
      clientId: args.booking.clientId,
      bookingId: args.booking.id,
      inviteId: args.invite.id,
      rawToken,
      invitedName: args.invite.invitedName,
      invitedEmail: args.invite.invitedEmail,
      invitedPhone: args.invite.invitedPhone,
      preferredContactMethod: args.invite.preferredContactMethod,
      issuedByUserId: args.actorUserId,
      recipientUserId: args.booking.client?.userId ?? null,
    })

    return {
      attempted: true,
      queued: true,
      href: delivery.link.href,
    }
  } catch (error: unknown) {
    console.error('POST /api/pro/bookings/[id]/invite delivery enqueue failed', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'POST /api/pro/bookings/[id]/invite',
        professionalId: args.professionalId,
        bookingId: args.booking.id,
        clientId: args.booking.clientId,
        inviteId: args.invite.id,
      }),
    })

    return {
      attempted: true,
      queued: false,
      href: null,
    }
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const params = await resolveRouteParams(ctx)
    const bookingId = asTrimmedString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.', {
        code: 'VALIDATION_ERROR',
      })
    }

    const rawBody: unknown = await request.json().catch(() => ({}))
    const input = normalizeInviteInput(rawBody)

    const validationError = validateInviteInput(input)
    if (validationError) {
      return validationError
    }

    if (!input.name || input.preferredContactMethod === 'invalid') {
      return jsonFail(400, 'Invalid invite input.', {
        code: 'VALIDATION_ERROR',
      })
    }

    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        professionalId: auth.professionalId,
      },
      select: {
        id: true,
        clientId: true,
        client: {
          select: {
            userId: true,
          },
        },
      },
    })

    if (!booking) {
      return jsonFail(403, 'Forbidden.', {
        code: 'FORBIDDEN',
      })
    }

    const invite = await upsertClientClaimLink({
      professionalId: auth.professionalId,
      clientId: booking.clientId,
      bookingId: booking.id,
      invitedName: input.name,
      invitedEmail: input.email,
      invitedPhone: input.phone,
      preferredContactMethod: input.preferredContactMethod,
    })

    const inviteDelivery = await maybeQueueInviteDelivery({
      professionalId: auth.professionalId,
      actorUserId: asTrimmedString(auth.user?.id) ?? null,
      tenantContext: await resolveTenantContextForRequest(request),
      booking,
      invite: {
        id: invite.id,
        rawToken: invite.rawToken,
        status: invite.status,
        acceptedAt: invite.acceptedAt,
        revokedAt: invite.revokedAt,
        invitedName: invite.invitedName,
        invitedEmail: invite.invitedEmail,
        invitedPhone: invite.invitedPhone,
        preferredContactMethod: invite.preferredContactMethod,
      },
    })

    return jsonOk(
      {
        invite: {
          id: invite.id,

          // Token is returned so the caller can display/share the claim link
          // immediately. For new invites, this is the non-persisted raw token;
          // ProClientInvite stores tokenHash instead.
          token: invite.rawToken,

          status: invite.status,
          invitedName: invite.invitedName,
          invitedEmail: invite.invitedEmail,
          invitedPhone: invite.invitedPhone,
          preferredContactMethod: invite.preferredContactMethod,
        },
        inviteDelivery,
      },
      200,
    )
  } catch (error: unknown) {
    console.error('POST /api/pro/bookings/[id]/invite error', {
      error: safeError(error),
      meta: safeLogMeta({
        route: 'POST /api/pro/bookings/[id]/invite',
      }),
    })

    return jsonFail(500, 'Internal server error')
  }
}