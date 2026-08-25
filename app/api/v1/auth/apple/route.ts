// app/api/v1/auth/apple/route.ts
//
// "Sign in with Apple" for the native app. The client sends Apple's identity
// token (+ the name on first auth + a stable deviceId).
//
// Two outcomes, both 200 (see AuthSocialSignInResponseDTO): an identity that
// already has an account signs in with the SAME session payload as
// email/password login, and one that does not gets a single-use signup ticket
// to finish at POST /api/v1/auth/social/complete. This route no longer creates
// accounts — the whole body lives in lib/auth/social/handleSocialSignIn.ts,
// shared with the Google route it used to be a copy of.

import { handleSocialSignIn } from '@/lib/auth/social/handleSocialSignIn'
import { verifyAppleIdentityToken } from '@/lib/auth/appleIdentity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleSocialSignIn(request, {
    provider: 'APPLE',
    displayName: 'Apple',
    bucket: 'auth:apple',
    routeLabel: 'auth.apple',
    invalidTokenCode: 'INVALID_APPLE_TOKEN',
    // Apple's identity token carries NO name. It releases one exactly once, in
    // the first authorization response, so the client forwards it in the body.
    namesFrom: 'BODY',
    verifyIdentityToken: verifyAppleIdentityToken,
  })
}
