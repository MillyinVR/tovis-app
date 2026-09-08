import { NextRequest } from 'next/server'

import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { requireSignupInviteAdmin } from './_auth'
import {
  createSignupInvite,
  listSignupInvites,
  type SignupInviteListItem,
} from '@/lib/admin/signupInvites'
import type {
  CreatedSignupInviteAdminDTO,
  SignupInviteAdminDTO,
} from '@/lib/dto/signupInvite'
import { isRecord } from '@/lib/guards'

export const dynamic = 'force-dynamic'

function toDto(invite: SignupInviteListItem): SignupInviteAdminDTO {
  return {
    id: invite.id,
    codeHint: invite.codeHint,
    label: invite.label,
    expiresAt: invite.expiresAt.toISOString(),
    usedAt: invite.usedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
    createdBy: invite.createdByAdminUser,
    usedBy: invite.usedByUser,
  }
}

export async function GET(): Promise<Response> {
  const auth = await requireSignupInviteAdmin()
  if (!auth.ok) return auth.res

  const invites = await listSignupInvites()
  return jsonOk({ invites: invites.map(toDto) }, 200)
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireSignupInviteAdmin()
  if (!auth.ok) return auth.res

  const rawBody: unknown = await request.json().catch(() => ({}))
  const body = isRecord(rawBody) ? rawBody : {}
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const expiresInDays =
    typeof body.expiresInDays === 'number'
      ? Math.trunc(body.expiresInDays)
      : Number.NaN

  if (!label) return jsonFail(400, 'Enter the invited person’s name or label.')
  if (label.length > 160) {
    return jsonFail(400, 'The invited person’s name or label is too long.')
  }
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
    return jsonFail(400, 'Expiration must be between 1 and 90 days.')
  }

  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
  const created = await createSignupInvite({
    adminUserId: auth.user.id,
    label,
    expiresAt,
  })

  const result: CreatedSignupInviteAdminDTO = {
    ...toDto(created),
    code: created.code,
  }
  return jsonOk({ invite: result }, 201)
}
