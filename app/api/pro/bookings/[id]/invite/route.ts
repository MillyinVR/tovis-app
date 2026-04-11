import { ContactMethod } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { createProClientInvite } from '@/lib/invites/proClientInvite'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

type InviteRequestBody = {
  name?: unknown
  email?: unknown
  phone?: unknown
  preferredContactMethod?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parsePreferredContactMethod(value: unknown): ContactMethod | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null

  const normalized = value.trim().toUpperCase()
  if (normalized === ContactMethod.EMAIL) return ContactMethod.EMAIL
  if (normalized === ContactMethod.SMS) return ContactMethod.SMS
  return null
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const bookingId = asTrimmedString(params?.id)

    if (!bookingId) {
      return jsonFail(400, 'Missing booking id.', { code: 'VALIDATION_ERROR' })
    }

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body: InviteRequestBody = isRecord(rawBody) ? rawBody : {}

    const name = asTrimmedString(body.name)
    const email = asTrimmedString(body.email)
    const phone = asTrimmedString(body.phone)
    const preferredContactMethod = parsePreferredContactMethod(
      body.preferredContactMethod,
    )

    if (!name) {
      return jsonFail(400, 'Name is required.', { code: 'VALIDATION_ERROR' })
    }

    if (!email && !phone) {
      return jsonFail(400, 'Email or phone is required.', {
        code: 'VALIDATION_ERROR',
      })
    }

    if (body.preferredContactMethod != null && !preferredContactMethod) {
      return jsonFail(400, 'Invalid preferredContactMethod.', {
        code: 'VALIDATION_ERROR',
      })
    }

    if (preferredContactMethod === ContactMethod.SMS && !phone) {
      return jsonFail(400, 'Phone is required when preferredContactMethod is SMS.', {
        code: 'VALIDATION_ERROR',
      })
    }

    if (preferredContactMethod === ContactMethod.EMAIL && !email) {
      return jsonFail(400, 'Email is required when preferredContactMethod is EMAIL.', {
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
        professionalId: true,
      },
    })

    if (!booking) {
      return jsonFail(403, 'Forbidden.', { code: 'FORBIDDEN' })
    }

    const invite = await createProClientInvite({
      professionalId: auth.professionalId,
      bookingId: booking.id,
      invitedName: name,
      invitedEmail: email,
      invitedPhone: phone,
      preferredContactMethod,
    })

    return jsonOk({ inviteId: invite.id, token: invite.token }, 201)
  } catch (error) {
    console.error('POST /api/pro/bookings/[id]/invite error', error)
    return jsonFail(500, 'Internal server error')
  }
}