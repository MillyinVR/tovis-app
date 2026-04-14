import {
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { createClientClaimInviteDelivery } from '@/lib/clientActions/createClientClaimInviteDelivery'
import { upsertClientClaimLink } from '@/lib/clients/clientClaimLinks'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
}): boolean {
  return (
    invite.status === ProClientInviteStatus.PENDING &&
    invite.acceptedAt == null &&
    invite.revokedAt == null
  )
}

async function maybeQueueInviteDelivery(args: {
  professionalId: string
  actorUserId: string | null
  booking: BookingInviteContext
  invite: {
    id: string
    token: string
    status: ProClientInviteStatus
    acceptedAt: Date | null
    revokedAt: Date | null
    invitedName: string
    invitedEmail: string | null
    invitedPhone: string | null
    preferredContactMethod: ContactMethod | null
  }
}): Promise<InviteDeliverySummary> {
  if (!shouldAttemptInviteDelivery(args.invite)) {
    return {
      attempted: false,
      queued: false,
      href: null,
    }
  }

  try {
    const delivery = await createClientClaimInviteDelivery({
      professionalId: args.professionalId,
      clientId: args.booking.clientId,
      bookingId: args.booking.id,
      inviteId: args.invite.id,
      rawToken: args.invite.token,
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
      professionalId: args.professionalId,
      bookingId: args.booking.id,
      clientId: args.booking.clientId,
      inviteId: args.invite.id,
      error,
    })

    return {
      attempted: true,
      queued: false,
      href: null,
    }
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
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
      booking,
      invite: {
        id: invite.id,
        token: invite.token,
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
          token: invite.token,
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
    console.error('POST /api/pro/bookings/[id]/invite error', error)
    return jsonFail(500, 'Internal server error')
  }
}