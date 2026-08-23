// lib/auth/contactVerification.ts
//
// The ONE place a contact channel gets marked verified. Every path that proves
// ownership of a phone or email (OTP check, email-link click, passwordless
// phone login, claim-link click) funnels through these writes instead of
// inlining its own copy — the copies had already drifted (phone login stamped
// only User, while the OTP route also fanned the timestamp to the role
// profile).
//
// Semantics are idempotent by construction: a guarded updateMany that only
// writes where the timestamp is still null, so an earlier verification is
// never restamped and callers don't need a read-first guard of their own.
// ClientProfile mirrors phoneVerifiedAt only — the schema has no
// ClientProfile.emailVerifiedAt; email verification state lives on User alone.

import type { Prisma, Role } from '@prisma/client'

import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | typeof prisma

export async function markUserPhoneVerified(
  db: Db,
  args: {
    userId: string
    role: Role
    verifiedAt: Date
  },
): Promise<void> {
  await db.user.updateMany({
    where: { id: args.userId, phoneVerifiedAt: null },
    data: { phoneVerifiedAt: args.verifiedAt },
  })

  if (args.role === 'CLIENT') {
    await db.clientProfile.updateMany({
      where: { userId: args.userId, phoneVerifiedAt: null },
      data: { phoneVerifiedAt: args.verifiedAt },
    })
  }

  if (args.role === 'PRO') {
    await db.professionalProfile.updateMany({
      where: { userId: args.userId, phoneVerifiedAt: null },
      data: { phoneVerifiedAt: args.verifiedAt },
    })
  }
}

export async function markUserEmailVerified(
  db: Db,
  args: {
    userId: string
    verifiedAt: Date
  },
): Promise<void> {
  await db.user.updateMany({
    where: { id: args.userId, emailVerifiedAt: null },
    data: { emailVerifiedAt: args.verifiedAt },
  })
}
