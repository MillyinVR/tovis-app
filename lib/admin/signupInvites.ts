import { Prisma } from '@prisma/client'

import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import {
  generateSignupInviteCode,
  signupInviteCodeHash,
  signupInviteCodeHint,
} from '@/lib/auth/signupInvite'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prismaErrors'

const MAX_LABEL_LENGTH = 160
const MAX_GENERATION_ATTEMPTS = 3

const signupInviteListSelect = {
  id: true,
  codeHint: true,
  label: true,
  expiresAt: true,
  usedAt: true,
  revokedAt: true,
  createdAt: true,
  createdByAdminUser: {
    select: { id: true, email: true }, // pii-plaintext-read-ok: admin-only invite audit surface
  },
  usedByUser: {
    select: { id: true, email: true, role: true }, // pii-plaintext-read-ok: admin-only invite audit surface
  },
} satisfies Prisma.SignupInviteSelect

export type SignupInviteListItem = Prisma.SignupInviteGetPayload<{
  select: typeof signupInviteListSelect
}>

export type CreatedSignupInvite = SignupInviteListItem & {
  code: string
}

function normalizeLabel(rawLabel: string): string {
  return rawLabel.trim().slice(0, MAX_LABEL_LENGTH)
}

export async function listSignupInvites(args?: {
  take?: number
}): Promise<SignupInviteListItem[]> {
  const take = Math.max(1, Math.min(500, Math.trunc(args?.take ?? 200)))

  return prisma.signupInvite.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: signupInviteListSelect,
  })
}

export async function createSignupInvite(args: {
  adminUserId: string
  label: string
  expiresAt: Date
}): Promise<CreatedSignupInvite> {
  const adminUserId = args.adminUserId.trim()
  const label = normalizeLabel(args.label)

  if (!adminUserId) throw new Error('Admin user id is required.')
  if (!label) throw new Error('Enter the invited person’s name or label.')
  if (!Number.isFinite(args.expiresAt.getTime()) || args.expiresAt <= new Date()) {
    throw new Error('Expiration must be in the future.')
  }

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateSignupInviteCode()

    try {
      const created = await prisma.$transaction(async (tx) => {
        const invite = await tx.signupInvite.create({
          data: {
            codeHash: signupInviteCodeHash(code),
            codeHint: signupInviteCodeHint(code),
            label,
            createdByAdminUserId: adminUserId,
            expiresAt: args.expiresAt,
          },
          select: signupInviteListSelect,
        })

        await writeAdminAuditLog({
          adminUserId,
          action: 'SIGNUP_INVITE_CREATED',
          targetType: 'signup_invite',
          targetId: invite.id,
          metadata: {
            label,
            expiresAt: args.expiresAt.toISOString(),
            codeHint: invite.codeHint,
          },
          tx,
        })

        return invite
      })

      return { ...created, code }
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === MAX_GENERATION_ATTEMPTS - 1) {
        throw error
      }
    }
  }

  throw new Error('Could not generate a unique invite code.')
}

export async function revokeSignupInvite(args: {
  adminUserId: string
  inviteId: string
}): Promise<'revoked' | 'already_revoked' | 'used' | 'not_found'> {
  const adminUserId = args.adminUserId.trim()
  const inviteId = args.inviteId.trim()
  if (!adminUserId || !inviteId) return 'not_found'

  return prisma.$transaction(async (tx) => {
    const updated = await tx.signupInvite.updateMany({
      where: {
        id: inviteId,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    })

    if (updated.count === 1) {
      await writeAdminAuditLog({
        adminUserId,
        action: 'SIGNUP_INVITE_REVOKED',
        targetType: 'signup_invite',
        targetId: inviteId,
        tx,
      })
      return 'revoked'
    }

    const existing = await tx.signupInvite.findUnique({
      where: { id: inviteId },
      select: { usedAt: true, revokedAt: true },
    })
    if (!existing) return 'not_found'
    if (existing.usedAt) return 'used'
    return 'already_revoked'
  })
}
