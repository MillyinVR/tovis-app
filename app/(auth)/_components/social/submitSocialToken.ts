// app/(auth)/_components/social/submitSocialToken.ts
//
// Exchange a provider identity token for one of the two things the sign-in
// route can answer with, and say which. Shared by both social buttons so
// Google and Apple route through the identical verification-gate logic as
// password login.
//
// The route has TWO 200 outcomes (AuthSocialSignInResponseDTO): an identity
// that already has an account is signed in, and one that does not gets a
// single-use signup ticket because NOTHING was created. Before the ticket
// existed this function fed every 200 to resolvePostAuthNavigation, so a
// person with no account fell through the `missing-role` branch and was told
// their "account role is missing" — advice about an account that did not exist.

import type { AuthSocialSignInResponseDTO } from '@/lib/dto/auth'
import { isRecord } from '@/lib/guards'
import { safeJsonRecord, readErrorMessage, readStringField } from '@/lib/http'
import { resolvePostAuthNavigation } from '../postAuthRedirect'

export type SocialProvider = 'google' | 'apple'

const ENDPOINTS: Record<SocialProvider, string> = {
  google: '/api/v1/auth/google',
  apple: '/api/v1/auth/apple',
}

/**
 * The `SIGNUP_REQUIRED` arm of the wire contract, DERIVED rather than retyped —
 * `lib/dto/auth.ts` is its single source, the routes pin their responses to it
 * with `satisfies`, and a hand-written copy here would let the two drift with
 * typecheck green on both sides.
 *
 * `provider` is the one field the client adds: the response does not carry it
 * (it is whichever button was pressed), and the completion form needs it to say
 * "Verified by Google".
 *
 * Named ...Handoff, not ...Ticket: `SocialSignupTicket` is a Prisma MODEL, and
 * two different shapes answering to one name is the more expensive bug. This is
 * the wire payload; that is the row.
 *
 * `prefill` is display-only — the completion route reads the real email and
 * names from the ticket row, so editing these client-side changes what is shown
 * and nothing that is stored.
 */
type SignupRequiredResponse = Extract<
  AuthSocialSignInResponseDTO,
  { status: 'SIGNUP_REQUIRED' }
>

export type SocialSignupHandoff = Omit<SignupRequiredResponse, 'status'> & {
  provider: SocialProvider
}

export type SubmitSocialResult =
  | { ok: true; kind: 'signed-in'; url: string }
  | { ok: true; kind: 'signup-required'; ticket: SocialSignupHandoff }
  | { ok: false; error: string }

function readSignupTicket(
  provider: SocialProvider,
  data: unknown,
): SocialSignupHandoff | null {
  const signupTicket = readStringField(data, 'signupTicket')
  const ticketExpiresAt = readStringField(data, 'ticketExpiresAt')
  if (!signupTicket || !ticketExpiresAt) return null

  const prefill = isRecord(data) && isRecord(data.prefill) ? data.prefill : null
  const email = readStringField(prefill, 'email')
  if (!email) return null

  return {
    provider,
    signupTicket,
    ticketExpiresAt,
    prefill: {
      email,
      firstName: readStringField(prefill, 'firstName'),
      lastName: readStringField(prefill, 'lastName'),
    },
  }
}

/**
 * POST a verified provider identity token to its auth endpoint, then either
 * resolve the post-auth destination or hand back the signup ticket. Returns a
 * friendly error string on any non-2xx response or missing role.
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

  // Only the explicit discriminant diverts. Anything else — including a
  // response from a server that predates it — stays on the signed-in path,
  // which is what keeps this additive.
  if (readStringField(data, 'status') === 'SIGNUP_REQUIRED') {
    const ticket = readSignupTicket(args.provider, data)
    if (!ticket) {
      return {
        ok: false,
        error: 'Sign-in could not be completed. Please try again.',
      }
    }
    return { ok: true, kind: 'signup-required', ticket }
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

  return { ok: true, kind: 'signed-in', url: nav.url }
}
