// lib/auth/resolveSocialAccount.ts
//
// Given an identity a provider has just verified, decide which of three things
// is true: this identity already has an account (sign in), it belongs to an
// existing verified account that should be linked (link, then sign in), or
// there is no account yet (go and make one).
//
// ── What replaced what ─────────────────────────────────────────────────────
//
// This is the collapse of lib/auth/findOrCreateGoogleUser.ts and
// lib/auth/findOrCreateAppleUser.ts, which were byte-identical apart from the
// word "Google"/"Apple" and the column each wrote. Two copies meant every fix
// had to be made twice, and the P2002 bug below existed twice.
//
// It also drops the "OrCreate" half deliberately. Those helpers created the
// account inline — hardcoded to `role: 'CLIENT'`, with no phone, no SMS
// consent, no location and no claim adoption — and the nested ClientProfile
// create raised an unhandled P2002 (a bare 500 to the client) whenever a pro
// had already made an UNCLAIMED profile for that email. Creation now happens
// one step later in /api/v1/auth/social/complete, via the same
// createRegisteredAccount() a password signup uses. See
// lib/auth/socialSignupTicket.ts for what carries the identity across the gap.
//
// This module therefore writes exactly one thing, ever: the provider id onto an
// already-verified account it is linking. Nothing else here creates a row.

import { Prisma, type SocialAuthProvider } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { emailLookupHashV2 } from '@/lib/security/crypto/hashLookup'
import {
  socialProviderIdLinkData,
  socialProviderIdWhere,
} from '@/lib/auth/socialProviderColumns'

const SOCIAL_USER_SELECT = {
  id: true,
  email: true, // pii-plaintext-read-ok: auth-response identity, parity with login
  role: true,
  authVersion: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
} satisfies Prisma.UserSelect

export type SocialUserRecord = Prisma.UserGetPayload<{
  select: typeof SOCIAL_USER_SELECT
}>

export type ResolvedSocialAccount =
  /** Sign this user in — either already linked, or just linked by this call. */
  | { outcome: 'SIGNED_IN'; user: SocialUserRecord }
  /**
   * No account for this identity. The caller issues a signup ticket and sends
   * the person to the completion step; NOTHING has been written.
   */
  | { outcome: 'NEEDS_SIGNUP' }
  /**
   * An account exists for this email but has never verified it. Refused rather
   * than linked — see the guard's comment below.
   */
  | { outcome: 'ACCOUNT_EXISTS_UNVERIFIED' }

export async function resolveSocialAccount(input: {
  provider: SocialAuthProvider
  /** The identity token's `sub`. */
  subject: string
  /** Already normalized via normalizeEmail. */
  email: string
}): Promise<ResolvedSocialAccount> {
  // 1) Already linked to this provider id.
  const byProvider = await prisma.user.findUnique({
    where: socialProviderIdWhere(input.provider, input.subject),
    select: SOCIAL_USER_SELECT,
  })
  if (byProvider) return { outcome: 'SIGNED_IN', user: byProvider }

  // 2) Existing account with this email. The provider has proven email
  //    ownership, so link its id onto an already-verified account. Refuse to
  //    silently take over an UNVERIFIED same-email account — that would let a
  //    social login adopt a password account somebody squatted on an address
  //    they never proved they own.
  const emailHash = emailLookupHashV2(input.email) // pii-plaintext-read-ok: hashing the provided email for lookup, not a DB read
  if (emailHash) {
    const byEmail = await prisma.user.findFirst({
      where: {
        emailHashV2: emailHash.hash,
        emailHashKeyVersion: emailHash.keyVersion,
      },
      select: SOCIAL_USER_SELECT,
    })
    if (byEmail) {
      if (!byEmail.emailVerifiedAt) {
        return { outcome: 'ACCOUNT_EXISTS_UNVERIFIED' }
      }
      const linked = await prisma.user.update({
        where: { id: byEmail.id },
        data: socialProviderIdLinkData(input.provider, input.subject),
        select: SOCIAL_USER_SELECT,
      })
      return { outcome: 'SIGNED_IN', user: linked }
    }
  }

  // 3) Nobody. Previously this created a CLIENT account on the spot; it now
  //    reports the fact and writes nothing, because a signup needs more than an
  //    email — and because the create it used to do collided with any UNCLAIMED
  //    ClientProfile a pro had already made for this address.
  return { outcome: 'NEEDS_SIGNUP' }
}
