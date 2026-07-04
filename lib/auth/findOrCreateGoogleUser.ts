// lib/auth/findOrCreateGoogleUser.ts
//
// Resolve (or create) the user behind a verified Google identity. Mirrors
// findOrCreateAppleUser.ts (and the register route's user-creation invariants:
// contact lookup hash, email-at-rest dual-write, tenant-scoped client profile)
// so a Google-created account is indistinguishable from a normally-registered
// one.

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

const GOOGLE_USER_SELECT = {
  id: true,
  email: true, // pii-plaintext-read-ok: auth-response identity, parity with login
  role: true,
  authVersion: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
} satisfies Prisma.UserSelect

export type GoogleUserRecord = Prisma.UserGetPayload<{
  select: typeof GOOGLE_USER_SELECT
}>

export type FindOrCreateGoogleUserResult =
  | { ok: true; user: GoogleUserRecord }
  | { ok: false; code: 'ACCOUNT_EXISTS_UNVERIFIED' }

export async function findOrCreateGoogleUser(input: {
  googleUserId: string
  email: string // already normalized via normalizeEmail
  firstName: string | null
  lastName: string | null
  tenantId: string
  tosVersion: string
}): Promise<FindOrCreateGoogleUserResult> {
  // 1) Already linked to this Google id.
  const byGoogle = await prisma.user.findUnique({
    where: { googleUserId: input.googleUserId },
    select: GOOGLE_USER_SELECT,
  })
  if (byGoogle) return { ok: true, user: byGoogle }

  // 2) Existing account with this email. Google has proven email ownership, so
  //    link the Google id onto an already-verified account. Refuse to silently
  //    take over an UNVERIFIED same-email account (that would let a Google login
  //    adopt a squatted password account).
  const emailHash = emailLookupHashV2(input.email) // pii-plaintext-read-ok: hashing the provided email for lookup, not a DB read
  if (emailHash) {
    const byEmail = await prisma.user.findFirst({
      where: {
        emailHashV2: emailHash.hash,
        emailHashKeyVersion: emailHash.keyVersion,
      },
      select: GOOGLE_USER_SELECT,
    })
    if (byEmail) {
      if (!byEmail.emailVerifiedAt) {
        return { ok: false, code: 'ACCOUNT_EXISTS_UNVERIFIED' }
      }
      const linked = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleUserId: input.googleUserId },
        select: GOOGLE_USER_SELECT,
      })
      return { ok: true, user: linked }
    }
  }

  // 3) Create a fresh CLIENT account. Google users have no password, but the
  //    column is required — store an unguessable random hash so password login
  //    can never match.
  const randomPassword = await hashPassword(crypto.randomUUID())
  const now = new Date()

  const created = await prisma.user.create({
    data: {
      email: input.email,
      googleUserId: input.googleUserId,
      ...buildUserContactLookupData({ email: input.email }), // pii-plaintext-read-ok: hashing the provided email, not a DB read
      ...buildEmailEncryptionWriteData({ email: input.email }), // pii-plaintext-read-ok: encrypting the provided email, not a DB read
      phoneVerifiedAt: null,
      emailVerifiedAt: now, // Google asserts a verified email
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
    select: GOOGLE_USER_SELECT,
  })

  return { ok: true, user: created }
}
