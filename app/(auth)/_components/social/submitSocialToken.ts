// app/(auth)/_components/social/submitSocialToken.ts
//
// Exchange a provider identity token for an app session and decide where to
// navigate next. Shared by both social buttons so Google and Apple route
// through the identical verification-gate logic as password login.

import { safeJsonRecord, readErrorMessage } from '@/lib/http'
import { resolvePostAuthNavigation } from '../postAuthRedirect'

export type SocialProvider = 'google' | 'apple'

const ENDPOINTS: Record<SocialProvider, string> = {
  google: '/api/v1/auth/google',
  apple: '/api/v1/auth/apple',
}

export type SubmitSocialResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

/**
 * POST a verified provider identity token to its auth endpoint, then resolve
 * the post-auth destination. Returns a friendly error string on any non-2xx
 * response or missing role.
 */
export async function submitSocialToken(args: {
  provider: SocialProvider
  identityToken: string
  firstName?: string | null
  lastName?: string | null
  nextSafe: string | null
  fromSafe: string | null
}): Promise<SubmitSocialResult> {
  const res = await fetch(ENDPOINTS[args.provider], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({
      identityToken: args.identityToken,
      firstName: args.firstName ?? undefined,
      lastName: args.lastName ?? undefined,
    }),
  })

  const data = await safeJsonRecord(res)

  if (!res.ok) {
    return { ok: false, error: readErrorMessage(data) ?? 'Sign-in failed.' }
  }

  const nav = resolvePostAuthNavigation(data, {
    nextSafe: args.nextSafe,
    fromSafe: args.fromSafe,
  })

  if (nav.kind === 'missing-role') {
    return {
      ok: false,
      error:
        'Sign-in succeeded, but your account role is missing. Please contact support.',
    }
  }
  if (nav.kind === 'error') {
    return { ok: false, error: nav.message }
  }

  return { ok: true, url: nav.url }
}
