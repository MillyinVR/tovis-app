// lib/auth/findUserByPhone.ts
//
// Look up the user behind a phone number for passwordless phone-OTP login.
// Mirrors login's email lookup: query the blind-index hash (phoneHashV2), never
// the plaintext phone column.

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { phoneLookupHashV2 } from '@/lib/security/crypto/hashLookup'

const PHONE_LOGIN_USER_SELECT = {
  id: true,
  email: true, // pii-plaintext-read-ok: auth-response identity, parity with login
  role: true,
  authVersion: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
} satisfies Prisma.UserSelect

export type PhoneLoginUserRecord = Prisma.UserGetPayload<{
  select: typeof PHONE_LOGIN_USER_SELECT
}>

export async function findUserByPhoneForLogin(
  phone: string,
): Promise<PhoneLoginUserRecord | null> {
  const phoneHash = phoneLookupHashV2(phone) // pii-plaintext-read-ok: hashing the provided phone for lookup, not a DB read
  if (!phoneHash) return null

  return prisma.user.findFirst({
    where: {
      phoneHashV2: phoneHash.hash,
      phoneHashKeyVersion: phoneHash.keyVersion,
    },
    select: PHONE_LOGIN_USER_SELECT,
  })
}
