// lib/auth/findOrCreateAppleUser.ts
//
// Resolve (or create) the user behind a verified Apple identity. Mirrors
// the user-creation invariants in the email/password register route (contact
// lookup hash, email-at-rest dual-write, tenant-scoped client profile) so an
// Apple-created account is indistinguishable from a normally-registered one.

import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import {
  buildUserContactLookupData,
  buildClientProfileContactLookupData,
} from '@/lib/security/contactLookup'
import { buildEmailEncryptionWriteData } from '@/lib/security/emailPrivacy'
import { emailLookupHashV2 } from '@/lib/security/crypto/hashLookup'

const APPLE_USER_SELECT = {
  id: true,
  email: true, // pii-plaintext-read-ok: auth-response identity, parity with login
  role: true,
  authVersion: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
} satisfies Prisma.UserSelect

export type AppleUserRecord = Prisma.UserGetPayload<{
  select: typeof APPLE_USER_SELECT
}>

export type FindOrCreateAppleUserResult =
  | { ok: true; user: AppleUserRecord }
  | { ok: false; code: 'ACCOUNT_EXISTS_UNVERIFIED' }

export async function findOrCreateAppleUser(input: {
  appleUserId: string
  email: string // already normalized via normalizeEmail
  firstName: string | null
  lastName: string | null
  tenantId: string
  tosVersion: string
}): Promise<FindOrCreateAppleUserResult> {
  // 1) Already linked to this Apple id.
  const byApple = await prisma.user.findUnique({
    where: { appleUserId: input.appleUserId },
    select: APPLE_USER_SELECT,
  })
  if (byApple) return { ok: true, user: byApple }

  // 2) Existing account with this email. Apple has proven email ownership, so
  //    link the Apple id onto an already-verified account. Refuse to silently
  //    take over an UNVERIFIED same-email account (that would let an Apple login
  //    adopt a squatted password account).
  const emailHash = emailLookupHashV2(input.email) // pii-plaintext-read-ok: hashing the provided email for lookup, not a DB read
  if (emailHash) {
    const byEmail = await prisma.user.findFirst({
      where: {
        emailHashV2: emailHash.hash,
        emailHashKeyVersion: emailHash.keyVersion,
      },
      select: APPLE_USER_SELECT,
    })
    if (byEmail) {
      if (!byEmail.emailVerifiedAt) {
        return { ok: false, code: 'ACCOUNT_EXISTS_UNVERIFIED' }
      }
      const linked = await prisma.user.update({
        where: { id: byEmail.id },
        data: { appleUserId: input.appleUserId },
        select: APPLE_USER_SELECT,
      })
      return { ok: true, user: linked }
    }
  }

  // 3) Create a fresh CLIENT account. Apple users have no password, but the
  //    column is required — store an unguessable random hash so password login
  //    can never match.
  const randomPassword = await hashPassword(crypto.randomUUID())
  const now = new Date()

  const created = await prisma.user.create({
    data: {
      email: input.email,
      appleUserId: input.appleUserId,
      ...buildUserContactLookupData({ email: input.email }), // pii-plaintext-read-ok: hashing the provided email, not a DB read
      ...buildEmailEncryptionWriteData({ email: input.email }), // pii-plaintext-read-ok: encrypting the provided email, not a DB read
      phoneVerifiedAt: null,
      emailVerifiedAt: now, // Apple asserts a verified email
      password: randomPassword,
      role: 'CLIENT',
      tosAcceptedAt: now,
      tosVersion: input.tosVersion,
      clientProfile: {
        create: {
          homeTenantId: input.tenantId,
          firstName: input.firstName ?? '',
          lastName: input.lastName ?? '',
          ...buildClientProfileContactLookupData({ email: input.email }), // pii-plaintext-read-ok: hashing the provided email, not a DB read
          ...buildEmailEncryptionWriteData({ email: input.email }), // pii-plaintext-read-ok: encrypting the provided email, not a DB read
          phoneVerifiedAt: null,
        },
      },
    },
    select: APPLE_USER_SELECT,
  })

  return { ok: true, user: created }
}
