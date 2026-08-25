// lib/auth/socialProviderColumns.ts
//
// Which User column holds which provider's subject id — decided here and
// nowhere else, so a new provider is one edit and a typo is a compile error
// rather than a query that silently never matches.
//
// `googleUserId` and `appleUserId` are separate nullable columns because one
// person may link both. That is why this cannot be a single "providerId"
// column, and why the three shapes below are not interchangeable: reading and
// creating name both columns, while LINKING must name exactly one.
//
// They are spelled out as ternaries rather than a computed key
// (`{ [COLUMN[provider]]: subject }`) on purpose — a computed key widens to
// `string` and would need a cast to satisfy Prisma's input types, and this repo
// does not cast.

import type { Prisma, SocialAuthProvider } from '@prisma/client'

/** Look an account up BY its provider id. */
export function socialProviderIdWhere(
  provider: SocialAuthProvider,
  subject: string,
): Prisma.UserWhereUniqueInput {
  return provider === 'GOOGLE'
    ? { googleUserId: subject }
    : { appleUserId: subject }
}

/**
 * LINK a provider id onto an existing account.
 *
 * ⚠️ Sets ONE column. It must never write the other one, even as null: a person
 * who signed up with Apple and later links Google would otherwise have their
 * Apple link wiped by the Google link, and silently lose the ability to sign in
 * the way they always have. This is the difference from
 * `socialProviderIdCreateData` below, which may name both because there is
 * nothing there yet to erase.
 */
export function socialProviderIdLinkData(
  provider: SocialAuthProvider,
  subject: string,
): Prisma.UserUpdateInput {
  return provider === 'GOOGLE'
    ? { googleUserId: subject }
    : { appleUserId: subject }
}

/**
 * CREATE an account carrying a provider id. Both columns are explicit: the
 * other provider is genuinely null on a brand-new row, and saying so is what
 * keeps this distinguishable from the link case above at a glance.
 */
export function socialProviderIdCreateData(
  provider: SocialAuthProvider,
  subject: string,
): { googleUserId: string | null; appleUserId: string | null } {
  return {
    googleUserId: provider === 'GOOGLE' ? subject : null,
    appleUserId: provider === 'APPLE' ? subject : null,
  }
}
