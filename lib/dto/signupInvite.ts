import type { Role } from '@prisma/client'

export type SignupInviteAdminDTO = {
  id: string
  codeHint: string
  label: string
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
  createdAt: string
  createdBy: { id: string; email: string }
  usedBy: { id: string; email: string; role: Role } | null
}

export type CreatedSignupInviteAdminDTO = SignupInviteAdminDTO & {
  code: string
}
